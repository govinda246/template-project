import { createSocket } from 'node:dgram';
import { readFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { fileURLToPath } from 'node:url';

const DEFAULT_ALLOWLIST_PATH = fileURLToPath(
  new URL('./egress-allowlist.txt', import.meta.url),
);
const DNS_TIMEOUT_MS = 3_000;
const MAX_TCP_MESSAGE_SIZE = 4_096;

export function parseDnsQuery(message) {
  if (message.length < 17) {
    throw new Error('DNS message is too short.');
  }

  const flags = message.readUInt16BE(2);
  const questionCount = message.readUInt16BE(4);
  const answerCount = message.readUInt16BE(6);
  const authorityCount = message.readUInt16BE(8);
  const additionalCount = message.readUInt16BE(10);
  if (
    (flags & 0x7800) !== 0 ||
    questionCount !== 1 ||
    answerCount !== 0 ||
    authorityCount !== 0 ||
    additionalCount > 1
  ) {
    throw new Error('DNS queries must be conventional single-question requests.');
  }

  const labels = [];
  let offset = 12;
  const seen = new Set();
  for (;;) {
    if (offset >= message.length || seen.has(offset)) {
      throw new Error('DNS query has an invalid name.');
    }
    seen.add(offset);

    const length = message[offset];
    offset += 1;
    if (length === 0) {
      break;
    }
    if ((length & 0xc0) !== 0 || length > 63 || offset + length > message.length) {
      throw new Error('DNS query name compression is not allowed in questions.');
    }
    labels.push(message.subarray(offset, offset + length).toString('ascii').toLowerCase());
    offset += length;
  }

  if (offset + 4 > message.length) {
    throw new Error('DNS query is missing type or class.');
  }

  const name = labels.join('.');
  const questionEnd = offset + 4;
  if (additionalCount === 0 && questionEnd !== message.length) {
    throw new Error('DNS query contains unexpected trailing data.');
  }
  if (name.length > 253) {
    throw new Error('DNS query name is too long.');
  }

  let forwardMessage = message;
  if (additionalCount === 1) {
    if (questionEnd + 11 > message.length || message[questionEnd] !== 0) {
      throw new Error('EDNS0 OPT record is malformed.');
    }
    const type = message.readUInt16BE(questionEnd + 1);
    const udpPayloadSize = message.readUInt16BE(questionEnd + 3);
    const ttl = message.readUInt32BE(questionEnd + 5);
    const optionLength = message.readUInt16BE(questionEnd + 9);
    if (
      type !== 41 ||
      udpPayloadSize < 512 ||
      udpPayloadSize > 1_232 ||
      (ttl & 0xffff7fff) !== 0 ||
      optionLength !== 0 ||
      questionEnd + 11 !== message.length
    ) {
      throw new Error('Only empty EDNS0 OPT records are allowed.');
    }
    forwardMessage = Buffer.from(message.subarray(0, questionEnd));
    forwardMessage.writeUInt16BE(0, 10);
  }

  return { name, questionEnd, forwardMessage };
}

export function parseAllowedDnsNames(contents) {
  return new Set([
    'devcontainer',
    'dns-filter',
    'egress-proxy',
    ...contents
      .split(/\r?\n/u)
      .map((line) => line.trim().toLowerCase().replace(/\.$/u, ''))
      .filter((line) => line && !line.startsWith('#')),
  ]);
}

function errorResponse(message, rcode) {
  const { questionEnd } = parseDnsQuery(message);
  const response = Buffer.alloc(questionEnd);
  message.copy(response, 0, 0, 2);
  message.copy(response, 12, 12, questionEnd);
  response.writeUInt16BE(0x8180 | rcode, 2);
  response.writeUInt16BE(1, 4);
  response.writeUInt16BE(0, 6);
  response.writeUInt16BE(0, 8);
  response.writeUInt16BE(0, 10);
  return response;
}

function malformedResponse(message) {
  const response = Buffer.alloc(12);
  if (message.length >= 2) {
    message.copy(response, 0, 0, 2);
  }
  response.writeUInt16BE(0x8181, 2);
  return response;
}

export async function handleDnsQuery(message, allowedNames, forward) {
  let query;
  try {
    query = parseDnsQuery(message);
  } catch {
    return {
      response: malformedResponse(message),
      denied: true,
    };
  }

  if (!allowedNames.has(query.name)) {
    return { response: errorResponse(message, 3), denied: true };
  }

  return { response: await forward(query.forwardMessage), denied: false };
}

function forwardUdp(message, resolver = '127.0.0.11') {
  return new Promise((resolve, reject) => {
    const socket = createSocket('udp4');
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('DNS upstream timeout.'));
    }, DNS_TIMEOUT_MS);

    socket.once('error', (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(error);
    });
    socket.once('message', (response) => {
      clearTimeout(timeout);
      socket.close();
      resolve(response);
    });
    socket.send(message, 53, resolver);
  });
}

