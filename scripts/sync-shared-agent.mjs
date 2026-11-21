import {
  access,
  mkdir,
  readFile,
  readdir,
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

async function listFiles(root, prefix = '') {
  const directory = path.join(root, prefix);
  if (!(await pathExists(directory))) {
    return [];
  }
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

function generatedAgentName(relativePath) {
  return `shared-${relativePath.replaceAll('/', '-')}`;
}

function frontmatter(contents) {
  const match = /^---\n[\s\S]*?\n---\n/.exec(contents);
  return match?.[0] ?? '';
}

async function writeReference(target, source, sourceReference) {
  const sourceContents = await readFile(source, 'utf8');
  const metadata = frontmatter(sourceContents);
  const body = [
    '# Shared Agent reference',
    '',
    `Read and follow the canonical shared definition at \`${sourceReference}\`.`,
    'Do not duplicate or edit that definition in the project-specific location.',
  ].join('\n');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${metadata}${body}\n`);
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

  const synced = [];
  for (const kind of ['agents', 'skills']) {
    const sourceRoot = path.join(sharedRoot, kind);
    const targetRoot = path.join(root, `.github/${kind}`);
    if (kind === 'agents' && (await pathExists(targetRoot))) {
      for (const entry of await readdir(targetRoot, { withFileTypes: true })) {
        if (entry.name.startsWith('shared-')) {
          await rm(path.join(targetRoot, entry.name), {
            recursive: true,
            force: true,
          });
        }
      }
    } else if (kind === 'skills' && (await pathExists(targetRoot))) {
      for (const entry of await readdir(targetRoot, { withFileTypes: true })) {
        if (entry.name.startsWith('shared-')) {
          await rm(path.join(targetRoot, entry.name), {
            recursive: true,
            force: true,
          });
        }
      }
    }
    const files = await listFiles(sourceRoot);
    for (const relativePath of files) {
      const outputRelative =
        kind === 'agents'
          ? generatedAgentName(relativePath)
          : path.posix.join('shared', relativePath);
      const target = path.join(targetRoot, outputRelative);
      const source = path.join(sourceRoot, relativePath);
      const sourceReference = path
        .relative(root, source)
        .split(path.sep)
        .join('/');
      if (kind === 'agents') {
        await writeReference(target, source, sourceReference);
      } else {
        if (!relativePath.endsWith('/SKILL.md')) {
          continue;
        }
        const skillName = relativePath.split('/')[0];
        const skillTarget = path.join(
          targetRoot,
          `shared-${skillName}`,
          'SKILL.md',
        );
        await writeReference(skillTarget, source, sourceReference);
        synced.push(path.relative(root, skillTarget));
        continue;
      }
      synced.push(path.relative(root, target));
    }
  }

  return {
    instructions: GENERATED_INSTRUCTIONS,
    files: synced,
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
      ? `Synchronized ${result.files.length} shared Agent files.`
      : 'No shared Agent submodule is present; generated local instructions only.',
  );
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
