---
issue: 6
---
### 背景／目的
最小構成のデスクトップアプリ基盤（Tauri + Vite + React + TS）を整備し、macOSで開発着手可能な状態を作る。
参照: Docs/02_アーキテクチャ設計書.md, Docs/01_要件定義書.md

- 依存：
- ラベル：infra, build

### スコープ / 作業項目
- Tauri + Vite + React + TypeScriptのプロジェクト初期化（macOS優先）
- ESLint/Prettierの基本設定追加（推奨ルール）
- 起動スクリプトとREADMEのセットアップ手順整備
- 初期テンプレの不要コード削除（空画面）

### ゴール / 完了条件(Acceptance Criteria)
- [ ] macOSで`tauri dev`が起動し空画面を表示
- [ ] TypeScript/ESLint/Prettierが動作（lintでエラーなく通る）
- [ ] READMEに環境要件と起動手順が記載
- [ ] 不要サンプル削除（余計なUIやファイルがない）

### テスト観点
- ユニット: なし（初期化）
- 検証方法: `npm i`→`npm run tauri dev`がmacOSで起動し、コンソールエラーが出ないこと

(必要なら) 要確認事項:
- Node/Tauri/Rustの推奨バージョン固定範囲

