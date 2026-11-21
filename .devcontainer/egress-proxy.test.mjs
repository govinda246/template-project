import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import test from 'node:test';
import {
  createEgressProxy,
  createFrontendProxy,
  isAllowed,
  parseAllowlist,
  parseConnectTarget,
} from './egress-proxy.mjs';

test('parses comments and normalizes exact hostnames', () => {
  assert.deepEqual(
    [...parseAllowlist('# comment\nGitHub.COM\n\nregistry.npmjs.org\n')],
    ['github.com', 'registry.npmjs.org'],
  );
});

test('only permits exact allowlisted HTTPS destinations', () => {
  const allowed = new Set(['github.com']);
  assert.equal(isAllowed({ hostname: 'github.com', port: 443 }, allowed), true);
  assert.equal(isAllowed({ hostname: 'evil.github.com', port: 443 }, allowed), false);
  assert.equal(isAllowed({ hostname: 'github.com', port: 80 }, allowed), false);
  assert.equal(isAllowed({ hostname: '127.0.0.1', port: 443 }, allowed), false);
});

test('rejects malformed CONNECT targets', () => {
  assert.equal(parseConnectTarget({ url: 'https://github.com:443' }), null);
  assert.equal(parseConnectTarget({ url: 'github.com:0' }), null);
  assert.equal(parseConnectTarget({ url: 'github.com:not-a-port' }), null);
});

test('rejects unsupported methods and non-HTTPS ports', async () => {
  const upstream = createTcpServer((socket) => socket.end('upstream'));
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');

  const proxy = createEgressProxy(new Set(['127.0.0.1']));
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');

  try {
    const upstreamAddress = upstream.address();
    const proxyAddress = proxy.address();
    assert.ok(upstreamAddress && typeof upstreamAddress === 'object');
    assert.ok(proxyAddress && typeof proxyAddress === 'object');

    const httpResponse = await fetch(`http://127.0.0.1:${proxyAddress.port}/`);
    assert.equal(httpResponse.status, 405);

    assert.equal(
      isAllowed(
        { hostname: '127.0.0.1', port: upstreamAddress.port },
        new Set(['127.0.0.1']),
      ),
      false,
    );
  } finally {
    proxy.close();
    upstream.close();
    await Promise.all([once(proxy, 'close'), once(upstream, 'close')]);
  }
});

test('forwards frontend requests to the selected internal host', async () => {
  const upstream = createHttpServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(`${request.headers.host}:${request.url}`);
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');

  const upstreamAddress = upstream.address();
  assert.ok(upstreamAddress && typeof upstreamAddress === 'object');

  const frontend = createFrontendProxy('127.0.0.1', upstreamAddress.port);
  frontend.listen(0, '127.0.0.1');
  await once(frontend, 'listening');

  try {
    const frontendAddress = frontend.address();
    assert.ok(frontendAddress && typeof frontendAddress === 'object');
    const response = await fetch(
      `http://127.0.0.1:${frontendAddress.port}/game?mode=test`,
    );
    assert.equal(response.status, 200);
    assert.equal(
      await response.text(),
      `127.0.0.1:${upstreamAddress.port}:/game?mode=test`,
    );
  } finally {
    frontend.close();
    upstream.close();
    await Promise.all([once(frontend, 'close'), once(upstream, 'close')]);
  }
});
