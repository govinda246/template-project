# 公式のNode.js 22 LTS Dev Containerイメージを使います。
FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm

USER root

# サンドボックスの依存パッケージを入れ、nodeが書き込める履歴保存先を作り、aptキャッシュを削除します。
RUN apt-get update \
    && apt-get install -y --no-install-recommends bubblewrap slirp4netns util-linux iptables \
    && mkdir -p /home/node/.vscode-server/data/User/workspaceStorage \
    && chown -R node:node /home/node/.vscode-server \
    && rm -rf /var/lib/apt/lists/*

# 実行時はrootではなくnodeユーザーを使います。
USER node
