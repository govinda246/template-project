FROM mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm@sha256:0d29e5fdc64f8397cd502223e0c4679f1e60877ca0fd2db4f2e2e0028e4271af

ARG EXPECTED_NODE_VERSION=22.16.0
ARG EXPECTED_NPM_VERSION=10.9.2

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bubblewrap \
        iproute2 \
        iptables \
        slirp4netns \
        util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && test "$(node --version)" = "v${EXPECTED_NODE_VERSION}" \
    && test "$(npm --version)" = "${EXPECTED_NPM_VERSION}" \
    && mkdir -p /home/node/.vscode-server/data/User/workspaceStorage /opt/secure-template \
    && chown -R node:node /home/node/.vscode-server

COPY --chown=root:root .devcontainer/egress-proxy.mjs .devcontainer/egress-allowlist.txt /opt/secure-template/
COPY --chown=root:root --chmod=0755 scripts/secure-run scripts/secure-shell /opt/secure-template/

RUN chown -R root:root /opt/secure-template \
    && chmod 0755 /opt/secure-template \
    && chmod 0644 /opt/secure-template/egress-proxy.mjs /opt/secure-template/egress-allowlist.txt

ENV HTTP_PROXY=http://egress-proxy:3128
ENV HTTPS_PROXY=http://egress-proxy:3128
ENV ALL_PROXY=http://egress-proxy:3128
ENV NO_PROXY=localhost,127.0.0.1
ENV SECURE_PROJECT_ROOT=/workspaces/github_agent_test

USER node