function forwardTcp(message, resolver = '127.0.0.11') {
  return new Promise((resolve, reject) => {
    const socket = connect(53, resolver);
    const chunks = [];
    let length = null;
    let received = 0;
    const timeout = setTimeout(() => {
      socket.destroy(new Error('DNS upstream timeout.'));
    }, DNS_TIMEOUT_MS);

    socket.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('connect', () => {
      const prefix = Buffer.allocUnsafe(2);
      prefix.writeUInt16BE(message.length);
      socket.write(Buffer.concat([prefix, message]));
    });
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      received += chunk.length;
      const combined = Buffer.concat(chunks, received);
      if (length === null && combined.length >= 2) {
        length = combined.readUInt16BE(0);
        if (length > MAX_TCP_MESSAGE_SIZE) {
          socket.destroy(new Error('DNS upstream response is too large.'));
        }
      }
      if (length !== null && received >= length + 2) {
        clearTimeout(timeout);
        socket.destroy();
        resolve(combined.subarray(2, length + 2));
      }
    });
  });
}

export function createDnsFilter(allowedNames, logger = console) {
  const udp = createSocket('udp4');
  udp.on('message', async (message, remote) => {
    try {
      const { response, denied } = await handleDnsQuery(
        message,
        allowedNames,
        async (query) => {
          const upstream = await forwardUdp(query);
          if (upstream.length < 4 || !(upstream.readUInt16BE(2) & 0x0200)) {
            return upstream;
          }
          return forwardTcp(query);
        },
      );
      if (denied) {
        logger.warn('dns-filter: denied unapproved DNS name');
      }
      udp.send(response, remote.port, remote.address);
    } catch (error) {
      logger.error(`dns-filter: query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  const tcp = createServer((socket) => {
    const chunks = [];
    let received = 0;
    let expected = null;
    socket.on('data', async (chunk) => {
      chunks.push(chunk);
      received += chunk.length;
      if (expected === null && received >= 2) {
        expected = Buffer.concat(chunks, received).readUInt16BE(0);
        if (expected === 0 || expected > MAX_TCP_MESSAGE_SIZE) {
          socket.destroy();
          return;
        }
      }
      if (expected !== null && received >= expected + 2) {
        socket.pause();
        const message = Buffer.concat(chunks, received).subarray(2, expected + 2);
        try {
          const { response, denied } = await handleDnsQuery(
            message,
            allowedNames,
            forwardTcp,
          );
          if (denied) {
            logger.warn('dns-filter: denied unapproved DNS name over TCP');
          }
          const prefix = Buffer.allocUnsafe(2);
          prefix.writeUInt16BE(response.length);
          socket.end(Buffer.concat([prefix, response]));
        } catch (error) {
          logger.error(`dns-filter: TCP query failed: ${error instanceof Error ? error.message : String(error)}`);
          socket.destroy();
        }
      }
    });
  });

  return { udp, tcp };
}

async function runHealthcheck() {
  function query(host, port, transport) {
    const message = Buffer.alloc(12 + host.length + 6);
    message.writeUInt16BE(0x4f4b, 0);
    message.writeUInt16BE(0x0100, 2);
    message.writeUInt16BE(1, 4);
    let offset = 12;
    for (const label of host.split('.')) {
      message[offset++] = label.length;
      message.write(label, offset, 'ascii');
      offset += label.length;
    }
    message[offset++] = 0;
    message.writeUInt16BE(1, offset);
    message.writeUInt16BE(1, offset + 2);

    if (transport === 'udp') {
      return new Promise((resolve, reject) => {
        const socket = createSocket('udp4');
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error('UDP DNS healthcheck timed out.'));
        }, 2_000);
        socket.once('message', (response) => {
          clearTimeout(timeout);
          socket.close();
          resolve(response);
        });
        socket.once('error', reject);
        socket.send(message, port, '127.0.0.1');
      });
    }

    return new Promise((resolve, reject) => {
      const socket = connect(port, '127.0.0.1');
      const timeout = setTimeout(
        () => socket.destroy(new Error('TCP DNS healthcheck timed out.')),
        2_000,
      );
      const prefix = Buffer.allocUnsafe(2);
      prefix.writeUInt16BE(message.length);
      socket.once('connect', () => socket.write(Buffer.concat([prefix, message])));
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.once('data', (response) => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(response.subarray(2));
      });
    });
  }

  for (const transport of ['udp', 'tcp']) {
    const response = await query('dns-filter', 53, transport);
    if (response.readUInt16BE(4) !== 1 || (response.readUInt16BE(2) & 0x000f) !== 0) {
      throw new Error(`${transport.toUpperCase()} DNS healthcheck failed.`);
    }
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv[2] === '--healthcheck') {
    runHealthcheck().catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  } else {
    const allowlistPath = process.env.ALLOWLIST_FILE ?? DEFAULT_ALLOWLIST_PATH;
    const allowedNames = parseAllowedDnsNames(readFileSync(allowlistPath, 'utf8'));
    if (allowedNames.size === 0) {
      throw new Error(`Refusing to start with an empty allowlist: ${allowlistPath}`);
    }

    const { udp, tcp } = createDnsFilter(allowedNames);
    udp.bind(53, '0.0.0.0', () => {
      console.log(`DNS filter listening with ${allowedNames.size} exact names`);
    });
    tcp.listen(53, '0.0.0.0');
  }
}
