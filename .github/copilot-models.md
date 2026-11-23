# Copilotモデル運用

## 目的

このファイルは、共有Agentで必須指定するモデルの現在の既定方針と、
変更履歴を記録する場所です。複数人が同一プロジェクトで作業しても
モデル経路が個人設定によって変わらないよう、`.github/shared/agents/` の
frontmatterへ `model` と `model-policy: required` を設定します。

この文書は設定の正本と変更記録を担い、実際の強制は共有Agentのfrontmatterで
行います。個人のモデルピッカーによる暗黙の上書きを既定にはしません。

## 現在の既定

最終確認日: 2026-11-23

| 役割 | 既定モデル | 変更時の判断基準 |
| --- | --- | --- |
| Direct / `conductor` | MAI Code 2 | 要件解釈、工程判断、複数ファイルの設計・調査 |
| `implementer` | MAI Code 2 Flash | 承認済み仕様に基づく範囲限定の実装 |
| `verifier` | MAI Code 2 Flash | テスト、build、証拠収集、仕様対応の確認 |
| `architect` / `reviewer` | MAI Code 2 | 高リスク変更の設計判断と独立レビュー |

仕様が未確定、失敗の影響が大きい、2回以内の再試行で解決しない場合は、
軽量モデルを直接使い続けず、Direct / Conductorまたは独立レビューを担う
モデルへ引き上げます。

## 変更方法

1. 変更前のモデルと変更後のモデルを決める。
2. 変更理由、期待する品質・コスト効果、試行期間を記録する。
3. `.github/shared/agents/` の対象Agentで `model` と `model-policy` を更新する。
4. 代表タスクで実際に選ばれたモデルと結果を確認する。
5. 変更を維持する場合は「変更履歴」と「現在の既定」を更新する。

`required` はチーム共通のモデルを保証するための設定です。Copilot Fusionなど
別の運用を採用する場合は、対象Agentの `model-policy` を意図的に変更または
解除し、理由、適用期間、解除条件を変更履歴へ記録します。

カスタムAgentとしてユーザーが選択できるのは `conductor` だけです。
`implementer`、`verifier`、`architect`、`reviewer` は
`user-invocable: false` とし、`conductor` からのみ委任します。

## 検証項目

モデル変更後の代表タスクでは、少なくとも次を記録します。

- 指定モデルが実際に使われたか
- 親と子それぞれの呼び出し回数
- 入力・出力トークンと総クレジット
- 再試行回数とエスカレーション
- タスク完了時間
- テスト、build、typecheck、lintの結果
- 人手介入量と品質上の制約

## 変更履歴

| 日付 | 変更者 | 変更内容 | 理由 |
| --- | --- | --- | --- |
| 2026-11-23 | 人間 | 初版。Direct/設計をMAI Code 2、まとまった実装/検証をMAI Code 2 Flashとし、共有Agentへ `model-policy: required` を適用。Agent名から `game-` を除去し、`conductor` のみをユーザー選択可能に変更 | 複数人でも同じ既定モデルと委任経路を再現し、利用者の選択対象を単一窓口にする |
