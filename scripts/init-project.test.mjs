import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  displayNameFromSlug,
  initializeProject,
  normalizeProjectName,
  validateProjectName,
} from './init-project.mjs';

async function createProjectFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'project-init-test-'));
  const packageName = ['secure', 'phaser', 'template'].join('-');
  const templateTitle = ['Secure', 'Phaser', 'Template'].join(' ');
  const templateRoot = 'template-project';
  const templateRepository = [
    'https://github.com',
    ['govinda246', 'template-project'].join('/'),
  ].join('/');
  const files = {
    'package.json': JSON.stringify({ name: packageName }),
    'package-lock.json': JSON.stringify({
      name: packageName,
      packages: { '': { name: packageName } },
    }),
    '.devcontainer/devcontainer.json':
      JSON.stringify({ workspaceFolder: `/workspaces/${templateRoot}` }),
    '.devcontainer/docker-compose.yml':
      `name: ${packageName}\nsource: /workspaces/${templateRoot}`,
    '.devcontainer/Dockerfile':
      `ENV SECURE_PROJECT_ROOT=/workspaces/${templateRoot}`,
    'index.html': `<title>${templateTitle}</title>`,
    'README.md':
      `# ${templateTitle}\n\nTypeScript, Vite, Phaser sample.\n\nゲームはVS Codeのポートビューで確認できます。egress proxyを通して\`sandbox\`ネットワーク内のViteへ転送されます。ゲーム本体は外部通信しません。\n\n初心者向け概要は [GitHub](${templateRepository}) にあります。` +
      '`docs/` を更新すると、GitHub Actionsで自動公開されます。\n',
    'docs/index.html': 'template',
    '.github/workflows/pages.yml': 'pages',
    '.github/copilot-instructions.local.md': 'Local instructions\n',
    'src/scenes/GameScene.ts': 'old scene',
    'src/game/player.ts': 'sample player',
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return root;
}

test('normalizes project input to a package-safe slug', () => {
  assert.equal(normalizeProjectName('  My New_Game  '), 'my-new-game');
  assert.equal(displayNameFromSlug('my-new-game'), 'My New Game');
});

test('rejects unsafe project names', () => {
  assert.equal(validateProjectName('safe-project-2'), true);
  assert.equal(validateProjectName('../escape'), false);
  assert.equal(validateProjectName('-leading'), false);
  assert.equal(validateProjectName('UPPERCASE'), false);
});

test('updates project identity and removes sample template content', async () => {
  const root = await createProjectFixture();

  await initializeProject(root, {
    name: 'My New_Game',
    displayName: '',
    repositoryUrl: '',
    allowDirty: true,
    dryRun: false,
  });

  assert.match(await readFile(path.join(root, 'package.json'), 'utf8'), /my-new-game/);
  assert.match(
    await readFile(path.join(root, '.devcontainer/devcontainer.json'), 'utf8'),
    /\/workspaces\/my-new-game/,
  );
  assert.match(
    await readFile(path.join(root, 'src/scenes/GameScene.ts'), 'utf8'),
    /My New Game/,
  );
  assert.doesNotMatch(
    await readFile(path.join(root, '.devcontainer/docker-compose.yml'), 'utf8'),
    /\bports:/,
  );
  await assert.rejects(readFile(path.join(root, 'src/game/player.ts')));
  await assert.rejects(readFile(path.join(root, 'docs/index.html')));
});

async function createSharedRepositoryFixture() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'init-shared-source-'));
  const source = path.join(fixture, 'source');
  const bare = path.join(fixture, 'shared-agent.git');
  await mkdir(path.join(source, 'agents'), { recursive: true });
  await mkdir(path.join(source, 'skills', 'demo'), { recursive: true });
  await mkdir(path.join(source, 'bin'), { recursive: true });
  await writeFile(path.join(source, 'copilot-instructions.md'), 'Shared instructions\n');
  await writeFile(path.join(source, 'hooks.yml'), 'hooks: {}\n');
  await writeFile(path.join(source, 'agents', 'demo.agent.md'), 'agent\n');
  await writeFile(path.join(source, 'skills', 'demo', 'SKILL.md'), 'skill\n');
  await writeFile(path.join(source, 'bin', '.gitkeep'), '');
  git(source, ['init', '-b', 'main']);
  git(source, ['config', 'user.email', 'test@example.com']);
  git(source, ['config', 'user.name', 'Test']);
  git(source, ['add', '.']);
  git(source, ['commit', '-m', 'Shared contract']);
  git(fixture, ['clone', '--bare', source, bare]);
  return bare;
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(
    result.status,
    0,
    result.stderr.trim() || `git ${args.join(' ')} failed`,
  );
  return result.stdout.trim();
}

test('Initialize project completes shared Agent setup in one run', async () => {
  const root = await createProjectFixture();
  const bare = await createSharedRepositoryFixture();
  const publicUrl = 'https://example.test/org/shared-agent';
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'protocol.file.allow', 'always']);
  const gitConfigPath = path.join(path.dirname(root), 'init-shared-agent-test.gitconfig');
  await writeFile(
    gitConfigPath,
    `[url "${new URL(`file://${bare}`).href.replace(/\.git$/, '')}"]\n` +
      `\tinsteadOf = ${publicUrl}\n` +
      '[protocol "file"]\n' +
      '\tallow = always\n',
  );
  process.env.GIT_CONFIG_GLOBAL = gitConfigPath;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'Template baseline']);

  await initializeProject(root, {
    name: 'integrated-project',
    repositoryUrl: 'https://github.com/example/integrated-project',
    sharedAgentUrl: `${publicUrl}.git`,
    allowDirty: true,
  });

  assert.match(
    git(root, ['ls-files', '--stage', '--', '.github/shared']),
    /^160000 /,
  );
  assert.match(
    await readFile(path.join(root, '.github/copilot-instructions.md'), 'utf8'),
    /Local instructions[\s\S]*Shared instructions/,
  );
  assert.match(
    await readFile(path.join(root, '.devcontainer/devcontainer.json'), 'utf8'),
    /\/workspaces\/integrated-project/,
  );
  assert.match(
    await readFile(path.join(root, 'README.md'), 'utf8'),
    /github\.com\/example\/integrated-project/,
  );
});

test('Initialize project task forwards the optional shared Agent URL', async () => {
  const tasksPath = new URL('../.vscode/tasks.json', import.meta.url);
  const tasks = JSON.parse(await readFile(tasksPath, 'utf8'));
  const initialization = tasks.tasks.find(({ label }) => label === 'Initialize project');

  assert.deepEqual(initialization.args.slice(-2), [
    '--shared-agent-url',
    '${input:sharedAgentRepository}',
  ]);
});
