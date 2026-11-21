import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRepositoryUrl } from './setup-shared-agent.mjs';

test('accepts HTTPS and SSH shared Agent repository URLs', () => {
  assert.equal(
    validateRepositoryUrl('https://github.com/example/shared-agent.git'),
    true,
  );
  assert.equal(
    validateRepositoryUrl('git@github.com:example/shared-agent.git'),
    true,
  );
});

test('rejects local and credential-bearing repository URLs', () => {
  assert.equal(validateRepositoryUrl('file:///tmp/shared-agent'), false);
  assert.equal(
    validateRepositoryUrl('https://token@github.com/example/shared-agent.git'),
    false,
  );
});
