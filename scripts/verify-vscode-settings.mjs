import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const EDITS_ALLOWLIST = {
  'src/**': true,
  'test/**': true,
  'tests/**': true,
  'public/**': true,
  'docs/**': true,
};

const NETWORK_ALLOWLIST = [
  'registry.npmjs.org',
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'marketplace.visualstudio.com',
  'main.vscode-cdn.net',
  'github.gallerycdn.vsassets.io',
  'dbaeumer.gallerycdn.vsassets.io',
  'esbenp.gallerycdn.vsassets.io',
  'api.individual.githubcopilot.com',
  'api.githubcopilot.com',
  'copilot-proxy.githubusercontent.com',
];

function stripJsonComments(contents) {
  let result = '';
  let string = false;
  let escaped = false;
  for (let index = 0; index < contents.length; index += 1) {
    const char = contents[index];
    const next = contents[index + 1];
    if (string) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        string = false;
      }
      continue;
    }
    if (char === '"') {
      string = true;
      result += char;
    } else if (char === '/' && next === '/') {
      while (index < contents.length && contents[index] !== '\n') {
        index += 1;
      }
      result += '\n';
    } else if (char === '/' && next === '*') {
      index += 2;
      while (
        index < contents.length &&
        !(contents[index] === '*' && contents[index + 1] === '/')
      ) {
        if (contents[index] === '\n') {
          result += '\n';
        }
        index += 1;
      }
      index += 1;
    } else {
      result += char;
    }
  }
  return result.replace(/,\s*([}\]])/gu, '$1');
}

export async function parseJsonc(file) {
  return JSON.parse(stripJsonComments(await readFile(file, 'utf8')));
}

function valueAt(object, dottedPath) {
  if (Object.hasOwn(object, dottedPath)) {
    return object[dottedPath];
  }
  const parts = dottedPath.split('.');
  for (let end = parts.length; end > 0; end -= 1) {
    const prefix = parts.slice(0, end).join('.');
    if (Object.hasOwn(object, prefix)) {
      return parts.slice(end).reduce(
        (value, key) => value?.[key],
        object[prefix],
      );
    }
  }
  return undefined;
}

export function verifyEffectiveSettings(devcontainer, workspace) {
  const remoteSettings = devcontainer.customizations?.vscode?.settings;
  assert.ok(remoteSettings, 'Dev Container VS Code settings are required.');
  const effective = { ...remoteSettings, ...workspace };

  const requiredValues = new Map([
    ['chat.defaultConfiguration.mode', 'interactive'],
    ['chat.defaultConfiguration.approvals', 'manual'],
    ['chat.tools.global.autoApprove', false],
    ['chat.tools.eligibleForAutoApproval.runInTerminal', true],
    ['chat.tools.eligibleForAutoApproval.sendToTerminal', false],
    ['chat.tools.terminal.enableAutoApprove', true],
    ['chat.agent.sandbox.enabled', 'on'],
    ['chat.agent.sandbox.network.allowNetwork', true],
    ['chat.agent.sandbox.network.allowLocalNetwork', false],
    ['chat.agent.sandbox.fileSystem.allowDevToolAccess', false],
    ['chat.agent.sandbox.credentials.authenticategit', false],
    ['chat.agent.sandbox.credentials.authenticategh', false],
    ['chat.agent.sandbox.allowUnsandboxedCommands', false],
    ['chat.sessionSync.enabled', false],
    ['terminal.integrated.defaultProfile.linux', 'Secure shell'],
  ]);

  const nestedDefaultConfiguration = {
    ...remoteSettings['chat.defaultConfiguration'],
    ...workspace['chat.defaultConfiguration'],
  };
  effective['chat.defaultConfiguration'] = nestedDefaultConfiguration;
  for (const [setting, expected] of requiredValues) {
    assert.deepEqual(
      valueAt(effective, setting),
      expected,
      `Effective VS Code setting ${setting} must be ${JSON.stringify(expected)}.`,
    );
  }

  assert.deepEqual(effective['chat.tools.edits.autoApprove'], EDITS_ALLOWLIST);
  assert.deepEqual(effective['chat.tools.terminal.autoApprove'], {
    'git --no-pager status --short': true,
    'git --no-pager diff --no-ext-diff --no-textconv --check': true,
  });
  assert.deepEqual(effective['chat.tools.urls.autoApprove'], {});
  assert.deepEqual(
    effective['terminal.integrated.profiles.linux']['Secure shell'],
    {
      path: '/bin/bash',
      args: [
        '--noprofile',
        '--norc',
        '/opt/secure-template/secure-shell',
      ],
    },
  );
  assert.deepEqual(
    effective['chat.agent.sandbox.network.allowedDomains'],
    NETWORK_ALLOWLIST,
  );
  return effective;
}

export async function verifyWorkspaceSettings(root) {
  const devcontainer = await parseJsonc(
    path.join(root, '.devcontainer/devcontainer.json'),
  );
  const workspace = await parseJsonc(
    path.join(root, '.vscode/settings.json'),
  );
  return verifyEffectiveSettings(devcontainer, workspace);
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error('verify-vscode-settings does not accept arguments.');
  }
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  await verifyWorkspaceSettings(root);
  console.log('Effective Copilot and VS Code security settings are intact.');
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
