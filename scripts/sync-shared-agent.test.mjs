import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  syncSharedAgent,
  verifySharedAgentSync,
} from './sync-shared-agent.mjs';

test('merges local and shared instructions without copying Agents or Skills', async () => {
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
  await assert.rejects(
    readFile(path.join(root, '.github/agents/reviewer.agent.md')),
  );
  await assert.rejects(
    readFile(path.join(root, '.github/skills/demo/SKILL.md')),
  );
});

test('treats an empty shared directory as uninitialized', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-agent-test-'));
  await mkdir(path.join(root, '.github/shared'), { recursive: true });
  await writeFile(path.join(root, '.github/copilot-instructions.local.md'), 'Local\n');

  const result = await syncSharedAgent(root);

  assert.equal(result.sharedPresent, false);
  assert.equal(
    await readFile(path.join(root, '.github/copilot-instructions.md'), 'utf8'),
    'Local\n',
  );
});

test('removes legacy generated shared Agent and Skill files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-agent-test-'));
  await mkdir(path.join(root, '.github/agents'), { recursive: true });
  await mkdir(path.join(root, '.github/skills/shared-demo'), { recursive: true });
  await writeFile(path.join(root, '.github/copilot-instructions.local.md'), 'Local\n');
  await writeFile(path.join(root, '.github/agents/local.agent.md'), 'local');
  await writeFile(path.join(root, '.github/agents/shared-old.agent.md'), 'old');
  await writeFile(
    path.join(root, '.github/skills/shared-demo/SKILL.md'),
    'old',
  );

  const result = await syncSharedAgent(root);

  assert.deepEqual(result.files.sort(), [
    '.github/agents/shared-old.agent.md',
    '.github/skills/shared-demo',
  ]);
  await assert.rejects(
    readFile(path.join(root, '.github/agents/shared-old.agent.md')),
  );
  await assert.rejects(
    readFile(path.join(root, '.github/skills/shared-demo/SKILL.md')),
  );
  assert.equal(
    await readFile(path.join(root, '.github/agents/local.agent.md'), 'utf8'),
    'local',
  );
});

test('checks generated instructions without modifying the protected directory', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'shared-agent-test-'));
  await mkdir(path.join(root, '.github/shared'), { recursive: true });
  await writeFile(path.join(root, '.github/copilot-instructions.local.md'), 'Local\n');
  await writeFile(
    path.join(root, '.github/shared/copilot-instructions.md'),
    'Shared\n',
  );
  await syncSharedAgent(root);

  await assert.doesNotReject(verifySharedAgentSync(root));
  await writeFile(
    path.join(root, '.github/copilot-instructions.md'),
    'stale\n',
  );
  await assert.rejects(verifySharedAgentSync(root), /is stale/);
});
