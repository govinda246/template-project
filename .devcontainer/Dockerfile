# digest固定により同じイメージ参照が後から別内容へ差し替わることを防ぐ。
FROM mcr.microsoft.com/devcontainers/javascript-node:5-26-bookworm@sha256:001e44cb39fceaafcd8ee3cca2e0005399a78694b26e7682acf9dece827ea7e6

ARG EXPECTED_NODE_MAJOR=26
ARG EXPECTED_NPM_MAJOR=11

USER root

# Bubblewrap実行とネットワーク分離に必要な最小ツール。Node/npmの期待版もビルド時に固定確認する。
RUN apt-get update \
    && apt-get upgrade -y --no-install-recommends \
    && apt-get install -y --no-install-recommends \
        bubblewrap \
        iproute2 \
        iptables \
        slirp4netns \
        util-linux \
    && apt-get purge -y \
        libglib2.0-dev \
        libglib2.0-dev-bin \
        libsqlite3-dev \
        libxml2-dev \
        linux-libc-dev \
        zlib1g-dev \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && case "$(node --version)" in "v${EXPECTED_NODE_MAJOR}."*) ;; *) exit 1 ;; esac \
    && case "$(npm --version)" in "${EXPECTED_NPM_MAJOR}."*) ;; *) exit 1 ;; esac \
    && mkdir -p \
        /home/node/.copilot/session-state \
        /home/node/.vscode-server/data/agentSessionData \
        /home/node/.vscode-server/data/User/globalStorage \
        /home/node/.vscode-server/data/User/workspaceStorage \
        /opt/secure-template \
    && chown -R node:node /home/node/.copilot /home/node/.vscode-server

# Agentから書き換えられないtrusted pathへ、proxyとallowlistをroot所有で配置する。
COPY --chown=root:root \
    .devcontainer/dns-filter.mjs \
    .devcontainer/egress-proxy.mjs \
    .devcontainer/egress-allowlist.txt \
    /opt/secure-template/
COPY --chown=root:root --chmod=0755 \
    scripts/devcontainer-entrypoint \
    scripts/secure-run \
    scripts/secure-shell \
    /opt/secure-template/

RUN chown -R root:root /opt/secure-template \
    && chmod 0755 /opt/secure-template \
    && chmod 0644 \
        /opt/secure-template/dns-filter.mjs \
        /opt/secure-template/egress-proxy.mjs \
        /opt/secure-template/egress-allowlist.txt

# 直接接続ではなく、sandbox内のallowlist付きproxyを経由させる既定値。
ENV HTTP_PROXY=http://egress-proxy:3128
ENV HTTPS_PROXY=http://egress-proxy:3128
ENV ALL_PROXY=http://egress-proxy:3128
ENV NO_PROXY=localhost,127.0.0.1
ENV SECURE_PROJECT_ROOT=/workspaces/template-project

USER node
