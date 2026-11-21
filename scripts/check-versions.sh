#!/usr/bin/env bash
set -euo pipefail

expected_node="v22.16.0"
expected_npm="10.9.2"

actual_node="$(node --version)"
actual_npm="$(npm --version)"

if [[ "$actual_node" != "$expected_node" ]]; then
  echo "Node.js mismatch: expected $expected_node, got $actual_node" >&2
  exit 1
fi

if [[ "$actual_npm" != "$expected_npm" ]]; then
  echo "npm mismatch: expected $expected_npm, got $actual_npm" >&2
  exit 1
fi

printf 'Node.js %s, npm %s, all pinned versions matched.\n' \
  "$actual_node" "$actual_npm"
