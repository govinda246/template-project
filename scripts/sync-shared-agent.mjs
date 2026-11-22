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

export async function syncSharedAgent(root) {
  const localInstructionsPath = path.join(root, LOCAL_INSTRUCTIONS);
  const localInstructions = await readFile(localInstructionsPath, 'utf8');
  const sharedRoot = path.join(root, SHARED_ROOT);

  let sharedInstructions = '';
  const expectedInstructions = path.join(sharedRoot, 'copilot-instructions.md');
  const sharedInstructionsPresent = await pathExists(expectedInstructions);
  if (sharedInstructionsPresent) {
    sharedInstructions = await readFile(expectedInstructions, 'utf8');
  }

  const combined = sharedInstructions
    ? `${localInstructions.trimEnd()}\n\n## Shared Agent instructions\n\n${sharedInstructions.trim()}\n`
    : `${localInstructions.trimEnd()}\n`;
  await writeFile(path.join(root, GENERATED_INSTRUCTIONS), combined);
  const removed = await removeLegacyGeneratedFiles(root);

  return {
    instructions: GENERATED_INSTRUCTIONS,
    files: removed,
    sharedPresent: sharedInstructionsPresent,
  };
}

function isMainModule() {
  return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error('sync-shared-agent does not accept arguments.');
  }
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const result = await syncSharedAgent(root);
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
