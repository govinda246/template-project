import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export function parseEgressDeniedLogs(output) {
  const events = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /egress-proxy: 403 denied CONNECT (\S+)/u.exec(line);
    if (match) {
      events.push({ line, destination: match[1] });
    }
  }
  return events;
}

function parseArgs(args) {
  let since = '24h';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--since') {
      since = args[++index] ?? '';
      if (!since) {
        throw new Error('--since requires a duration or timestamp.');
      }
    } else {
      throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  return { since };
}

export function runAudit({ since = '24h', cwd = process.cwd() } = {}) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      '.devcontainer/docker-compose.yml',
      'logs',
      '--no-color',
      '--timestamps',
      '--since',
      since,
      'egress-proxy',
    ],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  if (result.error?.code === 'ENOENT') {
    throw new Error('Docker CLI is required to audit egress proxy logs.');
  }
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || 'Unable to read egress proxy logs.',
    );
  }

  const events = parseEgressDeniedLogs(
    `${result.stdout}\n${result.stderr}`,
  );
  if (events.length === 0) {
    console.log(`No denied CONNECT events found since ${since}.`);
    return events;
  }

  const destinations = new Map();
  for (const event of events) {
    destinations.set(
      event.destination,
      (destinations.get(event.destination) ?? 0) + 1,
    );
  }
  console.log(`Denied CONNECT events since ${since}: ${events.length}`);
  for (const [destination, count] of [...destinations].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    console.log(`${String(count).padStart(4, ' ')}  ${destination}`);
  }
  console.log('\nRecent events:');
  for (const event of events.slice(-100)) {
    console.log(event.line);
  }
  return events;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  runAudit(options);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
