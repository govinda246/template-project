import {
  access,
  readFile,
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

export async function syncSharedAgent(root) {
  const localInstructionsPath = path.join(root, LOCAL_INSTRUCTIONS);
  const localInstructions = await readFile(localInstructionsPath, 'utf8');
  const sharedRoot = path.join(root, SHARED_ROOT);

  let sharedInstructions = '';
  if (await pathExists(sharedRoot)) {
    for (const requiredPath of [
      'copilot-instructions.md',
      'hooks.yml',
      'agents',
      'skills',
      'bin',
    ]) {
      if (!(await pathExists(path.join(sharedRoot, requiredPath)))) {
        throw new Error(
          `${SHARED_ROOT}/${requiredPath} is required by the shared Agent contract.`,
        );
      }
    }
    const expectedInstructions = path.join(sharedRoot, 'copilot-instructions.md');
    sharedInstructions = await readFile(expectedInstructions, 'utf8');
  }

  const combined = sharedInstructions
    ? `${localInstructions.trimEnd()}\n\n## Shared Agent instructions\n\n${sharedInstructions.trim()}\n`
    : `${localInstructions.trimEnd()}\n`;
  await writeFile(path.join(root, GENERATED_INSTRUCTIONS), combined);

  return {
    instructions: GENERATED_INSTRUCTIONS,
    files: [],
    sharedPresent: await pathExists(sharedRoot),
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
