---
issue: 3
---
### 背景／目的
推定/送信の軽量メトリクス（FPS/遅延/送信レート）をUIに表示して、負荷の把握と調整を可能にする。あわせて #24 の安定化フェーズ（normal/hold/fade）・抑制回数等の簡易カウンタも表示する。
参照: Docs/frontend_sample.html

- 依存： #11
- ラベル：frontend

### スコープ / 作業項目
- 軽量な計測ロジックの実装（最小）
- メトリクス表示UI（ON/OFFで負荷差が出る）
- 計測でクラッシュしない安全策
 - #24 のフェーズ/抑制回数/現在の可視性など、安定化関連の簡易メトリクス表示

### ゴール / 完了条件(Acceptance Criteria)
- [x] 推定FPS/平均遅延/送信レートが表示される
- [x] 表示ON/OFFで負荷差が確認できる
- [x] 計測によりクラッシュや著しい劣化がない
 - [x] #24 のフェーズ/抑制回数が確認できる

### テスト観点
- 手動: 表示/非表示と負荷差
- 検証方法: DevTools/Activity Monitorで確認

(必要なら) 要確認事項:
- 計測のサンプリング間隔とコスト

### 検証メモ（手動）
- 環境: 送信 `vmc` / 60fps 設定
- 結果: 推定FPS ≈ 18 / 送信 ≈ 19Hz / 平均遅延 ≈ 26.9ms
- 安定化カウンタ: hold 0 / fade 2 / reacq 7
- 所見: メトリクスONでも体感劣化なし・例外/クラッシュなし

## 実装メモ（v0 完了）
- 追加イベント（Bridge→UI）:
  - `motioncast:bridge-metrics` 詳細 `{ hz, meanLatencyMs }`
  - `motioncast:stabilizer-metrics` 詳細 `{ hold, fade, reacq }`
- 有効化トグル（UI→Bridge）:
  - `motioncast:metrics-enabled` 詳細 `boolean`（メトリクス欄の開閉と連動）
- 集計/表示:
  - 推定FPSは `motioncast:pose-update` を1秒窓でカウント
  - 送信Hz/平均遅延は Bridge 側で1Hz更新してUIへ通知
- 主要変更ファイル:
  - `app/src/features/osc/OscBridge.tsx`
  - `app/src/App.tsx`
  - 依存追加なし、既存挙動への回帰影響なし

## 追加実装（表情ソースの選択・描画分離）
- 表情送信ソースの選択を追加（既定: raw / オプション: VRM同期）
  - UI: `OscTest` にセレクト追加（localStorage: `osc.exprSource`）
  - VRM同期時は `VrmViewer` が適用した表情値を `motioncast:vrm-expression` で公開
  - Bridge は `motioncast:expr-source` / `motioncast:vrm-expression` を購読し送信用値を選択
- ビューの描画と送信用リターゲット計算を分離
  - `VrmViewer` に「描画停止」「送信計算停止」を個別トグル化
  - 描画停止でも送信用のワールド行列更新とQuat算出は継続可能
- 関連ファイル:
  - `app/src/features/osc/OscTest.tsx`（UI追加）
  - `app/src/features/vrm/VrmViewer.tsx`（表情値公開・描画/計算分離）
  - `app/src/features/osc/OscBridge.tsx`（表情ソース選択）
