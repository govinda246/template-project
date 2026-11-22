import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workflow = await readFile(
  new URL('../.github/workflows/security.yml', import.meta.url),
  'utf8',
);

function step(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const end = workflow.indexOf('\n      - name:', start + 1);
  return workflow.slice(start, end === -1 ? workflow.length : end);
}

for (const [gateName, inventoryName, output] of [
  [
    'Block fixable dependency vulnerabilities',
    'Generate dependency vulnerability report',
    'trivy-fixable-dependencies.txt',
  ],
  [
    'Block fixable Dev Container vulnerabilities',
    'Scan Dev Container image',
    'trivy-fixable-devcontainer.txt',
  ],
]) {
  test(`${gateName} blocks only fixable High/Critical findings`, () => {
    const gate = step(gateName);
    const inventory = step(inventoryName);

    assert.match(gate, /severity: HIGH,CRITICAL/);
    assert.match(gate, /ignore-unfixed: true/);
    assert.match(gate, /exit-code: "1"/);
    assert.match(gate, new RegExp(`output: ${output.replace('.', '\\.')}`));

    assert.match(inventory, /exit-code: "0"/);
    assert.doesNotMatch(inventory, /ignore-unfixed/);
    assert.ok(
      workflow.indexOf(inventoryName) < workflow.indexOf(gateName),
      `${inventoryName} must run before ${gateName}`,
    );
  });
}

test('all gate and inventory reports are uploaded', () => {
  const upload = step('Upload Trivy reports');
  for (const report of [
    'trivy-dependencies.txt',
    'trivy-fixable-dependencies.txt',
    'trivy-devcontainer.txt',
    'trivy-fixable-devcontainer.txt',
  ]) {
    assert.ok(upload.includes(`            ${report}`), `missing ${report}`);
  }
});
