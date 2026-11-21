import assert from 'node:assert/strict';
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
  const root = await mkdtemp(path.join(tmpdir(), 'project-init-test-'));
  const packageName = ['secure', 'phaser', 'template'].join('-');
  const templateTitle = ['Secure', 'Phaser', 'Template'].join(' ');
  const templateRoot = ['github', 'agent', 'test'].join('_');
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
      `# ${templateTitle}\n\nTypeScript, Vite, Phaser sample.\n\n初心者向け概要は [GitHub](${templateRepository}) にあります。` +
      '`docs/` を更新すると、GitHub Actionsで自動公開されます。\n',
    'docs/index.html': 'template',
    '.github/workflows/pages.yml': 'pages',
    'src/scenes/GameScene.ts': 'old scene',
    'src/game/player.ts': 'sample player',
  };
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }

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
  await assert.rejects(readFile(path.join(root, 'src/game/player.ts')));
  await assert.rejects(readFile(path.join(root, 'docs/index.html')));
});
