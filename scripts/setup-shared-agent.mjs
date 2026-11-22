import { spawnSync } from 'node:child_process';
import { access, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { syncSharedAgent } from './sync-shared-agent.mjs';

const SUBMODULE_PATH = '.github/shared';
const POLICY_PATH = '.github/shared-agent-policy.json';

function parseArgs(args) {
  const options = { url: '', branch: '' };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--url') {
      options.url = args[++index] ?? '';
    } else if (argument === '--branch') {
      options.branch = args[++index] ?? '';
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

export function validateRepositoryUrl(value) {
  if (typeof value !== 'string') {
    return false;
  }
  if (/^git@[A-Za-z0-9.-]+:[^/].+/.test(value)) {
    return true;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      parsed.pathname.length > 1
    );
  } catch {
    return false;
  }
}

export function canonicalRepositoryUrl(value) {
  return String(value ?? '').trim().replace(/\/$/, '').replace(/\.git$/, '');
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function git(root, args, cwd = root) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
  }
  return result.stdout.trim();
}

function configuredSubmodule(root) {
  const result = spawnSync(
    'git',
    [
      'config',
      '--file',
      '.gitmodules',
      '--get-regexp',
      '^submodule\\..*\\.path$',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status === 1) {
    return undefined;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Unable to inspect .gitmodules.');
  }
  const pathEntry = result.stdout
    .trim()
    .split(/\r?\n/)
    .find((entry) => entry.trim().endsWith(` ${SUBMODULE_PATH}`));
  if (!pathEntry) {
    return undefined;
  }
  const pathKey = pathEntry.slice(0, pathEntry.indexOf(' '));
  const name = pathKey.slice('submodule.'.length, -'.path'.length);
  return {
    name,
    url: git(root, [
      'config',
      '--file',
      '.gitmodules',
      '--get',
      pathKey.replace(/\.path$/, '.url'),
    ]),
  };
}

function gitlinkExists(root) {
  const result = spawnSync(
    'git',
    ['ls-files', '--stage', '--', SUBMODULE_PATH],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Unable to inspect the shared Agent gitlink.');
  }
  return result.stdout.startsWith('160000 ');
}

async function directoryIsEmpty(target) {
  return (await readdir(target)).length === 0;
}

export async function verifySharedAgentContract(root) {
  for (const requiredPath of [
    'copilot-instructions.md',
    'hooks.yml',
  ]) {
    if (!(await pathExists(path.join(root, SUBMODULE_PATH, requiredPath)))) {
      throw new Error(
        `${SUBMODULE_PATH}/${requiredPath} is required by the shared Agent contract.`,
      );
    }
  }
  for (const requiredPath of ['agents', 'skills', 'bin']) {
    const target = path.join(root, SUBMODULE_PATH, requiredPath);
    if (!(await pathExists(target)) || !(await stat(target)).isDirectory()) {
      throw new Error(
        `${SUBMODULE_PATH}/${requiredPath} is required by the shared Agent contract.`,
      );
    }
  }
}

async function removeSubmoduleRegistration(root, registration) {
  const target = path.join(root, SUBMODULE_PATH);
  if (gitlinkExists(root)) {
    if (registration) {
      git(root, ['submodule', 'deinit', '--force', '--', SUBMODULE_PATH]);
    }
    git(root, ['rm', '--force', '--', SUBMODULE_PATH]);
  } else {
    await rm(target, { recursive: true, force: true });
  }

  if (
    registration &&
    (await pathExists(path.join(root, '.gitmodules')))
  ) {
    const removeSection = spawnSync(
      'git',
      [
        'config',
        '--file',
        '.gitmodules',
        '--remove-section',
        `submodule.${registration.name}`,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    if (removeSection.status !== 0 && removeSection.status !== 5) {
      throw new Error(
        removeSection.stderr.trim() || 'Unable to remove the shared Agent registration.',
      );
    }
  }

  const gitmodulesPath = path.join(root, '.gitmodules');
  if (await pathExists(gitmodulesPath)) {
    const remaining = spawnSync(
      'git',
      ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\.'],
      { cwd: root, encoding: 'utf8' },
    );
    if (remaining.status === 1) {
      await rm(gitmodulesPath, { force: true });
    } else if (remaining.status !== 0) {
      throw new Error(remaining.stderr.trim() || 'Unable to inspect .gitmodules.');
    }
  }
}

export async function setupSharedAgent(root, options) {
  const url = String(options.url ?? '').trim();
  if (!validateRepositoryUrl(url)) {
    throw new Error('A valid HTTPS or SSH shared Agent repository URL is required.');
  }

  const target = path.join(root, SUBMODULE_PATH);
  const gitmodulesPath = path.join(root, '.gitmodules');
  const registration = (await pathExists(gitmodulesPath))
    ? configuredSubmodule(root)
    : undefined;
  const hasGitlink = gitlinkExists(root);
  const sameUrl =
    registration &&
    canonicalRepositoryUrl(registration.url) === canonicalRepositoryUrl(url);
  const targetExists = await pathExists(target);

  if (registration && !sameUrl && !options.replaceExisting) {
    throw new Error(
      `${SUBMODULE_PATH} is already configured for ${registration.url}; no URL was changed.`,
    );
  }
  if (!registration && hasGitlink && !options.replaceExisting) {
    throw new Error(
      `${SUBMODULE_PATH} has a gitlink but is not registered in .gitmodules.`,
    );
  }
  if ((registration && (!sameUrl || !hasGitlink)) ||
      (!registration && hasGitlink)) {
    await removeSubmoduleRegistration(root, registration);
  } else if (!registration && targetExists) {
    if (!(await directoryIsEmpty(target)) && !options.replaceExisting) {
      throw new Error(
        `${SUBMODULE_PATH} is non-empty but is not registered in .gitmodules.`,
      );
    }
    await rm(target, { recursive: true, force: true });
  }

  if (!sameUrl || !hasGitlink || !registration) {
    const argumentsList = ['submodule', 'add'];
    if (options.branch) {
      argumentsList.push('--branch', options.branch);
    }
    argumentsList.push(url, SUBMODULE_PATH);
    git(root, argumentsList);
  } else {
    git(root, ['submodule', 'update', '--init', '--recursive', SUBMODULE_PATH]);
  }

  await verifySharedAgentContract(root);
  const commit = git(root, ['rev-parse', 'HEAD'], target);
  await writeFile(
    path.join(root, POLICY_PATH),
    `${JSON.stringify({
      path: SUBMODULE_PATH,
      url,
      commit,
    }, null, 2)}\n`,
  );
  const synced = await syncSharedAgent(root);
  return {
    path: SUBMODULE_PATH,
    instructions: synced.instructions,
    commit,
  };
}

export async function removeSharedAgent(root, options = {}) {
  const gitmodulesPath = path.join(root, '.gitmodules');
  const registration = (await pathExists(gitmodulesPath))
    ? configuredSubmodule(root)
    : undefined;
  const target = path.join(root, SUBMODULE_PATH);
  if (registration || gitlinkExists(root)) {
    await removeSubmoduleRegistration(root, registration);
  } else if (await pathExists(target)) {
    if (!(await directoryIsEmpty(target)) && !options.force) {
      throw new Error(
        `${SUBMODULE_PATH} is non-empty but is not registered in .gitmodules.`,
      );
    }
    await rm(target, { recursive: true, force: true });
  }
  await rm(path.join(root, POLICY_PATH), { force: true });
  await syncSharedAgent(root);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!validateRepositoryUrl(options.url)) {
    throw new Error(
      'usage: npm run setup-shared-agent -- --url <https-or-ssh-repository> [--branch <branch>]',
    );
  }

  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const synced = await setupSharedAgent(root, options);
  console.log(`Shared Agent ready at ${SUBMODULE_PATH}.`);
  console.log(`Synchronized ${synced.instructions}.`);
  console.log('Review the .gitmodules and submodule commit before committing.');
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
