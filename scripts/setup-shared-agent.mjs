import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { syncSharedAgent } from './sync-shared-agent.mjs';

const SUBMODULE_PATH = '.github/shared';

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
  return (
    /^https:\/\/[A-Za-z0-9.-]+\/.+/.test(value) ||
    /^git@[A-Za-z0-9.-]+:.+/.test(value)
  );
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed.`);
  }
  return result.stdout.trim();
}

function configuredSubmoduleUrl(root) {
  const result = spawnSync('git', [
    'config',
    '--file',
    '.gitmodules',
    '--get-regexp',
    '^submodule\\..*\\.path$',
  ], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status === 1) {
    return '';
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'Unable to inspect .gitmodules.');
  }
  const entries = result.stdout.trim().split(/\r?\n/);
  const pathEntry = entries.find((entry) => entry.trim().endsWith(` ${SUBMODULE_PATH}`));
  if (!pathEntry) {
    return '';
  }
  const pathKey = pathEntry.slice(0, pathEntry.indexOf(' '));
  return git(root, [
    'config',
    '--file',
    '.gitmodules',
    '--get',
    pathKey.replace(/\.path$/, '.url'),
  ]);
}

function assertCleanWorktree(root) {
  const status = git(root, [
    'status',
    '--porcelain',
    '--untracked-files=all',
  ]);
  if (status) {
    throw new Error(
      'Commit or stash worktree changes before adding the shared Agent submodule.',
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!validateRepositoryUrl(options.url)) {
    throw new Error(
      'usage: npm run setup-shared-agent -- --url <https-or-ssh-repository> [--branch <branch>]',
    );
  }

  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  assertCleanWorktree(root);
  const target = path.join(root, SUBMODULE_PATH);
  const gitmodulesPath = path.join(root, '.gitmodules');
  const configuredUrl = (await pathExists(gitmodulesPath))
    ? configuredSubmoduleUrl(root)
    : '';
  if (configuredUrl) {
    if (configuredUrl !== options.url) {
      throw new Error(
        `${SUBMODULE_PATH} is already configured for ${configuredUrl}; no URL was changed.`,
      );
    }
    git(root, ['submodule', 'update', '--init', '--recursive', SUBMODULE_PATH]);
  } else {
    if (await pathExists(target)) {
      throw new Error(
        `${SUBMODULE_PATH} already exists but is not registered in .gitmodules.`,
      );
    }
    const argumentsList = ['submodule', 'add'];
    if (options.branch) {
      argumentsList.push('--branch', options.branch);
    }
    argumentsList.push(options.url, SUBMODULE_PATH);
    git(root, argumentsList);
  }

  const synced = await syncSharedAgent(root);
  console.log(`Shared Agent ready at ${SUBMODULE_PATH}.`);
  console.log(`Synchronized ${synced.files.length} generated Agent files.`);
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
