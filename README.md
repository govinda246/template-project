# Secure Phaser Template

TypeScript、Vite、Phaser 3 を使う最小2Dブラウザーゲーム基盤です。Dev Containerは既定で外部ネットワークから隔離され、必要なHTTPS通信だけをallowlist付きCONNECTプロキシへ渡します。開発コマンドはBubblewrap内で実行します。

## 前提

- Docker Desktop または Docker Engine + Compose v2
- VS Code
- Dev Containers拡張
- WSL 2/Linuxコンテナ環境で有効な非特権user namespace

このテンプレートはDocker CLI 29.9.3 / Compose v2で構成を検証しています。利用開始前にホストで次を確認してください。

```sh
docker version
docker compose version
```

Dockerデーモンが稼働していない場合はDev Containerを再ビルドできません。

## セキュリティ境界

### Docker

- devコンテナは`internal: true`の`sandbox`ネットワークだけに接続します。
- egress proxyだけが`sandbox`と外部側の`egress`ネットワークへ接続します。
- Docker socket、privileged、host network/PID/IPC、追加capabilityを公開しません。
- `node`ユーザー、read-only proxy、`cap_drop: ALL`、`no-new-privileges`を使用します。
- CopilotのAgent sandboxはBubblewrapで動作し、`slirp4netns`、`iptables`、TUNデバイスを利用できる構成です。

### ネットワーク

devコンテナから直接インターネットへ出るdefault routeはありません。HTTP(S)クライアントは`egress-proxy`を経由し、プロキシは次の完全一致ホスト名だけにTCP 443へのCONNECTを許可します。

- `registry.npmjs.org`
- `github.com`
- `api.github.com`
- `objects.githubusercontent.com`
- `codeload.github.com`
- `raw.githubusercontent.com`
- `api.githubcopilot.com`
- `copilot-proxy.githubusercontent.com`
- `copilot-telemetry.githubusercontent.com`

正規の許可先以外、平文HTTP、ポート443以外は拒否されます。HTTPS内容は復号しません。変更は[egress-allowlist.txt](.devcontainer/egress-allowlist.txt)で行い、プロキシを再起動してください。

### Bubblewrap

通常ターミナルは[secure-run](scripts/secure-run)を通って次の状態で起動します。

- PID/IPC/UTS/user namespace分離
- `/usr`、`/etc`、`/opt`などの必要なシステム領域を読み取り専用でbind
- プロジェクトは原則として書き込み可能。ただし`.git`、`.devcontainer`、`.github`、`.vscode`、`scripts`は読み取り専用
- `$HOME`を空のtmpfsへ置換
- ホスト資格情報やDocker socketをマウントしない
- `copilot`、`gh copilot`、`npx`/`npm exec`によるGitHub Copilot CLI起動、`docker`、`sudo`、`mount`、`nsenter`などの実行を拒否
- `--offline`指定時はネットワークnamespaceも分離

初期ターミナルはセキュアシェルです。通常ターミナルの代わりに入力するコマンドはすでにBubblewrap内です。明示的に単発実行する場合は次の形を使います。

```sh
/opt/secure-template/secure-run npm run typecheck
/opt/secure-template/secure-run --offline node -e "console.log('offline')"
```

信頼される`secure-run`と`secure-shell`はイメージ生成時にroot所有で`/opt/secure-template`へ配置されます。VS CodeとCopilotはワークスペース内の同名ファイルを実行しません。コマンド名ブラックリストは利便性のための層であり、Docker socket非公開、capability除去、ファイル権限、ネットワーク分離が主たる防御です。

## 開始

1. VS Codeで「Reopen in Container」を実行します。
2. ターミナルで依存関係を導入します。

```sh
npm ci
```

3. 実行・検証します。

```sh
npm run dev
npm run typecheck
npm test
npm run build
```

ゲームは<http://127.0.0.1:3000>で確認できます。ホストの3000番はegress proxyの127.0.0.1 bindへだけ公開され、そこから`sandbox`ネットワーク内のViteへ転送されます。ゲーム本体は外部通信しません。

## テスト

ローカルでは次を順に実行します。

```sh
bash scripts/check-versions.sh
npm ci --ignore-scripts
npm run typecheck
npm test
node --test .devcontainer/egress-proxy.test.mjs
npm run build
bash scripts/verify-security.sh
```

`verify-security.sh`はコンテナ内のBubblewrap実効挙動を検査するため、Dev Container内でのみ実行してください。

## バージョン固定

- Node.js: `22.16.0`
- npm: `10.9.2`
- ベースイメージ: `mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm` の multi-arch digest
- Phaser: `3.90.0`
- Vite: `8.3.8`
- TypeScript: `7.0.2`
- Vitest: `5.1.1`
- VS Code拡張: [devcontainer.json](.devcontainer/devcontainer.json) の `ID@version`。ただしGitHub CopilotとCopilot Chatは認証・契約確認との互換性を保つため、VS Code対応の最新版を使用します。

依存関係の正本は[package-lock.json](package-lock.json)です。導入時は`npm install`ではなく`npm ci`を使います。イメージdigestとNode/npmバージョンは[Dockerfile](.devcontainer/Dockerfile)のビルド時チェックでも確認します。

## 更新手順

1. 変更理由とセキュリティ影響を確認します。
2. Dockerイメージを更新する場合はmulti-arch manifest digestを取得し、DockerfileとREADMEへ反映します。
3. npm依存関係は一つずつ更新し、新しいlockfileを含めます。
4. VS Code拡張は対象環境とVS Code版を確認して完全なバージョンへ固定します。
5. allowlistへホストを追加する場合は完全一致を原則にし、必要なポート・DNS・データ送信先を確認します。
6. 全テストと`Dev Containers: Rebuild Container`後の再検証を実行します。
7. イメージ・依存関係・拡張・allowlistの差分を同時にレビューします。

## トラブルシューティング

- `Operation not permitted`がBubblewrapで発生する: ホストで非特権user namespaceが有効か、Dockerのseccompプロファイルが読み込まれているか確認します。
- npmでネットワークエラーになる: egress proxyが起動中か、対象ホストがallowlistに完全一致するか確認します。
- 許可していないサイトに接続できてしまう: devコンテナが`sandbox`以外のDockerネットワークへ接続されていないか`docker inspect`で確認します。
- ポート3000が利用できない: ホストで既に使用中でないか確認します。
- VS Code拡張が未対応になる: 固定したVS Code本体と拡張版の組み合わせを更新します。未知の設定を黙って無視せず、出力ログを確認します。
- GitHub Copilotで有料プランを認識しない: コンテナを再ビルドした後、VS Codeのアカウントメニューから有料契約のあるGitHubアカウントでサインインし直してください。`GitHub Copilot`出力ログに`403 Forbidden`または`502 Bad Gateway`がある場合は、egress proxyの再起動状態と上記allowlistの対象ホストを確認します。

## 制約

このテンプレートはプロジェクト実行とパッケージ取得を対象にしています。SSH、Gitホストへのpush、クラウド認証、Docker操作は意図的に無効です。必要な管理作業はコンテナ外で人間が承認して行ってください。
