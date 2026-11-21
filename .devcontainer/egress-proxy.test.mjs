import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import test from 'node:test';
import {
  createEgressProxy,
  createFrontendProxy,
  isAllowedFrontendHost,
  isAllowed,
  parseAllowlist,
  parseConnectTarget,
} from './egress-proxy.mjs';
import { connect } from 'node:net';
import { request as httpRequest } from 'node:http';

test('only accepts local frontend hosts', () => {
  assert.equal(isAllowedFrontendHost('localhost:3000'), true);
  assert.equal(isAllowedFrontendHost('127.0.0.1:3000'), true);
  assert.equal(isAllowedFrontendHost('[::1]:3000'), true);
  assert.equal(isAllowedFrontendHost('devcontainer:3000'), true);
  assert.equal(isAllowedFrontendHost('attacker.example:3000'), false);
  assert.equal(isAllowedFrontendHost('localhost.attacker.example'), false);
  assert.equal(isAllowedFrontendHost(undefined), false);
});

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

test('logs denied CONNECT destinations', async () => {
  const warnings = [];
  const proxy = createEgressProxy(new Set(['github.com']), {
    warn(message) {
      warnings.push(message);
    },
    error() {},
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');

  try {
    const proxyAddress = proxy.address();
    assert.ok(proxyAddress && typeof proxyAddress === 'object');

    const client = connect(proxyAddress.port, '127.0.0.1');
    client.write('CONNECT api.example.com:443 HTTP/1.1\r\nHost: api.example.com\r\n\r\n');
    const response = await once(client, 'data');

    assert.match(response[0].toString(), /^HTTP\/1\.1 403 Forbidden/u);
    assert.deepEqual(warnings, [
      'egress-proxy: 403 denied CONNECT api.example.com:443',
    ]);
  } finally {
    proxy.close();
    await once(proxy, 'close');
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
    const response = await new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: frontendAddress.port,
          path: '/game?mode=test',
          headers: { host: `localhost:${frontendAddress.port}` },
        },
        resolve,
      );
      request.on('error', reject);
      request.end();
    });
    let responseBody = '';
    for await (const chunk of response) {
      responseBody += chunk;
    }
    assert.equal(response.statusCode, 200);
    assert.equal(
      responseBody,
      `localhost:${frontendAddress.port}:/game?mode=test`,
    );
  } finally {
    frontend.close();
    upstream.close();
    await Promise.all([once(frontend, 'close'), once(upstream, 'close')]);
  }
});

test('rejects DNS rebinding hosts before forwarding', async () => {
  let forwarded = false;
  const upstream = createHttpServer((_request, response) => {
    forwarded = true;
    response.end('unexpected');
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
    const response = await new Promise((resolve, reject) => {
      const request = httpRequest(
        {
          hostname: '127.0.0.1',
          port: frontendAddress.port,
          headers: { host: 'attacker.example' },
        },
        resolve,
      );
      request.on('error', reject);
      request.end();
    });
    response.resume();
    await once(response, 'end');
    assert.equal(response.statusCode, 421);
    assert.equal(forwarded, false);
  } finally {
    frontend.close();
    upstream.close();
    await Promise.all([once(frontend, 'close'), once(upstream, 'close')]);
  }
});
