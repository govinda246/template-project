import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'docker',
  ['compose', '-f', '.devcontainer/docker-compose.yml', 'config', '--format', 'json'],
  { encoding: 'utf8' },
);

if (result.error?.code === 'ENOENT') {
  console.error(
    'Docker CLI is unavailable. Run this check from the host/CI environment, not from the Dev Container.',
  );
  console.error(
    'The container intentionally does not expose the Docker CLI or socket.',
  );
  process.exit(69);
}
if (result.error) {
  console.error(`Unable to invoke Docker CLI: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const config = JSON.parse(result.stdout);
const devcontainer = config.services.devcontainer;
const proxy = config.services['egress-proxy'];

assert.deepEqual(devcontainer.cap_drop, ['ALL']);
assert.deepEqual(devcontainer.cap_add, [
  'NET_ADMIN',
  'SETUID',
  'SETGID',
  'SETPCAP',
]);
assert.equal(Boolean(devcontainer.privileged), false);
assert.ok(devcontainer.security_opt.includes('no-new-privileges:true'));
assert.equal(devcontainer.network_mode, undefined);
assert.deepEqual(devcontainer.networks, { sandbox: null });
assert.equal(
  Array.isArray(devcontainer.entrypoint)
    ? devcontainer.entrypoint[0]
    : devcontainer.entrypoint,
  '/opt/secure-template/devcontainer-entrypoint',
);
assert.equal(
  devcontainer.volumes.some(({ source }) => source === '/var/run/docker.sock'),
  false,
);
assert.deepEqual(
  devcontainer.volumes
    .filter(({ source }) =>
      [
        'agent-session-history',
        'agent-session-data',
        'copilot-global-storage',
        'copilot-session-history',
      ].includes(source),
    )
    .map(({ source, target }) => ({ source, target })),
  [
    {
      source: 'agent-session-history',
      target: '/home/node/.vscode-server/data/User/workspaceStorage',
    },
    {
      source: 'agent-session-data',
      target: '/home/node/.vscode-server/data/agentSessionData',
    },
    {
      source: 'copilot-global-storage',
      target: '/home/node/.vscode-server/data/User/globalStorage',
    },
    {
      source: 'copilot-session-history',
      target: '/home/node/.copilot/session-state',
    },
  ],
);

assert.equal(proxy.read_only, true);
assert.deepEqual(proxy.cap_drop, ['ALL']);
assert.ok(proxy.security_opt.includes('no-new-privileges:true'));
assert.deepEqual(proxy.networks, { sandbox: null, egress: null });
assert.equal((proxy.ports ?? []).length, 0);

const dnsFilter = config.services['dns-filter'];
assert.equal(dnsFilter.read_only, true);
assert.deepEqual(dnsFilter.cap_drop, ['ALL']);
assert.deepEqual(dnsFilter.cap_add, ['NET_BIND_SERVICE']);
assert.ok(dnsFilter.security_opt.includes('no-new-privileges:true'));
assert.ok(dnsFilter.healthcheck.test.includes('--healthcheck'));
assert.deepEqual(devcontainer.depends_on['dns-filter'], {
  condition: 'service_healthy',
  required: true,
});

assert.equal(config.networks.sandbox.internal, true);

console.log('Resolved Compose security controls are intact.');
