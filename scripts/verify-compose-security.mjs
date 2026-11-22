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
assert.equal(Boolean(devcontainer.privileged), false);
assert.ok(devcontainer.security_opt.includes('no-new-privileges:true'));
assert.equal(devcontainer.network_mode, undefined);
assert.deepEqual(devcontainer.networks, { sandbox: null });
assert.equal(
  devcontainer.volumes.some(({ source }) => source === '/var/run/docker.sock'),
  false,
);

assert.equal(proxy.read_only, true);
assert.deepEqual(proxy.cap_drop, ['ALL']);
assert.ok(proxy.security_opt.includes('no-new-privileges:true'));
assert.deepEqual(proxy.networks, { sandbox: null, egress: null });
assert.equal(
  proxy.ports.some(
    ({ host_ip, published, target }) =>
      Number(published) >= 1024 &&
      Number(published) <= 65535 &&
      host_ip === '127.0.0.1' &&
      target === 3000,
  ),
  true,
);

assert.equal(config.networks.sandbox.internal, true);

console.log('Resolved Compose security controls are intact.');
