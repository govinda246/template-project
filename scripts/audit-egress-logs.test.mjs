import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEgressDeniedLogs } from './audit-egress-logs.mjs';

test('extracts denied CONNECT events without matching upstream failures', () => {
  const events = parseEgressDeniedLogs(`
egress-proxy-1  | 2026-11-22T00:00:00.000Z egress-proxy: 403 denied CONNECT blocked.example:443
egress-proxy-1  | 2026-11-22T00:00:01.000Z egress-proxy: 502 upstream failure for api.github.com:443: timeout
egress-proxy-1  | 2026-11-22T00:00:02.000Z egress-proxy: 403 denied CONNECT 10.0.0.2:22
`);

  assert.deepEqual(events.map((event) => event.destination), [
    'blocked.example:443',
    '10.0.0.2:22',
  ]);
});
