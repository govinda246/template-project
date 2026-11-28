import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyEffectiveSettings } from './verify-vscode-settings.mjs';

function remoteSettings() {
  return {
    customizations: {
      vscode: {
        settings: {
          'chat.defaultConfiguration': {
            mode: 'interactive',
            approvals: 'manual',
          },
          'chat.tools.global.autoApprove': false,
          'chat.tools.edits.autoApprove': {
            'src/**': true,
            'test/**': true,
            'tests/**': true,
            'public/**': true,
            'docs/**': true,
          },
          'chat.tools.eligibleForAutoApproval': {
            runInTerminal: true,
            sendToTerminal: false,
          },
          'chat.tools.terminal.enableAutoApprove': true,
          'chat.tools.terminal.autoApprove': {
            'git --no-pager status --short': true,
            'git --no-pager diff --no-ext-diff --no-textconv': true,
            'git --no-pager diff --no-ext-diff --no-textconv --check': true,
          },
          'chat.tools.urls.autoApprove': {},
          'chat.agent.sandbox.enabled': 'on',
          'chat.agent.sandbox.network.allowNetwork': true,
          'chat.agent.sandbox.network.allowedDomains': [
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
          ],
          'chat.agent.sandbox.network.allowLocalNetwork': false,
          'chat.agent.sandbox.fileSystem.allowDevToolAccess': false,
          'chat.agent.sandbox.credentials.authenticategit': false,
          'chat.agent.sandbox.credentials.authenticategh': false,
          'chat.agent.sandbox.allowUnsandboxedCommands': false,
          'chat.sessionSync.enabled': false,
          'terminal.integrated.defaultProfile.linux': 'Secure shell',
          'terminal.integrated.profiles.linux': {
            'Secure shell': {
              path: '/bin/bash',
              args: [
                '--noprofile',
                '--norc',
                '/opt/secure-template/secure-shell',
              ],
            },
          },
        },
      },
    },
  };
}

test('accepts secure effective Dev Container settings', () => {
  assert.doesNotThrow(() => verifyEffectiveSettings(remoteSettings(), {}));
});

test('rejects workspace overrides that weaken approval, network, or edit boundaries', () => {
  assert.throws(
    () =>
      verifyEffectiveSettings(remoteSettings(), {
        'chat.tools.global.autoApprove': true,
      }),
    /global\.autoApprove/,
  );
  assert.throws(
    () =>
      verifyEffectiveSettings(remoteSettings(), {
        'chat.agent.sandbox.network.allowNetwork': false,
      }),
    /allowNetwork/,
  );
  assert.throws(
    () =>
      verifyEffectiveSettings(remoteSettings(), {
        'chat.tools.terminal.autoApprove': {
          'git --no-pager status --short': true,
          npm: true,
        },
      }),
    /terminal\.autoApprove/,
  );
  assert.throws(
    () =>
      verifyEffectiveSettings(remoteSettings(), {
        'chat.tools.edits.autoApprove': {
          'src/**': true,
          '.github/**': true,
        },
      }),
    /edits\.autoApprove/,
  );
  assert.throws(
    () =>
      verifyEffectiveSettings(remoteSettings(), {
        'chat.agent.sandbox.network.allowedDomains': [
          'registry.npmjs.org',
          'unreviewed.example.com',
        ],
      }),
    /allowedDomains/,
  );
});

test('rejects workspace overrides that omit diff content approval', () => {
  assert.throws(
    () =>
      verifyEffectiveSettings(remoteSettings(), {
        'chat.tools.terminal.autoApprove': {
          'git --no-pager status --short': true,
          'git --no-pager diff --no-ext-diff --no-textconv --check': true,
        },
      }),
    /terminal\.autoApprove/,
  );
});
