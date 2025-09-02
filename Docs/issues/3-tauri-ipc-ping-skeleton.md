### 背景／目的
フロントエンドからRust(Tauri)コマンドを呼び出す最小往復（ping）を実装し、IPCの土台を作る。
参照: Docs/02_アーキテクチャ設計書.md

- 依存： #1
- ラベル：backend

### スコープ / 作業項目
- Rust側に`ping`コマンドを実装・登録
- フロント側で`invoke('ping')`の型付きラッパ関数作成
- 例外処理: 失敗時のUI通知（日本語メッセージ）
- 簡易ログ出力（ON/OFF切替は後続）

### ゴール / 完了条件(Acceptance Criteria)
- [x] `invoke('ping')`で期待レスポンスを受け取れる（`pong: <payload>`）
- [x] 失敗時にユーザ向けエラーメッセージを表示（IpcPing内で例外処理）
- [x] TS側で型安全に呼び出せる（`@tauri-apps/api`の型を使用）
- [x] 実装/利用サンプルが1箇所以上存在（`app/src/features/ipc/IpcPing.tsx`）

### テスト観点
- ユニット: なし（薄いラッパのため）
- 検証方法: UIボタンからping呼出→応答表示/例外時の通知

(必要なら) 要確認事項:
- コマンド登録方針（ファイル分割/命名）

---

## 実装メモ（v0 完了）

- Rust: `src-tauri/src/lib.rs`
  - `#[tauri::command] fn ping(payload: String) -> String` を実装
  - `.invoke_handler(tauri::generate_handler![ping])` に登録
- Frontend: `@tauri-apps/api` を導入し `invoke<string>('ping', { payload })`
  - UI: `app/src/features/ipc/IpcPing.tsx`（入力→送信→結果/エラー表示）
  - 埋め込み: `App.tsx` の3カラム目に「デバッグ: IPC Ping」を配置

検証手順
1. `npm run dev` でアプリ起動
2. 「デバッグ: IPC Ping」で入力し「Ping」を押下
3. 結果が `pong: <入力>` で表示されること
4. 異常系（バックエンド切断など）でエラーメッセージが表示されること
