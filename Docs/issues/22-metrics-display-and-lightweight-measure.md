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
