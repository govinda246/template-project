import { spawnSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SUBMODULE_PATH = '.github/shared';
const APPROVED_URL = 'https://github.com/govinda246/shared-agent.git';
const APPROVED_COMMIT = '6ef1b03d811aaa99fbebc80fda3f8a191246e639';
const REQUIRED_FILES = [
  'copilot-instructions.md',
  'hooks.yml',
];
const REQUIRED_DIRECTORIES = [
  'agents',
  'skills',
  'bin',
];
const FORBIDDEN_PATTERNS = [
  /chat\.tools\..*autoApprove["']?\s*[:=]\s*true/iu,
  /chat\.agent\.sandbox\.allowUnsandboxedCommands["']?\s*[:=]\s*true/iu,
  /chat\.agent\.sandbox\.network\.allowNetwork["']?\s*[:=]\s*true/iu,
  /ignore (?:all )?(?:previous|prior) instructions/iu,
  /(?:disable|bypass|override) (?:security|safety|sandbox|approval)/iu,
  /(?:curl|wget)[^\n]*(?:\|\s*(?:sh|bash)|--output|-o\s)/iu,
  /(?:rm\s+-rf\s+\/|chmod\s+777|sudo\s+)/iu,
];

export async function loadSharedAgentPolicy(root) {
  const policyPath = path.join(root, '.github/shared-agent-policy.json');
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  if (
    policy.path !== SUBMODULE_PATH ||
    typeof policy.url !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(policy.commit)
  ) {
    throw new Error(
      '.github/shared-agent-policy.json must contain the approved path, URL, and commit.',
    );
  }
  return policy;
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

function canonicalUrl(value) {
  return String(value).trim().replace(/\/$/, '').replace(/\.git$/, '');
}

function fileModeIsTrusted(sharedRoot) {
  const result = spawnSync(
    'git',
    ['config', '--bool', 'core.filemode'],
    { cwd: sharedRoot, encoding: 'utf8' },
  );
  if (result.status === 1) {
    return true;
  }
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || 'Unable to inspect shared Agent filemode handling.',
    );
  }
  return result.stdout.trim() === 'true';
}

function indexedFileModes(sharedRoot) {
  const output = git(sharedRoot, ['ls-files', '--stage', '-z']);
  const modes = new Map();
  for (const entry of output.split('\0')) {
    const match = /^(\d+)\s+[0-9a-f]+\s+0\t(.+)$/u.exec(entry);
    if (match) {
      modes.set(match[2], match[1]);
    }
  }
  return modes;
}

export function verifyPreCheckout(root, policy = {}) {
  const approvedUrl = policy.url ?? APPROVED_URL;
  const approvedCommit = policy.commit ?? APPROVED_COMMIT;
  const configuredPath = git(root, [
    'config',
    '--file',
    '.gitmodules',
    '--get',
    'submodule..github/shared.path',
  ]);
  const configuredUrl = git(root, [
    'config',
    '--file',
    '.gitmodules',
    '--get',
    'submodule..github/shared.url',
  ]);
  if (configuredPath !== SUBMODULE_PATH) {
    throw new Error(
      `Shared Agent path must be ${SUBMODULE_PATH}, got ${configuredPath}.`,
    );
  }
  if (canonicalUrl(configuredUrl) !== canonicalUrl(approvedUrl)) {
    throw new Error(
      `Shared Agent URL is not approved: ${configuredUrl}.`,
    );
  }

  const treeEntry = git(root, [
    'ls-tree',
    'HEAD',
    '--',
    SUBMODULE_PATH,
  ]);
  const [mode, type, commit] = treeEntry.split(/\s+/u);
  if (mode !== '160000' || type !== 'commit') {
    throw new Error(`${SUBMODULE_PATH} must be a mode-160000 gitlink.`);
  }
  if (commit !== approvedCommit) {
    throw new Error(
      `${SUBMODULE_PATH} gitlink must be pinned to ${approvedCommit}, got ${commit}.`,
    );
  }

  return { path: configuredPath, url: configuredUrl, commit };
}

async function walkFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (directory === root && entry.name === '.git') {
        continue;
      }
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Symlinks are not allowed in the shared Agent contract: ${path.relative(root, target)}.`,
        );
      }
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        files.push(target);
      }
    }
  }
  await visit(root);
  return files;
}

export async function verifyCheckedOutContract(root, policy = {}) {
  const sharedRoot = path.join(root, SUBMODULE_PATH);
  const actualCommit = git(root, ['rev-parse', 'HEAD'], sharedRoot);
  const approvedCommit = policy.commit ?? APPROVED_COMMIT;
  if (actualCommit !== approvedCommit) {
    throw new Error(
      `${SUBMODULE_PATH} is checked out at ${actualCommit}, expected ${approvedCommit}.`,
    );
  }

  for (const relativePath of [...REQUIRED_FILES, ...REQUIRED_DIRECTORIES]) {
    const target = path.join(sharedRoot, relativePath);
    const stats = await lstat(target).catch(() => null);
    if (!stats) {
      throw new Error(`${SUBMODULE_PATH}/${relativePath} is required.`);
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`${SUBMODULE_PATH}/${relativePath} must not be a symlink.`);
    }
    const expectedDirectory = REQUIRED_DIRECTORIES.includes(relativePath);
    if (stats.isDirectory() !== expectedDirectory) {
      throw new Error(
        `${SUBMODULE_PATH}/${relativePath} must be a ${expectedDirectory ? 'directory' : 'file'}.`,
      );
    }
  }

  const trustFileMode = fileModeIsTrusted(sharedRoot);
  const indexedModes = indexedFileModes(sharedRoot);
  for (const file of await walkFiles(sharedRoot)) {
    const relativePath = path.relative(sharedRoot, file);
    const stats = await lstat(file);
    const indexedMode = indexedModes.get(relativePath.split(path.sep).join('/'));
    if (!indexedMode) {
      throw new Error(
        `Untracked files are not allowed in the shared Agent contract: ${relativePath}.`,
      );
    }
    if (
      indexedMode === '100755' ||
      (trustFileMode && (stats.mode & 0o111) !== 0)
    ) {
      throw new Error(
        `Executable files are not allowed in the shared Agent contract: ${relativePath}.`,
      );
    }
    if (relativePath.startsWith(`bin${path.sep}`)) {
      if (path.basename(relativePath) !== '.gitkeep') {
        throw new Error(
          `Shared Agent bin directory must not contain executables: ${relativePath}.`,
        );
      }
      continue;
    }
    const contents = await readFile(file, 'utf8');
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(contents)) {
        throw new Error(
          `Forbidden shared Agent pattern found in ${relativePath}: ${pattern}.`,
        );
      }
    }
  }
}

export async function verifySharedAgent(root, { preCheckout = false } = {}) {
  const policy = await loadSharedAgentPolicy(root);
  const pre = verifyPreCheckout(root, policy);
  if (!preCheckout) {
    await verifyCheckedOutContract(root, policy);
  }
  return pre;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== '--pre-checkout')) {
    throw new Error('usage: node scripts/verify-shared-agent.mjs [--pre-checkout]');
  }
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  await verifySharedAgent(root, { preCheckout: args.includes('--pre-checkout') });
  console.log(
    args.includes('--pre-checkout')
      ? 'Shared Agent URL and gitlink are approved for checkout.'
      : 'Shared Agent checkout and contract are approved.',
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
