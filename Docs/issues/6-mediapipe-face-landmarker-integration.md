### 背景／目的
MediaPipe Tasks（Face Landmarker）を導入し、顔ランドマークの推定を取得して表情指標算出の前段を整える。
参照: Docs/02_アーキテクチャ設計書.md

- 依存： #5
- ラベル：frontend

### スコープ / 作業項目
- Face Landmarkerの初期化と推定ループの実装
- 主要ランドマーク座標の取得/更新
- エラーハンドリングと推定の有効/無効切替
- FPS低下時の簡易間引き処理

### ゴール / 完了条件(Acceptance Criteria)
- [ ] 推定有効/無効でCPU負荷に差が見える
- [ ] ランドマーク取得失敗時に例外を握りUI通知
- [ ] FPSが低い場合に処理間引きが効く

---

## 進捗 / 現状（v0 足場）

- 追加: `useEstimator`（スタブ値を生成し `motioncast:pose-update` を発火）
- UI: `EstimatorTest` で有効/無効とFPSを切替し、現在値を確認
- 連携: `VrmViewer` がイベントを購読し、VRMシーンの回転に反映（暫定）

次のTODO（実装計画）
- [ ] MediaPipe Tasks Face Landmarker を動的ロードし、スタブと差し替え
- [ ] 例外ハンドリングと再試行（モデル未取得・権限等）
- [ ] 簡易平滑化（EMA/OneEuro）
- [ ] 推定値をOSC送信側に反映（スタブから置換）

### テスト観点
- ユニット: なし（外部依存）
- 検証方法: DevToolsでフレームレート/CPU使用率の目視確認

(必要なら) 要確認事項:
- モデル資材の配布（同梱/初回DL）とバージョン固定
