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
          'chat.tools.eligibleForAutoApproval': {
            runInTerminal: false,
            sendToTerminal: false,
          },
          'chat.tools.terminal.enableAutoApprove': false,
          'chat.tools.terminal.autoApprove': {},
          'chat.tools.urls.autoApprove': {},
          'chat.agent.sandbox.enabled': 'on',
          'chat.agent.sandbox.network.allowNetwork': false,
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

test('rejects workspace overrides that enable auto approval or networking', () => {
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
        'chat.agent.sandbox.network.allowNetwork': true,
      }),
    /allowNetwork/,
  );
});
