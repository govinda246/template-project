import { createServer, request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

const DEFAULT_ALLOWLIST_PATH = fileURLToPath(
  new URL('./egress-allowlist.txt', import.meta.url),
);

export function parseAllowlist(contents) {
  return new Set(
    contents
      .split(/\r?\n/u)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith('#')),
  );
}

export function parseConnectTarget(request) {
  const match = /^([a-z0-9.-]+):(\d+)$/iu.exec(request.url ?? '');
  if (!match) {
    return null;
  }

  const port = Number.parseInt(match[2], 10);
  if (port < 1 || port > 65_535) {
    return null;
  }

  return { hostname: match[1].toLowerCase(), port };
}

export function isAllowed(target, allowedHosts) {
  // hostnameは完全一致、portは443だけ。サブドメインや平文HTTPを暗黙許可しない。
  return target.port === 443 && allowedHosts.has(target.hostname);
}

export function createEgressProxy(allowedHosts) {
  const server = createServer((_request, response) => {
    // 通常HTTPではforward proxyとして働かず、HTTPS CONNECTだけを受け付ける。
    response.writeHead(405, { connection: 'close' });
    response.end('Only HTTPS CONNECT requests are allowed.\n');
  });

  server.on('connect', (request, clientSocket, head) => {
    const target = parseConnectTarget(request);
    if (!target || !isAllowed(target, allowedHosts)) {
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }

    // 許可済みhostnameへのTLSトンネル。内容は復号・検査しないため内容安全性は保証しない。
    const upstream = connect(target.port, target.hostname);
    const connectTimeout = setTimeout(() => {
      upstream.destroy(new Error('Upstream connection timed out'));
    }, 10_000);

    upstream.once('connect', () => {
      clearTimeout(connectTimeout);
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });

    upstream.on('error', () => {
      clearTimeout(connectTimeout);
      if (!clientSocket.destroyed) {
        clientSocket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      }
    });
    clientSocket.on('error', () => upstream.destroy());
    clientSocket.on('close', () => upstream.destroy());
  });

  server.on('clientError', (_error, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return server;
}

export function createFrontendProxy(hostname, port) {
  // ブラウザーからの3000番をsandbox内Viteへ中継する。外部公開先とは別の入口。
  const server = createServer((request, response) => {
    const upstream = httpRequest(
      {
        hostname,
        port,
        method: request.method,
        path: request.url,
        headers: { ...request.headers, host: `${hostname}:${port}` },
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );

    upstream.on('error', () => {
      if (!response.headersSent) {
        response.writeHead(502, { connection: 'close' });
      }
      response.end('Development server is unavailable.\n');
    });
    request.pipe(upstream);
  });

  server.on('upgrade', (request, clientSocket, head) => {
    const upstream = connect(port, hostname);
    upstream.once('connect', () => {
      const headers = { ...request.headers, host: `${hostname}:${port}` };
      upstream.write(
        `${request.method} ${request.url} HTTP/${request.httpVersion}\r\n`,
      );
      for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined) {
          upstream.write(`${name}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`);
        }
      }
      upstream.write('\r\n');
      if (head.length > 0) {
        upstream.write(head);
      }
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.end());
    clientSocket.on('error', () => upstream.destroy());
    clientSocket.on('close', () => upstream.destroy());
  });

  return server;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const allowlistPath = process.env.ALLOWLIST_FILE ?? DEFAULT_ALLOWLIST_PATH;
  const allowedHosts = parseAllowlist(readFileSync(allowlistPath, 'utf8'));
  if (allowedHosts.size === 0) {
    // 空のallowlistを「全許可」と解釈しない。
    throw new Error(`Refusing to start with an empty allowlist: ${allowlistPath}`);
  }

  const server = createEgressProxy(allowedHosts);
  server.listen(3128, '0.0.0.0', () => {
    console.log(`Egress proxy listening with ${allowedHosts.size} allowed hosts`);
  });

  const frontendTarget = process.env.FRONTEND_PROXY_TARGET;
  if (frontendTarget) {
    const frontendPort = Number.parseInt(
      process.env.FRONTEND_PROXY_PORT ?? '3000',
      10,
    );
    const frontendProxy = createFrontendProxy(frontendTarget, frontendPort);
    frontendProxy.listen(3000, '0.0.0.0', () => {
      console.log(`Frontend proxy listening for ${frontendTarget}:${frontendPort}`);
    });
  }
}
