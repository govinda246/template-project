import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  removeSharedAgent,
  setupSharedAgent,
  validateRepositoryUrl,
} from './setup-shared-agent.mjs';

const TEMPLATE_NAME = 'secure-phaser-template';
const TEMPLATE_TITLE = 'Secure Phaser Template';
const TEMPLATE_WORKSPACE = '/workspaces/github_agent_test';
const TEMPLATE_REPOSITORY = 'https://github.com/govinda246/template-project';
const TEMPLATE_PAGES = 'https://govinda246.github.io/template-project';
const TEMPLATE_ROOT_NAME = 'github_agent_test';

const replacedFiles = [
  'package.json',
  'package-lock.json',
  '.devcontainer/devcontainer.json',
  '.devcontainer/docker-compose.yml',
  '.devcontainer/Dockerfile',
  'index.html',
  'README.md',
];

export function normalizeProjectName(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function validateProjectName(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
}

export function displayNameFromSlug(slug) {
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseArgs(args) {
  const options = {
    name: '',
    displayName: '',
    repositoryUrl: '',
    sharedAgentUrl: '',
    allowDirty: false,
    dryRun: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--allow-dirty') {
      options.allowDirty = true;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--name') {
      options.name = args[++index] ?? '';
    } else if (argument === '--display-name') {
      options.displayName = args[++index] ?? '';
    } else if (argument === '--repository-url') {
      options.repositoryUrl = args[++index] ?? '';
    } else if (argument === '--shared-agent-url') {
      options.sharedAgentUrl = args[++index] ?? '';
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function runGit(root, args, options = {}) {
  return spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    ...options,
  });
}

function assertClean(root, allowDirty) {
  if (allowDirty) {
    return;
  }
  const gitDirectory = path.join(root, '.git');
  if (!existsSync(gitDirectory)) {
    return;
  }
  const head = runGit(root, ['rev-parse', '--verify', 'HEAD']);
  if (head.status !== 0) {
    const staged = runGit(root, ['diff', '--cached', '--quiet']);
    if (staged.status === 0) {
      return;
    }
    throw new Error(
      'A fresh repository must not contain staged files before initialization.',
    );
  }
  const status = runGit(root, ['status', '--porcelain', '--untracked-files=all']);
  if (status.status !== 0) {
    throw new Error(status.stderr.trim() || 'Unable to inspect Git status.');
  }
  if (status.stdout.trim()) {
    throw new Error(
      'The worktree must be clean before initialization. Commit or stash changes, or pass --allow-dirty only after review.',
    );
  }
}

function repositoryLine(repositoryUrl) {
  if (!repositoryUrl) {
    return 'TypeScript, Vite, Phaser 3 を使う2Dブラウザーゲームプロジェクトです。';
  }
  return `TypeScript, Vite, Phaser 3 を使う2Dブラウザーゲームプロジェクトです。リポジトリ: [GitHub](${repositoryUrl})`;
}

function normalizeRepositoryUrl(value) {
  const candidate = String(value ?? '').trim();
  if (!candidate) {
    return '';
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Repository URL must be a valid GitHub HTTPS URL.');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'github.com' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Repository URL must be a GitHub HTTPS URL without credentials.');
  }
  const pathname = parsed.pathname
    .replace(/\.git$/, '')
    .replace(/^\/|\/$/g, '');
  if (!/^[^/]+\/[^/]+$/.test(pathname)) {
    throw new Error('Repository URL must identify an owner and repository.');
  }
  return `https://github.com/${pathname}`;
}

function replaceTemplateIdentity(contents, options) {
  let next = contents
    .replaceAll(TEMPLATE_REPOSITORY, options.repositoryUrl)
    .replaceAll(TEMPLATE_PAGES, '')
    .replaceAll(TEMPLATE_NAME, options.name)
    .replaceAll(TEMPLATE_TITLE, options.displayName)
    .replaceAll(TEMPLATE_ROOT_NAME, options.name)
    .replaceAll(TEMPLATE_WORKSPACE, `/workspaces/${options.name}`);

  next = next.replace(
    /^初心者向け概要は.*?`docs\/`.*?自動公開されます。\n\n/m,
    '',
  );

  return next;
}

async function repositoryUrlFromOrigin(root) {
  const result = runGit(root, ['remote', 'get-url', 'origin']);
  if (result.status !== 0) {
    return '';
  }
  const origin = result.stdout.trim();
  if (origin === TEMPLATE_REPOSITORY || origin === `${TEMPLATE_REPOSITORY}.git`) {
    return '';
  }
  const httpsMatch = origin.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/,
  );
  if (httpsMatch) {
    return `https://github.com/${httpsMatch[1]}`;
  }
  const sshMatch = origin.match(/^git@github\.com:([^/]+\/.+?)(?:\.git)?$/);
  return sshMatch ? `https://github.com/${sshMatch[1]}` : '';
}

