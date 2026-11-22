import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const UNCONDITIONAL_PRIVILEGED_SYSCALLS = new Set([
  'bpf',
  'clone',
  'clone3',
  'fanotify_init',
  'fsconfig',
  'fsmount',
  'fsopen',
  'fspick',
  'mount',
  'mount_setattr',
  'move_mount',
  'open_tree',
  'perf_event_open',
  'ptrace',
  'setns',
  'unshare',
  'userfaultfd',
]);

const profile = JSON.parse(
  await readFile(new URL('../.devcontainer/bubblewrap-seccomp.json', import.meta.url), 'utf8'),
);

assert.equal(profile.defaultAction, 'SCMP_ACT_ERRNO');
assert.equal(profile.defaultErrnoRet, 1);

const unconditional = profile.syscalls.find(
  (rule) =>
    rule.action === 'SCMP_ACT_ALLOW' &&
    !rule.args &&
    !rule.includes &&
    !rule.excludes &&
    rule.names.every((name) => ['mount', 'umount2', 'pivot_root'].includes(name)),
);
assert.ok(
  unconditional,
  'The Bubblewrap namespace setup allowlist is missing.',
);
assert.deepEqual(
  [...unconditional.names].sort(),
  ['mount', 'pivot_root', 'umount2'],
);

for (const rule of profile.syscalls) {
  const hasConditions = rule.args || rule.includes || rule.excludes;
  if (!hasConditions && rule.action === 'SCMP_ACT_ALLOW') {
    for (const name of rule.names) {
      assert.equal(
        UNCONDITIONAL_PRIVILEGED_SYSCALLS.has(name) &&
          !unconditional.names.includes(name),
        false,
        `${name} must not have an unconditional privileged seccomp allowance.`,
      );
    }
  }
}

const cloneRules = profile.syscalls.filter(
  (rule) => rule.names.includes('clone'),
);
assert.equal(
  cloneRules.filter((rule) => !rule.args && !rule.includes && !rule.excludes).length,
  0,
);
assert.ok(
  cloneRules.some(
    (rule) =>
      rule.action === 'SCMP_ACT_ALLOW' &&
      Array.isArray(rule.args) &&
      rule.args.some(
        (argument) =>
          argument.op === 'SCMP_CMP_MASKED_EQ' &&
          argument.value === 268435456 &&
          argument.valueTwo === 268435456,
      ),
  ),
);

const unshareRules = profile.syscalls.filter(
  (rule) => rule.names.includes('unshare'),
);
assert.equal(unshareRules.some((rule) => !rule.args && !rule.includes), false);
assert.equal(
  profile.syscalls.some(
    (rule) =>
      rule.action === 'SCMP_ACT_ALLOW' &&
      rule.names.some((name) =>
        ['process_vm_readv', 'process_vm_writev', 'ptrace'].includes(name),
      ) &&
      !rule.includes?.caps,
  ),
  false,
);

console.log('Bubblewrap seccomp allowances are constrained.');
