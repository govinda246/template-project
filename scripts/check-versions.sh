#!/usr/bin/env bash
set -euo pipefail

expected_node_major="26"
expected_npm_major="11"

actual_node="$(node --version)"
actual_npm="$(npm --version)"

if [[ "$actual_node" != "v${expected_node_major}."* ]]; then
  echo "Node.js mismatch: expected major $expected_node_major, got $actual_node" >&2
  exit 1
fi

if [[ "$actual_npm" != "${expected_npm_major}."* ]]; then
  echo "npm mismatch: expected major $expected_npm_major, got $actual_npm" >&2
  exit 1
fi

printf 'Node.js %s, npm %s, all pinned versions matched.\n' \
  "$actual_node" "$actual_npm"