async function collectTemplateResidue(root, writes, removals) {
  const planned = new Map(writes.map(({ target, updated }) => [target, updated]));
  const removalRoots = removals.map((target) => path.resolve(target));
  const ignored = new Set(['.git', 'node_modules', 'dist', 'tmp', '.vite', 'coverage']);
  const ignoredFiles = new Set([
    path.join(root, 'scripts/init-project.mjs'),
    path.join(root, 'scripts/init-project.test.mjs'),
  ]);
  const residue = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const resolvedTarget = path.resolve(target);
      if (
        ignored.has(entry.name) ||
        removalRoots.some(
          (removalRoot) =>
            resolvedTarget === removalRoot ||
            resolvedTarget.startsWith(`${removalRoot}${path.sep}`),
        )
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile() && !ignoredFiles.has(target)) {
        let contents;
        if (planned.has(target)) {
          contents = planned.get(target);
        } else {
          try {
            contents = await readFile(target, 'utf8');
          } catch {
            continue;
          }
        }
        if (
          [TEMPLATE_NAME, TEMPLATE_TITLE, TEMPLATE_WORKSPACE, TEMPLATE_REPOSITORY, TEMPLATE_PAGES, TEMPLATE_ROOT_NAME]
            .some((marker) => contents.includes(marker))
        ) {
          residue.push(path.relative(root, target));
        }
      }
    }
  }

  await visit(root);
  return residue;
}

export async function initializeProject(root, options) {
  const normalized = normalizeProjectName(options.name);
  if (!validateProjectName(normalized)) {
    throw new Error(
      'Project name must contain 1-64 lowercase letters, numbers, or single hyphens.',
    );
  }

  const completeOptions = {
    ...options,
    name: normalized,
    displayName: options.displayName?.trim() || displayNameFromSlug(normalized),
    repositoryUrl: normalizeRepositoryUrl(options.repositoryUrl),
    sharedAgentUrl: String(options.sharedAgentUrl ?? '').trim(),
  };
  if (
    !completeOptions.displayName ||
    completeOptions.displayName.length > 80 ||
    /[\u0000-\u001f\u007f]/.test(completeOptions.displayName)
  ) {
    throw new Error('Display name must be 1-80 characters without control characters.');
  }
  if (
    completeOptions.sharedAgentUrl &&
    !validateRepositoryUrl(completeOptions.sharedAgentUrl)
  ) {
    throw new Error('Shared Agent URL must be a valid HTTPS or SSH Git repository URL.');
  }
  assertClean(root, completeOptions.allowDirty);

  const writes = [];
  for (const relativePath of replacedFiles) {
    const target = path.join(root, relativePath);
    const original = await readFile(target, 'utf8');
    const updated = replaceTemplateIdentity(original, completeOptions);
    writes.push({ target, updated });
  }

  const readmePath = path.join(root, 'README.md');
  const readme = writes.find(({ target }) => target === readmePath);
  readme.updated = readme.updated.replace(
    /^TypeScript、Vite、Phaser 3.*?\n/m,
    `${repositoryLine(completeOptions.repositoryUrl)}\n`,
  );

  const gameScene = path.join(root, 'src/scenes/GameScene.ts');
  const sceneContents = `import Phaser from 'phaser';

export class GameScene extends Phaser.Scene {
  constructor() {
    super('game');
  }

  create(): void {
    this.add
      .text(this.scale.width / 2, this.scale.height / 2, ${JSON.stringify(completeOptions.displayName)}, {
        align: 'center',
        color: '#f5f7ff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: '32px',
      })
      .setOrigin(0.5);
  }
}
`;
  writes.push({ target: gameScene, updated: sceneContents });

  const removals = [
    path.join(root, 'docs'),
    path.join(root, 'src/game'),
    path.join(root, '.github/workflows/pages.yml'),
  ];
  const residue = await collectTemplateResidue(root, writes, removals);
  if (residue.length) {
    throw new Error(
      `Template-specific data remains after the planned initialization: ${residue.join(', ')}`,
    );
  }

  if (completeOptions.dryRun) {
    return {
      name: completeOptions.name,
      displayName: completeOptions.displayName,
      sharedAgentUrl: completeOptions.sharedAgentUrl,
      writes: writes.map(({ target }) => path.relative(root, target)),
      removals: removals.map((target) => path.relative(root, target)),
    };
  }

  for (const { target, updated } of writes) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, updated);
  }
  for (const target of removals) {
    await rm(target, { recursive: true, force: true });
  }
  if (completeOptions.sharedAgentUrl) {
    await setupSharedAgent(root, {
      url: completeOptions.sharedAgentUrl,
      replaceExisting: true,
    });
  } else if (existsSync(path.join(root, '.git'))) {
    await removeSharedAgent(root, { force: true });
  }

  return {
    name: completeOptions.name,
    displayName: completeOptions.displayName,
    sharedAgentUrl: completeOptions.sharedAgentUrl,
    writes: writes.map(({ target }) => path.relative(root, target)),
    removals: removals.map((target) => path.relative(root, target)),
  };
}

async function promptForValue(question) {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.name) {
    options.name = await promptForValue('New project name (lowercase kebab-case): ');
  }
  if (
    process.stdin.isTTY &&
    !options.sharedAgentUrl &&
    !process.argv.slice(2).includes('--shared-agent-url')
  ) {
    options.sharedAgentUrl = await promptForValue(
      'Shared Agent repository URL (optional, press Enter to skip): ',
    );
  }

  const root = path.resolve(
    fileURLToPath(new URL('..', import.meta.url)),
  );
  options.repositoryUrl ||= await repositoryUrlFromOrigin(root);
  const result = await initializeProject(root, options);
  console.log(
    `${options.dryRun ? 'Would initialize' : 'Initialized'} ${result.displayName} (${result.name}).`,
  );
  console.log(`Updated ${result.writes.length} files and removed ${result.removals.length} template paths.`);
  if (!options.dryRun) {
    console.log('Review the diff, then run the secure test, build, and Agent sync checks.');
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
