# Secure Phaser Template

TypeScript、Vite、Phaser 4 を使う最小2Dブラウザーゲーム基盤です。Dev Containerは既定で外部ネットワークから隔離され、必要なHTTPS通信だけをallowlist付きCONNECTプロキシへ渡します。開発コマンドはBubblewrap内で実行します。

初心者向け概要は [GitHub Pages](https://govinda246.github.io/template-project/) に、制限・残存リスク・緩和方法・改善案は [詳細セキュリティ資料](https://govinda246.github.io/template-project/security-details.html) に分けています。`docs/` を更新すると、GitHub Actionsで自動公開されます。

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

Windowsでは、workspaceを開いたときに`Ensure Docker Desktop`タスクが自動実行されます。Docker
Desktopが停止している場合は起動し、Engineが応答するまで最大90秒待機します。VS Codeが初回に
自動タスクの確認を表示したら、このworkspaceだけ`Allow Automatic Tasks in Folder`を許可してください。

Copilot SDKのイベントログ、Agent Hostの会話DB、VS Codeのworkspace state、
Copilot Chat / Agent Hostの一覧metadataは、それぞれ別のnamed volumeへ保存します。
とくに`agentSessionData`には表示されるturn本文とツール結果が含まれるため、
一覧metadataだけでは会話を復元できません。これらのvolumeにはコード断片や設定が
含まれ得るのでGitへバックアップせず、必要に応じてローカルの信頼できる場所へ
退避してください。

## セキュリティ境界

### Docker

- devコンテナは`internal: true`の`sandbox`ネットワークだけに接続します。
- egress proxyだけが`sandbox`と外部側の`egress`ネットワークへ接続します。
- Docker socket、privileged、host network/PID/IPCは公開しません。
- devcontainerは起動時のDNS・UID/GID設定だけに`NET_ADMIN`、`SETUID`、`SETGID`、`SETPCAP`を使用し、entrypoint直後に`node`へ降格して全capabilityを除去します。proxyとDNS filterは`cap_drop: ALL`で動作します。
- read-only proxy / DNS filter、`no-new-privileges`、seccomp deny-by-defaultを使用します。
- CopilotのAgent sandboxはBubblewrapで動作し、`slirp4netns`、`iptables`、TUNデバイスを利用できる構成です。

### ネットワーク

devコンテナから直接インターネットへ出るdefault routeはありません。HTTP(S)クライアントは`egress-proxy`を経由し、プロキシは次の完全一致ホスト名だけにTCP 443へのCONNECTを許可します。

- `registry.npmjs.org`
- `github.com`
- `api.github.com`
- `objects.githubusercontent.com`
- `codeload.github.com`
- `raw.githubusercontent.com`
- `marketplace.visualstudio.com`
- `main.vscode-cdn.net`
- `github.gallerycdn.vsassets.io`
- `dbaeumer.gallerycdn.vsassets.io`
- `esbenp.gallerycdn.vsassets.io`
- `api.individual.githubcopilot.com`
- `api.githubcopilot.com`
- `copilot-proxy.githubusercontent.com`

正規の許可先以外、平文HTTP、ポート443以外は拒否されます。HTTPS内容は復号しません。変更は[egress-allowlist.txt](.devcontainer/egress-allowlist.txt)で行い、Dev Containerを再ビルドしてください。allowlistはイメージに組み込まれるため、プロキシの再起動だけでは変更は反映されません。

拒否されたCONNECTはegress-proxyの標準エラーログへ記録されます。Node.jsとDocker CLIの両方が使えるホスト側から、次のように直近の拒否先と件数を監査できます。Dev Container内にDocker CLIやsocketは公開していないため、このスクリプト自体はコンテナ内では実行できません。

```sh
node scripts/audit-egress-logs.mjs
node scripts/audit-egress-logs.mjs --since 7d
```

Composeの`json-file`ログはコンテナごとに10 MBではなく、egress proxyでは5 MBを3世代保持します。コンテナの再作成前に監査し、保持期間を越える証跡が必要な場合はホストまたはCIのログ収集基盤へ転送してください。`403 denied CONNECT`は拒否成功、`502 upstream failure`はallowlist拒否ではなく上流経路・DNSの障害候補として分けて確認します。

### Bubblewrap

通常ターミナルは[secure-run](scripts/secure-run)を通って次の状態で起動します。

- PID/IPC/UTS/user namespace分離
- `/usr`、`/etc`、`/opt`などの必要なシステム領域を読み取り専用でbind
- プロジェクトは原則として書き込み可能。ただし`.git`、`.devcontainer`、`.github`、`.vscode`、`scripts`は読み取り専用
- `$HOME`を空のtmpfsへ置換
- ホスト資格情報やDocker socketをマウントしない
- `copilot`、`gh copilot`、`npx`/`npm exec`によるGitHub Copilot CLI起動、`docker`、`sudo`、`mount`、`nsenter`などの実行を拒否
- ローカルランナーではネットワークnamespaceを既定で分離し、`--online`指定時だけ共有
- `.github/shared/bin`をPATHへ追加しない。共有Agentは指示・定義・Skillの入力であり、実行可能コマンドの供給元ではない
- `typecheck`、`test`、`build`タスクはLinux・Windowsのいずれも`--offline`で実行

初期ターミナルはセキュアシェルです。通常ターミナルの代わりに入力するコマンドはすでにBubblewrap内です。明示的に単発実行する場合は次の形を使います。

```sh
/opt/secure-template/secure-run --offline npm run typecheck
/opt/secure-template/secure-run --offline node -e "console.log('offline')"
```

セキュアシェルは`--interactive`を使い、制御端末とジョブ制御を保持します。通常の単発実行では新しいセッションを作成して分離します。

信頼される`secure-run`と`secure-shell`はイメージ生成時にroot所有で`/opt/secure-template`へ配置されます。VS CodeとCopilotはワークスペース内の同名ファイルを実行しません。コマンド名ブラックリストは利便性のための層であり、Docker socket非公開、capability除去、ファイル権限、ネットワーク分離が主たる防御です。

実行可能ファイルの信頼境界は次のとおりです。`secure-run`とOS・Dev Container由来のシステムパスだけをコマンド検索対象にし、workspaceやサブモジュール配下の実行ファイルは絶対パスでもレビューなしに信頼しません。`/opt/secure-template`のランナーは再ビルド時にroot所有で再配置されるため、workspace内スクリプトを変更しただけでは実効設定は変わりません。

| 種別 | 信頼対象 | Agentへの扱い |
| --- | --- | --- |
| 信頼済み実行入口 | `/opt/secure-template/secure-run`、OSのNode/npmパス | workspaceから変更不可 |
| 実行すべき固定コマンド | `--offline npm run typecheck`、`--offline npm test`、`--offline npm run build` | Agentへ手動承認で委任可能 |
| workspace由来コード | `src/`、テスト、`package.json`、Vite/TypeScript設定 | 実行されるが信頼しない |
| 共有Agentサブモジュール | `.github/shared`、`.github/shared/bin` | 指示・定義・Skillとして読み込む。PATHには追加しない |
| 対象外 | ホストFS、Docker socket、host network、資格情報 | Agentへ公開しない |

Agentによるテスト実行は、VS Codeの`secure: test`タスクを毎回手動承認して委任できます。固定タスク以外の任意シェル、引数付き`npm exec`、`npx`、依存関係導入、Git操作、オンライン実行は自動承認しません。現状でもworkspaceのテスト・設定・ソースは書き込み可能であり、Agentが変更した内容がテストへ渡されるため、`npm test`の無条件な自動承認は信頼境界として扱いません。

### 制限と正当性

この環境は次の操作を意図的に制限しています。

| 制限 | 理由 | 防御区分 |
| --- | --- | --- |
| 許可リスト外の通信、平文HTTP、443以外の外向き接続 | ソースコードや資格情報の意図しない送信、悪意ある成果物の取得を減らす | 主要防御 |
| Docker、sudo、mount、nsenterなどの管理操作 | Docker socketと権限を渡さず、ホストやコンテナ隔離の変更を防ぐ | 主要防御 |
| SSHとコンテナ外の資格情報利用 | 未許可ポート、秘密鍵、GitHub/クラウド認証を新たな外部操作経路にしない | 主要防御 |
| `.git`、`.devcontainer`、`.github`、`.vscode`、`scripts`への書き込み | エージェントがガードレール、CI、信頼スクリプトを実行中に変更しない | 主要防御 |
| Copilot CLIの直接起動、端末・編集の自動承認 | 入れ子実行とレビュー前の自動操作を減らす | 補助防御。資格情報・ネットワーク・ファイル権限が主要防御 |

コマンド名ブラックリストは回避可能なため、セキュリティ境界ではありません。また、`github.com`やnpm registryを許可することは、そこから取得するコードの安全性を保証しません。lockfile、依存関係の差分、npm lifecycle scriptを別途確認してください。詳細は初心者向けガイドの「制限と理由」を参照してください。

### 利便性重視で緩める場合

一度にすべて外すのではなく、目的ごとに必要最小限だけ緩めます。推奨順は次のとおりです。

1. **許可ホストの追加（低リスク）**: 完全一致のホストを1つずつ確認し、`egress-allowlist.txt`へ追加します。ワイルドカードは使いません。
2. **特定コマンドの自動承認（中リスク）**: 読み取り専用操作や決め打ちのテストだけを完全一致で承認し、任意シェルや破壊的操作は承認対象にしません。
3. **期限付き資格情報の提供（高リスク）**: 対象リポジトリと権限を絞った短命トークンだけにし、長期トークンやSSH秘密鍵を渡しません。
4. **Docker socket・host network・privileged（重大リスク）**: コンテナからホスト管理権限を得られるため、この環境では原則禁止します。必要ならホスト側の明示的な操作か、別管理環境を使います。

同時に緩めてはいけない組み合わせがあります。

- 外部ネットワーク + 長期資格情報
- Docker socket + 保護ファイルへの書き込み
- host network + 自動承認
- 任意コード実行 + クラウド管理権限

緩和のたびに差分をレビューし、コンテナを再ビルドして`bash scripts/verify-security.sh`を実行してください。不要になった許可先、権限、自動承認、秘密は直ちに削除します。具体的な比較表とリスクは初心者向けガイドの「利便性のために制限を緩める方法」を参照してください。

### 防御できない、または保証しない問題

- 許可したnpm/GitHub/APIから取得するコードやパッケージの安全性
- 許可ホストへのHTTPS内容を含めたデータ送信
- Docker・Linuxカーネル・Bubblewrap・VS Code・ブラウザーの未知の脆弱性
- 書き込み可能なプロジェクト領域の破壊、データロス、秘密のコミット
- CPU、メモリ、ディスク、PIDの使い切り
- プロンプトインジェクションや、人を騙して承認させる指示
- 既に侵害されているホストOS
- 設定変更でDocker socket、host network、特権モード、長期資格情報を追加した場合

この環境は、信頼できるホスト上で通常の開発中に外部コードやエージェント操作の被害範囲を小さくすることを目的とします。完全な防御境界ではありません。重要な秘密や本番資格情報を扱う場合、敵対的コードを解析する場合、攻撃者がホストも狙う場合は、専用VMや物理的に分離した管理端末を使用してください。

Composeでdevcontainerは2 CPU・4 GBメモリ・512 PID、egress proxyは0.5 CPU・256 MBメモリ・128 PIDへ制限しています。Dockerのjson-fileログもローテーションします。これで資源枯渇の可能性を減らせますが、完全な防止ではありません。

### より安全にする方針

このプロジェクトでは採用していませんが、重要度の高い作業では次の構成がより安全です。

- 使い捨てVMや物理的に分離した端末
- 完全オフラインと事前承認済み依存関係
- 読み取り専用コピーと成果物だけを受け渡す構成
- 署名済み成果物、外部監視、復旧手順
- CPU、メモリ、PID、ログ容量の上限
- 外部監視、バックアップ、復旧手順

資源上限、ログローテーション、GitHub ActionsのコミットSHA固定、Dependabot、npm audit、Trivyによるfilesystem・Dev Containerイメージ・設定ミス・秘密情報スキャンを実装済みです。GitHub側ではSecret scanning、Push protection、Private vulnerability reporting、Dependabot alerts、Dependabot security updatesも有効化済みです。CIではCycloneDX SBOMも生成します。バックアップ、専用VMは運用側の追加対策として残ります。

公開ガイドには、追加対策なしを0点、現在の実装を71点、使い捨てVM・完全オフライン・資格情報なし・署名検証・外部監視・復旧を備えた比較用構成を100点とする相対スコアを掲載しています。通信・権限制御、資源上限、回帰テスト、依存関係監査などの実装済み対策は既に現在の配点へ反映しています。これは対策追加ごとに自動加点する指標ではなく、絶対的な安全度や脆弱性診断でもない独自の設計比較値です。

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

ゲームはVS Codeの「ポート」ビューに表示される`egress-proxy:3000`の転送先から確認できます。VS Codeが空いているローカルポートへ自動転送するため、Dockerの固定ホストポートとは競合しません。その転送先から`sandbox`ネットワーク内のViteへ中継されます。ゲーム本体は外部通信しません。

## このテンプレートから新プロジェクトを作成

推奨する開始手順は次の順です。

1. テンプレートを新しいローカルフォルダーへクローンします。
2. クローン元テンプレートのGit履歴とremoteを外します。
3. 新しいGit履歴と `origin` を作成します。
4. Dev Containerで`Initialize project`タスクを実行します。
5. テスト後、初期状態をコミットします。
6. 新リポジトリへpushします。

利用時のcloneでは、サブモジュールも取得する必要があります。

```sh
git clone --recurse-submodules <repository-url>
```

通常のcloneを行った場合は、次で補えます。

```sh
git submodule update --init --recursive
npm run sync-shared-agent
```

PowerShellで2を行う例:

```powershell
Remove-Item -Recurse -Force .git
```

新しいGit履歴とremoteを初期化より先に作成します。

```powershell
git init -b main
git remote add origin https://github.com/OWNER/my-project.git
```

VS Codeの`Tasks: Run Task`から`Initialize project`を選び、プロジェクト名と任意の共有
AgentリポジトリURLを入力します。URLを空欄にすると共有Agentは導入しません。
ホスト側ポートはVS Codeが競合を回避しながら自動割り当てします。
`.git`がまだ存在しない場合でも初期化できますが、共有Agentを導入する場合は
事前に`git init`してください。`git init`直後の未追跡ファイルは
許可し、初期コミットを持つリポジトリではworktreeがcleanであることを確認します。
`origin`が設定済みなら、GitHubリポジトリURLを自動検出します。

同じ処理を端末から実行する場合:

```sh
npm run init-project -- --name my-project --shared-agent-url https://github.com/OWNER/shared-agent.git
```

`--shared-agent-url`は省略可能です。フロントエンドのローカルポートはVS Codeのポートビューで自動管理されるため、複数プロジェクトを同時に開く場合も固定ポートを設定する必要はありません。

初期化後は検証して初回コミットを作成します。

```sh
npm test
npm run build
git add .
git commit -m "Initialize project"
```

初期化では、パッケージ名、Compose名、Dev Container表示名、workspace path、
画面タイトルとゲーム上の表示名を変更します。Phaserのサンプルロジック、
テンプレート用`docs/`、GitHub Pages workflowも削除します。Git管理を開始済みの
場合はworktreeがcleanであることを確認します。初期化後はdiffをレビューし、
テスト・build後に最初のコミットを作ります。

## 共有Agentサブモジュール

共有AgentリポジトリURLは`Initialize project`へ任意で指定できます。指定した場合、
初期化処理が`.github/shared`のサブモジュール登録、commitの固定、contract検証、
instructionsの同期まで一度で完了し、承認URL・commitを
`.github/shared-agent-policy.json`へ保存します。

共有Agentリポジトリは次の契約を持つ必要があります。

```text
copilot-instructions.md
hooks.yml
agents/
skills/
bin/
```

後から追加・修復する場合は、VS Codeの`Setup shared Agent`タスクへ共有リポジトリURLを
入力するか、次を実行します。

```sh
npm run setup-shared-agent -- --url https://github.com/OWNER/shared-agent.git
```

ブランチを明示して最初の参照点を選ぶ場合は`--branch`を追加します。
Gitサブモジュールは`.github/shared`へ追加され、Gitが参照commitを固定します。
共有リポジトリの指示は`.github/copilot-instructions.local.md`と結合されて
`.github/copilot-instructions.md`へ生成します。同期処理はAgent定義やSkillを複製せず、
以前の`shared-*`生成物があれば削除します。Agent定義とSkillは
`.vscode/settings.json`から`.github/agents`、`.github/shared/agents`、
`.github/shared/skills`を直接検索対象にします。
共有Agentパックの`bin/`は、セキュアランナーのPATHへ追加されません。現契約では
`.gitkeep`以外のファイルまたは実行可能ファイルがあれば、検証が失敗します。

通常の更新では、次の順でサブモジュールのcommitを明示的にレビューします。

```sh
git -C .github/shared fetch
git -C .github/shared checkout <reviewed-commit>
npm run sync-shared-agent
# .github/shared-agent-policy.jsonのcommitもreviewed-commitへ更新
git add .github/shared .github/shared-agent-policy.json
git commit
node scripts/verify-shared-agent.mjs
```

共有リポジトリは固定commitのコードとして扱い、URL、差分、実行ファイルを
確認せずに更新しないでください。Dev Container作成時とCIではinstructionsの
同期処理が実行されます。AgentとSkillはサブモジュールを直接参照するため、
検索場所用の複製やラッパーファイルは作成しません。

## Dockerを使わないWindowsローカル実行

VS Codeをコンテナから開いていないWindowsでも、最低限のローカル隔離としてWSL 2とBubblewrapを使用します。`.vscode/settings.json`はWindowsの初期ターミナルを`Secure local sandbox`へ固定し、typecheck、test、buildタスクはnetwork namespaceを切ったoffline実行です。Agentの手動承認はVS Codeユーザー設定へ置くことを推奨します。

`.vscode/settings.json`はWindowsローカル専用のterminal profileだけを管理します。Dev Container内のAgent承認・network・credentials設定は`.devcontainer/devcontainer.json`が管理します。Windowsローカルの全プロジェクト共通でAgent保護を効かせる場合は、VS Codeのユーザー設定へ手動承認・sandbox設定を統合します。推奨テンプレートはGit管理対象外の`tmp/vscode-user-settings-recommended.jsonc`です。ローカルランナーは省略時にofflineとなり、`--online`を明示したコマンドだけがWSLネットワークを共有します。

必要条件:

- WSL 2
- WSL内のBubblewrap
- WSL内のNode.js `22.16.0`
- WSL内のnpm `10.9.2`

`node`や`npm`がWSL内にない場合、タスクは通常のPowerShellへフォールバックせず停止します。初回に、レビュー済みのランナーをワークスペース外のユーザー領域へ固定します。VS Codeはワークスペース内で変更可能なランナーを直接実行しません。次のコピー後に`$env:LOCALAPPDATA\SecureTemplate`内の3ファイルを確認してください。Git更新後は差分をレビューして、このコピーを手動で更新します。

```powershell
$trusted = Join-Path $env:LOCALAPPDATA "SecureTemplate"
New-Item -ItemType Directory -Force $trusted | Out-Null
Get-Content scripts\local-secure-run.ps1, scripts\local-secure-run.sh, scripts\local-secure-shell.ps1
Copy-Item scripts\local-secure-run.ps1, scripts\local-secure-run.sh, scripts\local-secure-shell.ps1 $trusted
```

初回導入後は次でローカル確認できます。タスクも同じ固定ランナーを使用します。

```powershell
$runner = Join-Path $env:LOCALAPPDATA "SecureTemplate\local-secure-run.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File $runner --project-path $PWD --offline npm run typecheck
powershell -NoProfile -ExecutionPolicy Bypass -File $runner --project-path $PWD --offline npm test
powershell -NoProfile -ExecutionPolicy Bypass -File $runner --project-path $PWD --offline npm run build
```

ゲームサーバーはWebSocketやブラウザー配信を含むため、Windowsローカルのoffline namespaceでは直接公開できません。ローカルランナーに`--online`を明示すればネットワーク共有は可能ですが、egress allowlistがないため通常経路として提供しません。`npm run dev`はDev Container内で実行し、loopbackのフロントエンドプロキシを使用してください。

コピーした固定ランナーはワークスペース変更の影響を受けませんが、ユーザー権限で書き込み可能なため、既に侵害されたWindowsアカウントからの防御は保証しません。コピー前に内容をレビューし、ワークスペース更新時は信頼した差分だけを再コピーしてください。このローカル構成はプロセス・PID・IPC・UTS・HOME・重要ファイルを分離し、ネットワークも既定で分離します。`--online`はWindows向けegress allowlistなしでWSLネットワークを共有するため、通常の開発ではDev Containerを使用してください。typecheck/test/buildはofflineのまま実行できます。

## テスト

ローカルでは次を順に実行します。

Dev Container内:

```sh
bash scripts/check-versions.sh
npm ci --ignore-scripts
npm run typecheck
npm test
node --test scripts/*.test.mjs
node --test .devcontainer/egress-proxy.test.mjs .devcontainer/dns-filter.test.mjs
node scripts/verify-shared-agent.mjs
node scripts/verify-bubblewrap-security.mjs
node scripts/verify-vscode-settings.mjs
npm run build
bash scripts/verify-security.sh
```

GitHub Actionsのsecurity workflowでは、`npm audit`を維持しつつTrivyも実行します。
filesystemのHigh/Critical設定ミスと秘密情報はCIを失敗させ、既存環境への影響を確認するため
lockfileとDev ContainerイメージのHigh/Critical脆弱性レポートは当面、失敗ゲートにせず記録します。
CycloneDX SBOMはCI workspaceの`trivy-sbom.cdx.json`へ生成されます。

Node.jsとDocker CLIの両方があるホストまたはCI:

```sh
node scripts/verify-compose-security.mjs
node scripts/verify-dns-security.mjs
```

`verify-compose-security.mjs`はDocker Composeの解決後設定を、`verify-dns-security.mjs`はCompose統合環境でDNS封じ込めを検査します。Dev Container内にDocker socketを公開していないため、これらはホストまたはCIで実行します。`verify-security.sh`はコンテナ内のBubblewrap実効挙動を検査するため、Dev Container内でのみ実行してください。

## バージョン固定

- Node.js: `22.16.0`
- npm: `10.9.2`
- ベースイメージ: `mcr.microsoft.com/devcontainers/javascript-node:1-22-bookworm` の multi-arch digest
- Phaser: `4.2.1`
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
- 初期化後のフロントエンドポートが利用できない: VS Codeの「ポート」ビューで`egress-proxy:3000`の転送を確認し、必要なら転送ポートを変更してURLを開き直します。
- VS Code拡張が未対応になる: 固定したVS Code本体と拡張版の組み合わせを更新します。未知の設定を黙って無視せず、出力ログを確認します。
- GitHub Copilotで無料モデルだけが表示される: まずDev Container外の同じVS Code・同じGitHubアカウントでも表示状況を比較してください。外でも表示されず、Copilot Chatは動作するがエラーも出ない場合は、コンテナの通信遮断よりGitHub側の契約・利用可能モデル・premium requestの枠・アカウント切り替えを確認してください。外では表示されるがDev Container内だけ表示されない場合は、コンテナを再ビルドし、拡張機能ビューで`GitHub Copilot`と`GitHub Copilot Chat`が有効か確認します。モデル取得や送信時のブロック先はegress proxyのログで`403 denied CONNECT`として確認できます。不足ホストは通信内容と必要性を確認してからallowlistへ完全一致で追加してください。`502 upstream failure`はallowlistではなくDNS・経路・上流接続の問題です。

## 制約

このテンプレートはプロジェクト実行とパッケージ取得を対象にしています。SSH、Gitホストへのpush、クラウド認証、Docker操作は意図的に無効です。必要な管理作業はコンテナ外で人間が承認して行ってください。
