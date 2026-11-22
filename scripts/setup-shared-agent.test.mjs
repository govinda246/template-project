import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  canonicalRepositoryUrl,
  setupSharedAgent,
  validateRepositoryUrl,
} from './setup-shared-agent.mjs';
import { loadSharedAgentPolicy } from './verify-shared-agent.mjs';

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

async function createSharedRepositoryFixture() {
  const fixture = await mkdtemp(path.join(tmpdir(), 'shared-agent-source-'));
  const source = path.join(fixture, 'source');
  const bare = path.join(fixture, 'shared-agent.git');
  await mkdir(path.join(source, 'agents'), { recursive: true });
  await mkdir(path.join(source, 'skills', 'demo'), { recursive: true });
  await mkdir(path.join(source, 'bin'), { recursive: true });
  await writeFile(path.join(source, 'copilot-instructions.md'), 'Shared\n');
  await writeFile(path.join(source, 'hooks.yml'), 'hooks: {}\n');
  await writeFile(path.join(source, 'agents', 'demo.agent.md'), 'agent\n');
  await writeFile(path.join(source, 'skills', 'demo', 'SKILL.md'), 'skill\n');
  await writeFile(path.join(source, 'bin', '.gitkeep'), '');
  git(fixture, ['init', '-b', 'main', source]);
  git(source, ['config', 'user.email', 'test@example.com']);
  git(source, ['config', 'user.name', 'Test']);
  git(source, ['add', '.']);
  git(source, ['commit', '-m', 'Add shared Agent contract']);
  git(fixture, ['clone', '--bare', source, bare]);
  return bare;
}

async function createProjectFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-agent-project-'));
  const bare = await createSharedRepositoryFixture();
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'protocol.file.allow', 'always']);
  const publicUrl = 'https://example.test/org/shared-agent';
  const gitConfigPath = path.join(path.dirname(root), 'shared-agent-test.gitconfig');
  await writeFile(
    gitConfigPath,
    `[url "${new URL(`file://${bare}`).href.replace(/\.git$/, '')}"]\n` +
      `\tinsteadOf = ${publicUrl}\n` +
      '[protocol "file"]\n' +
      '\tallow = always\n',
  );
  process.env.GIT_CONFIG_GLOBAL = gitConfigPath;
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  await mkdir(path.join(root, '.github'), { recursive: true });
  await writeFile(path.join(root, '.github/copilot-instructions.local.md'), 'Local\n');
  await writeFile(path.join(root, 'README.md'), 'project\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'Initial project']);
  return { root, publicUrl };
}

test('accepts HTTPS and SSH shared Agent repository URLs', () => {
  assert.equal(
    validateRepositoryUrl('https://github.com/example/shared-agent.git'),
    true,
  );
  assert.equal(
    validateRepositoryUrl('git@github.com:example/shared-agent.git'),
    true,
  );
});

test('rejects local and credential-bearing repository URLs', () => {
  assert.equal(validateRepositoryUrl('file:///tmp/shared-agent'), false);
  assert.equal(
    validateRepositoryUrl('https://token@github.com/example/shared-agent.git'),
    false,
  );
});

test('treats repository URLs with and without .git as equivalent', () => {
  assert.equal(
    canonicalRepositoryUrl('https://github.com/example/shared-agent.git'),
    canonicalRepositoryUrl('https://github.com/example/shared-agent'),
  );
});

test('is idempotent across .git URL spelling', async () => {
  const { root, publicUrl } = await createProjectFixture();

  const first = await setupSharedAgent(root, { url: `${publicUrl}.git` });
  const second = await setupSharedAgent(root, { url: publicUrl });

  assert.equal(first.commit, second.commit);
  assert.match(
    git(root, ['ls-files', '--stage', '--', '.github/shared']),
    /^160000 /,
  );
  assert.match(
    await readFile(path.join(root, '.github/copilot-instructions.md'), 'utf8'),
    /Local[\s\S]*Shared/,
  );
  assert.deepEqual(await loadSharedAgentPolicy(root), {
    path: '.github/shared',
    url: publicUrl,
    commit: first.commit,
  });
});

test('repairs a .gitmodules entry without a gitlink', async () => {
  const { root, publicUrl } = await createProjectFixture();
  await mkdir(path.join(root, '.github/shared'), { recursive: true });
  await writeFile(
    path.join(root, '.gitmodules'),
    `[submodule ".github/shared"]\n\tpath = .github/shared\n\turl = ${publicUrl}.git\n`,
  );

  await setupSharedAgent(root, { url: publicUrl });

  assert.match(
    git(root, ['ls-files', '--stage', '--', '.github/shared']),
    /^160000 /,
  );
  assert.equal(
    git(root, [
      'config',
      '--file',
      '.gitmodules',
      '--get',
      'submodule..github/shared.path',
    ]),
    '.github/shared',
  );
});

test('refuses a non-empty unregistered shared directory', async () => {
  const { root, publicUrl } = await createProjectFixture();
  await mkdir(path.join(root, '.github/shared'), { recursive: true });
  await writeFile(path.join(root, '.github/shared/untracked.txt'), 'keep');

  await assert.rejects(
    setupSharedAgent(root, { url: publicUrl }),
    /non-empty but is not registered/,
  );
  assert.equal(
    await readFile(path.join(root, '.github/shared/untracked.txt'), 'utf8'),
    'keep',
  );
});
