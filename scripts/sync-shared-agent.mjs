import {
  access,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SHARED_ROOT = '.github/shared';
const GENERATED_INSTRUCTIONS = '.github/copilot-instructions.md';
const LOCAL_INSTRUCTIONS = '.github/copilot-instructions.local.md';

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function removeLegacyGeneratedFiles(root) {
  const removed = [];
  for (const relativeRoot of ['.github/agents', '.github/skills']) {
    const directory = path.join(root, relativeRoot);
    if (!(await pathExists(directory))) {
      continue;
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.name.startsWith('shared-')) {
        continue;
      }
      const target = path.join(directory, entry.name);
      await rm(target, { recursive: true, force: true });
      removed.push(path.relative(root, target));
    }
  }
  return removed;
}

export async function renderSharedAgentInstructions(root) {
  const localInstructionsPath = path.join(root, LOCAL_INSTRUCTIONS);
  const localInstructions = await readFile(localInstructionsPath, 'utf8');
  const sharedRoot = path.join(root, SHARED_ROOT);

  let sharedInstructions = '';
  const expectedInstructions = path.join(sharedRoot, 'copilot-instructions.md');
  const sharedInstructionsPresent = await pathExists(expectedInstructions);
  if (sharedInstructionsPresent) {
    sharedInstructions = await readFile(expectedInstructions, 'utf8');
  }

  const contents = sharedInstructions
    ? `${localInstructions.trimEnd()}\n\n## Shared Agent instructions\n\n${sharedInstructions.trim()}\n`
    : `${localInstructions.trimEnd()}\n`;

  return {
    contents,
    sharedPresent: sharedInstructionsPresent,
  };
}

export async function syncSharedAgent(root) {
  const rendered = await renderSharedAgentInstructions(root);
  await writeFile(path.join(root, GENERATED_INSTRUCTIONS), rendered.contents);
  const removed = await removeLegacyGeneratedFiles(root);

  return {
    instructions: GENERATED_INSTRUCTIONS,
    files: removed,
    sharedPresent: rendered.sharedPresent,
  };
}

export async function verifySharedAgentSync(root) {
  const rendered = await renderSharedAgentInstructions(root);
  const generatedPath = path.join(root, GENERATED_INSTRUCTIONS);
  const generated = await readFile(generatedPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      throw new Error(`${GENERATED_INSTRUCTIONS} is missing; run the shared Agent sync.`);
    }
    throw error;
  });
  if (generated !== rendered.contents) {
    throw new Error(`${GENERATED_INSTRUCTIONS} is stale; run the shared Agent sync.`);
  }
  return {
    instructions: GENERATED_INSTRUCTIONS,
    sharedPresent: rendered.sharedPresent,
  };
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

async function main() {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('usage: node scripts/sync-shared-agent.mjs [--check]');
  }
  const check = args[0] === '--check';
  const result = check
    ? await verifySharedAgentSync(root)
    : await syncSharedAgent(root);
  if (check) {
    console.log('Shared Agent instructions are synchronized.');
    return;
  }
  console.log(
    result.sharedPresent
      ? 'Synchronized shared Agent instructions.'
      : 'No shared Agent submodule is present; generated local instructions only.',
  );
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
