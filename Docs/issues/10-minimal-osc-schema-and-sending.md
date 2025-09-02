### 背景／目的
cluster互換の最小OSC項目（Blink/Mouth/Head）を定義し、送信ループを実装する。
参照: https://docs.cluster.mu/creatorkit/ , https://docs.cluster.mu/script/index.html , Docs/02_アーキテクチャ設計書.md

- 依存： #4, #7
- ラベル：backend

### スコープ / 作業項目
- 最小OSCアドレス/値形式の定義（ドキュメント化）
- 送信ループ実装（有効時のみ送信・無効時停止）
- Head姿勢（最小）とBlink/Mouthの送出

### ゴール / 完了条件(Acceptance Criteria)
- [x] 最小OSCスキーマをドキュメント化（アドレス/型/範囲）
- [x] Blink/Mouth/Headが設定レートで送出される（スタブ値）
- [x] 無効時は送信停止（ゼロ送出しない）
- [x] レート変更に追従する

### テスト観点
- リクエスト: 送信ループの開始/停止/レート
- 検証方法: 受信ツールで値更新/停止を確認

(必要なら) 要確認事項:
- cluster仕様の最小必須項目の確定

---

## 最小スキーマ（v0）

- `/mc/ping` args: [string] 例: `"ok"`（通信用の生存確認）
- `/mc/blink` args: [float] 範囲: 0.0–1.0（まばたき）
- `/mc/mouth` args: [float] 範囲: 0.0–1.0（口開き）
- `/mc/head` args: [float yaw, float pitch, float roll] ラジアン（-1.0〜1.0 目安）

送信先: UDP/OSC (`addr`, `port`)
レート: `15/30/60` fps（将来拡張可）

## 実装メモ（v0 完了）

- Rust（Tauri）: `src-tauri/src/lib.rs`
  - 依存: `rosc`
  - コマンド: `osc_start(addr: String, port: u16, rate_hz: u32)`, `osc_stop()`
  - バックグラウンドスレッドで送信。停止は `AtomicBool` で制御、`JoinHandle` を `join()`
- Frontend: `app/src/features/osc/OscTest.tsx`
  - 宛先/ポート/レートの入力と開始/停止ボタン
  - 状態表示と最小スキーマの案内文言
  - 値は `localStorage` に保存

検証
- 受信側（例: `oscdump`, `python-osc`）で `/mc/*` が受信できること
- 開始/停止/レート変更が即時反映されること
