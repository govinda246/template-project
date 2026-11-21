#!/usr/bin/env bash
set -euo pipefail

# This runner is for WSL-based local development without Docker.
# Network access is denied by default; online access must be explicitly requested.

if [[ $# -lt 2 || ${1:-} != "--project-path" ]]; then
  echo "usage: local-secure-run.sh --project-path PATH [--online] COMMAND [ARG...]" >&2
  exit 64
fi

project_root="$2"
shift 2

if [[ ! -d "$project_root" ]]; then
  echo "local-secure-run: project path does not exist: $project_root" >&2
  exit 66
fi
project_root="$(cd -- "$project_root" && pwd -P)"
path_prefix=/usr/local/bin
if [[ -d "$project_root/.github/shared/bin" ]]; then
  path_prefix="/workspace/.github/shared/bin:$path_prefix"
fi

network_args=(--unshare-net)
if [[ ${1:-} == "--offline" ]]; then
  shift
elif [[ ${1:-} == "--online" ]]; then
  network_args=()
  echo "local-secure-run: WARNING: network access is enabled without an egress allowlist" >&2
  shift
fi

if [[ $# -eq 0 ]]; then
  echo "local-secure-run: command is required" >&2
  exit 64
fi

command_name="$(basename -- "$1")"
case "$command_name" in
  bwrap|docker|podman|sudo|su|mount|umount|pivot_root|unshare|nsenter|iptables|nft|ip|slirp4netns|ssh|scp|copilot|copilot-cli|github-copilot-cli)
    echo "local-secure-run: dangerous command '$command_name' is not permitted" >&2
    exit 126
    ;;
esac

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "local-secure-run: Node.js 22.16.0 and npm 10.9.2 must be installed in WSL." >&2
  echo "local-secure-run: Use the Dev Container when an isolated package runtime is required." >&2
  exit 69
fi

expected_node="v22.16.0"
expected_npm="10.9.2"
if [[ "$(node --version)" != "$expected_node" || "$(npm --version)" != "$expected_npm" ]]; then
  echo "local-secure-run: expected Node.js $expected_node and npm $expected_npm in WSL." >&2
  exit 65
fi

home_dir="${TMPDIR:-/tmp}/local-secure-home-${UID}"
cache_dir="$home_dir/.cache"
mkdir -p "$home_dir" "$cache_dir"

readonly_dirs=(
  /bin
  /etc
  /lib
  /lib64
  /opt
  /sbin
  /usr
)

args=(
  --die-with-parent
  --new-session
  --unshare-user
  --unshare-pid
  --unshare-ipc
  --unshare-uts
  --clearenv
  --proc /proc
  --dev /dev
  --tmpfs /tmp
  --tmpfs /run
)

for path in "${readonly_dirs[@]}"; do
  if [[ -e "$path" ]]; then
    args+=(--ro-bind "$path" "$path")
  fi
done

args+=(
  --tmpfs /home/local-sandbox
  --dir /home/local-sandbox/.cache
  --bind "$cache_dir" /home/local-sandbox/.cache
  --bind "$project_root" /workspace
  --chdir /workspace
  --setenv HOME /home/local-sandbox
  --setenv USER "$USER"
  --setenv LOGNAME "$USER"
  --setenv SECURE_PROJECT_ROOT /workspace
  --setenv PATH "$path_prefix:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"
  --setenv SHELL /bin/bash
  --setenv LANG C.UTF-8
  --setenv NO_PROXY localhost,127.0.0.1
)

for path in .devcontainer .github .git .vscode scripts; do
  source_path="$project_root/$path"
  if [[ -e "$source_path" ]]; then
    args+=(--ro-bind "$source_path" "/workspace/$path")
  fi
done

exec bwrap "${network_args[@]}" "${args[@]}" -- "$@"
