#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
secure_run="$project_root/scripts/secure-run"

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
expect_failure "$secure_run" docker ps
expect_failure "$secure_run" sudo true
expect_failure "$secure_run" --offline sh -c 'sudo true'
expect_failure "$secure_run" --offline sh -c 'docker ps'
expect_failure "$secure_run" --offline node -e \
  "require('net').connect({host:'egress-proxy',port:3128}).once('connect',()=>process.exit(0)).once('error',()=>process.exit(1))"
expect_failure "$secure_run" --offline sh -c 'echo x > /root/forbidden'
expect_failure "$secure_run" --offline test -e /home/node/.vscode-server
expect_failure "$secure_run" --offline test -e /var/run/docker.sock

node --test "$project_root/.devcontainer/egress-proxy.test.mjs"

echo "Security regression checks passed."
