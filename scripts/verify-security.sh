#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
secure_run="/opt/secure-template/secure-run"

expect_success() {
  "$@" >/dev/null
}

expect_failure() {
  if "$@" >/dev/null 2>&1; then
    echo "expected failure: $*" >&2
    return 1
  fi
}

expect_success "$secure_run" --offline node -e "process.stdout.write('isolated')"
expect_success "$secure_run" --offline sh -c \
  'case "$(command -v node)" in /usr/local/bin/node|/usr/local/share/nvm/current/bin/node) exit 0;; *) exit 1;; esac'
expect_failure "$secure_run" --offline sh -c \
  'case ":$PATH:" in *":$SECURE_PROJECT_ROOT/.github/shared/bin:"*) exit 0;; *) exit 1;; esac'
expect_failure "$secure_run" docker ps
expect_failure "$secure_run" sudo true
expect_failure "$secure_run" copilot --version
expect_failure "$secure_run" gh copilot --version
expect_failure "$secure_run" npx @github/copilot --version
expect_failure "$secure_run" npm exec -- @github/copilot --version
expect_failure "$secure_run" --offline sh -c 'copilot --version'
expect_failure "$secure_run" --offline sh -c 'sudo true'
expect_failure "$secure_run" --offline sh -c 'docker ps'
expect_failure "$secure_run" --offline node -e \
  "require('net').connect({host:'egress-proxy',port:3128}).once('connect',()=>process.exit(0)).once('error',()=>process.exit(1))"
expect_failure "$secure_run" --offline sh -c 'echo x > /root/forbidden'
expect_failure "$secure_run" --offline test -e /home/node/.vscode-server
expect_failure "$secure_run" --offline test -e /var/run/docker.sock
expect_failure "$secure_run" --offline test -w "$project_root/.git"
expect_failure "$secure_run" --offline test -w "$project_root/scripts"
expect_failure "$secure_run" --offline test -w "$project_root/.vscode"
expect_failure "$secure_run" --offline sh -c 'echo x >> "$SECURE_PROJECT_ROOT/.git/config"'
expect_failure "$secure_run" --offline sh -c 'echo x > "$SECURE_PROJECT_ROOT/scripts/secure-run"'

parent_uts="$(stat -Lc %i /proc/self/ns/uts)"
parent_mnt="$(stat -Lc %i /proc/self/ns/mnt)"
parent_ipc="$(stat -Lc %i /proc/self/ns/ipc)"
expect_success "$secure_run" --offline sh -c \
  "test \"\$(stat -Lc %i /proc/self/ns/uts)\" != '$parent_uts'"
expect_success "$secure_run" --offline sh -c \
  "test \"\$(stat -Lc %i /proc/self/ns/mnt)\" != '$parent_mnt'"
expect_success "$secure_run" --offline sh -c \
  "test \"\$(stat -Lc %i /proc/self/ns/ipc)\" != '$parent_ipc'"
expect_success "$secure_run" --offline sh -c \
  'test "$(id -u)" = 1000 && test "$(id -g)" = 1000'
expect_success "$secure_run" --offline sh -c \
  "test \"\$(awk '/^CapEff:/ { print \$2 }' /proc/self/status)\" = 0000000000000000"
expect_success "$secure_run" --offline sh -c \
  "test \"\$(awk '/^NoNewPrivs:/ { print \$2 }' /proc/self/status)\" = 1"
expect_success "$secure_run" --offline python3 -c \
  'import ctypes; f=ctypes.CDLL(None,use_errno=True); f.syscall(321,0,0,0,0,0,0); raise SystemExit(ctypes.get_errno()!=1)'
expect_success "$secure_run" --offline python3 -c \
  'import ctypes; f=ctypes.CDLL(None,use_errno=True); f.syscall(250,0,0,0,0,0,0); raise SystemExit(ctypes.get_errno()!=1)'
expect_success "$secure_run" --offline python3 -c \
  'import ctypes; f=ctypes.CDLL(None,use_errno=True); f.syscall(101,0,0,0,0,0,0); raise SystemExit(ctypes.get_errno()!=1)'

node "$project_root/scripts/verify-bubblewrap-security.mjs"
node --test "$project_root/.devcontainer/egress-proxy.test.mjs"
node --test "$project_root/.devcontainer/dns-filter.test.mjs"

echo "Security regression checks passed."
