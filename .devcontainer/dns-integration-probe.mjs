import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { createSocket } from 'node:dgram';
import { connect } from 'node:net';

function dnsQuery(name) {
  const labels = name.split('.');
  const length = labels.reduce((total, label) => total + label.length + 1, 17);
  const message = Buffer.alloc(length);
  message.writeUInt16BE(0x5153, 0);
  message.writeUInt16BE(0x0100, 2);
  message.writeUInt16BE(1, 4);
  let offset = 12;
  for (const label of labels) {
    message[offset++] = label.length;
    message.write(label, offset, 'ascii');
    offset += label.length;
  }
  message[offset++] = 0;
  message.writeUInt16BE(1, offset);
  message.writeUInt16BE(1, offset + 2);
  return message;
}

function assertUdpBlocked(address) {
  return new Promise((resolve, reject) => {
    const socket = createSocket(address.includes(':') ? 'udp6' : 'udp4');
    const timeout = setTimeout(() => {
      socket.close();
      resolve();
    }, 750);
    socket.once('error', (error) => {
      clearTimeout(timeout);
      socket.close();
      if (/ENETUNREACH|EHOSTUNREACH/u.test(error.code ?? '')) {
        resolve();
        return;
      }
      reject(error);
    });
    socket.once('message', () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error(`Direct DNS unexpectedly succeeded via ${address}`));
    });
    socket.send(dnsQuery('example.com'), 53, address);
  });
}

function assertTcpBlocked(address) {
  return new Promise((resolve, reject) => {
    const socket = connect(53, address);
    const timeout = setTimeout(() => socket.destroy(), 750);
    socket.once('connect', () => {
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error(`Direct TCP DNS unexpectedly succeeded via ${address}`));
    });
    socket.once('error', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

const allowed = await lookup('dns-filter', { family: 4 });
assert.match(allowed.address, /^\d+\.\d+\.\d+\.\d+$/u);
await assert.rejects(lookup('secret-exfiltration.invalid', { family: 4 }));
await assertUdpBlocked('127.0.0.11');
await assertTcpBlocked('127.0.0.11');
await assertUdpBlocked('::1');
await assertTcpBlocked('::1');

const status = await readFile('/proc/self/status', 'utf8');
const effectiveCapabilities = status.match(/^CapEff:\s+([0-9a-f]+)$/mu)?.[1];
assert.equal(BigInt(`0x${effectiveCapabilities ?? '1'}`), 0n);

console.log('DNS containment integration checks passed.');
