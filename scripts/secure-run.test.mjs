import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const projectRoot = new URL('../', import.meta.url);

test('trusted runners do not add shared Agent executables to PATH', async () => {
  for (const relativePath of ['scripts/secure-run', 'scripts/local-secure-run.sh']) {
    const source = await readFile(new URL(relativePath, projectRoot), 'utf8');
    assert.doesNotMatch(source, /\.github\/shared\/bin/);
  }
});

test('secure validation tasks always run offline', async () => {
  const tasks = JSON.parse(
    await readFile(new URL('.vscode/tasks.json', projectRoot), 'utf8'),
  );

  for (const label of ['secure: typecheck', 'secure: test', 'secure: build']) {
    const task = tasks.tasks.find((candidate) => candidate.label === label);
    assert.ok(task, `missing task: ${label}`);
    assert.equal(task.args[0], '--offline', `${label} must run offline`);
  }
});

test('development server remains an explicit online exception', async () => {
  const tasks = JSON.parse(
    await readFile(new URL('.vscode/tasks.json', projectRoot), 'utf8'),
  );
  const task = tasks.tasks.find(
    ({ label }) => label === 'dev server (Dev Container only)',
  );

  assert.ok(task);
  assert.equal(task.args[0], 'npm');
  assert.equal(task.args.includes('--offline'), false);
});

test('Dev Container trusts the workspace and only checks generated instructions', async () => {
  const dockerfile = await readFile(
    new URL('.devcontainer/Dockerfile', projectRoot),
    'utf8',
  );
  const devcontainer = JSON.parse(
    (await readFile(
      new URL('.devcontainer/devcontainer.json', projectRoot),
      'utf8',
    )).replace(/^\s*\/\/.*$/gmu, ''),
  );

  assert.match(
    dockerfile,
    /git config --system --replace-all safe\.directory \/workspaces\/template-project/,
  );
  assert.match(
    devcontainer.postCreateCommand,
    /sync-shared-agent\.mjs --check/,
  );
  assert.doesNotMatch(
    devcontainer.postCreateCommand,
    /sync-shared-agent\.mjs(?!"? --check)/u,
  );
});
