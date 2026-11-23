---
name: game-context
description: 2Dブラウザーゲーム固有のScene、時間、入力、ブラウザー、アセット、性能制約を確認する。
---

# 2D Browser Game Context

ゲーム依頼で追加確認が必要な場合だけ適用する。

## 確認項目

- Sceneの生成・破棄、状態所有、状態遷移
- 固定タイムステップ、delta time、pause/resume、focus喪失
- keyboard、mouse、touch、resize、再読込
- 対象ブラウザーと解像度
- FPS、フレーム時間、ロード時間、メモリ
- アセット失敗、未知入力、低FPS
- 決定論またはネットワーク同期が必要か
- アセットライセンスと外部通信

ゲーム固有項目を汎用Agentの共通完了条件へ書き込まず、このSkillから
Task Packetまたはドメイン固有Hookへ引き渡す。
