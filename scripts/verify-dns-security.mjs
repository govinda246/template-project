import { spawnSync } from 'node:child_process';
import process from 'node:process';

const compose = ['compose', '-f', '.devcontainer/docker-compose.yml'];

function run(args, options = {}) {
  const result = spawnSync('docker', [...compose, ...args], {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '');
    throw new Error(`docker ${args.join(' ')} failed with status ${result.status}`);
  }
  return result;
}

try {
  run(['up', '--build', '--detach', 'devcontainer', 'egress-proxy']);
  run([
    'exec',
    '-T',
    '--user',
    'node',
    'devcontainer',
    'node',
    '/workspaces/template-project/.devcontainer/dns-integration-probe.mjs',
  ]);
} finally {
  const down = spawnSync('docker', [...compose, 'down', '--remove-orphans'], {
    stdio: 'inherit',
  });
  if (down.error || down.status !== 0) {
    console.error('Unable to clean up the DNS integration test Compose stack.');
  }
}
