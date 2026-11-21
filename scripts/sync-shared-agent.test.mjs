import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { syncSharedAgent } from './sync-shared-agent.mjs';

test('merges local and shared instructions and exposes shared files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-agent-test-'));
  await mkdir(path.join(root, '.github/shared/agents'), { recursive: true });
  await mkdir(path.join(root, '.github/shared/bin'), { recursive: true });
  await mkdir(path.join(root, '.github/shared/skills/demo'), { recursive: true });
  await writeFile(path.join(root, '.github/copilot-instructions.local.md'), 'Local\n');
  await writeFile(
    path.join(root, '.github/shared/copilot-instructions.md'),
    'Shared\n',
  );
  await writeFile(path.join(root, '.github/shared/hooks.yml'), 'hooks: {}\n');
  await writeFile(
    path.join(root, '.github/shared/agents/reviewer.agent.md'),
    'agent',
  );
  await writeFile(
    path.join(root, '.github/shared/skills/demo/SKILL.md'),
    'skill',
  );

  const result = await syncSharedAgent(root);
  const instructions = await readFile(
    path.join(root, '.github/copilot-instructions.md'),
    'utf8',
  );

  assert.equal(result.sharedPresent, true);
  assert.match(instructions, /Local/);
  assert.match(instructions, /Shared/);
  assert.deepEqual(result.files, []);
});

test('rejects a shared repository without the required bin directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-agent-test-'));
  await mkdir(path.join(root, '.github/shared/agents'), { recursive: true });
  await mkdir(path.join(root, '.github/shared/skills'), { recursive: true });
  await writeFile(path.join(root, '.github/copilot-instructions.local.md'), 'Local\n');
  await writeFile(
    path.join(root, '.github/shared/copilot-instructions.md'),
    'Shared\n',
  );
  await writeFile(path.join(root, '.github/shared/hooks.yml'), 'hooks: {}\n');

  await assert.rejects(syncSharedAgent(root), /\/bin is required/);
});
