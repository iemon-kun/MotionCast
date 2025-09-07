---
issue: 18
---
### 背景／目的
重要設定を`config.json`としてディスク保存/読み込みできるようにし、再起動後も状態を維持する。
参照: Docs/02_アーキテクチャ設計書.md

- 依存： #3
- ラベル：backend, infra

### スコープ / 作業項目
- tauri-plugin-store等を用いたJSON保存/読込の実装
- 起動時の読込と保存UIの実装（最小）
- 破損/欠損時のデフォルト復旧処理

### ゴール / 完了条件(Acceptance Criteria)
- [x] 起動時に`config.json`を読み込める（localStorageへ反映）
- [x] 保存操作でファイルへ書き出せる（ヘッダーの「保存」）
- [x] 破損時に安全なデフォルトへ復旧する（空オブジェクト＋バックアップ）
- [ ] 保存/読込の失敗時にUIで通知（最小トースト等は後続）

### テスト観点
- ユニット: デフォルト復旧/例外
- 検証方法: 設定変更→保存→再起動→復元確認

(必要なら) 要確認事項:
- 保存対象キーのスコープ（最小に限定）

---

## 実装メモ（v0 完了）

- 保存先: `~/.config/MotionCast/config.json`（Windowsは`%APPDATA%/MotionCast/config.json`）
- Rust（Tauri）:
  - `config_load() -> Result<String, String>` 読込/JSON検証（破損時は`.bak`に退避し `{}` を返す）
  - `config_save(content: String)` JSON検証→一時ファイル→`rename` で安全保存
- Frontend:
  - 起動時: `hydrateLocalStorageFromConfig()` で `config.json` を localStorage に適用（既定キーのみ）
  - 保存: ヘッダーの「保存」押下で localStorage の既定キーを書き出し

対象キー（暫定）
- `camera.deviceId`, `camera.resolution`, `camera.fps`, `camera.visible`
- `viewer.running`, `viewer.pixelRatioCap`, `viewer.targetFps`
- `osc.addr`, `osc.port`, `osc.rate`
- `vrm.fileName`, `vrm.fileSize`

今後の改善
- [ ] 失敗時のUI通知（トースト/メッセージ）
- [ ] スキーマ化（型/範囲の検証）とマイグレーション
