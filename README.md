# MotionCast

VRMトラッキングの数値をローカルで推定し、VRMビューア表示とUDP/OSC送信を行うデスクトップアプリ（Tauri + React + TypeScript）。ローカル完結・軽量配布・無料運用を重視する。

## 目的
- ローカルのWebカメラで表情・姿勢を推定
- VRM 0.x ビューアでプレビュー
- 最小限のパラメータをUDP/OSCで送信（低遅延）

## 技術スタック（計画）
- フロントエンド: TypeScript + React + Vite + Three.js（+ three-vrm）
- ネイティブ: Tauri（Rust）+ rosc（OSC送信）
- 推定: MediaPipe Tasks JS（Face/Pose）
- 状態管理: Zustand（予定）
- CI/CD: GitHub Actions + Releases

## 前提ソフトウェア（開発環境）
- Node.js LTS（推奨）
- Rust（stable）/ cargo（`rustup`推奨）
- Tauri 前提ツール（macOS: Xcode Command Line Tools 等）

macOS 例:
```
brew install node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup default stable
# どちらか一方
npm i -g @tauri-apps/cli
# または
cargo install tauri-cli
```

## セットアップ（初回）
このリポジトリをクローン後、依存をインストールする。
- 参照: `Docs/issues/1-tauri-vite-react-ts-setup.md`
- 参照: `Docs/02_アーキテクチャ設計書.md`

コマンド例:
```
# ルート（Tauri CLI など）
npm ci

# フロントエンド（Vite + React + TS）
cd app
npm ci
```

コード雛形は生成済み（`app/` にフロント、`src-tauri/` に Tauri）。

## 開発フロー（当面）
1. 小さなタスク単位で変更（最小差分）
2. 変更内容の確認後、Conventional Commits でコミット＆プッシュ
3. UI は `Docs/frontend_sample.html` の構造・命名・動作を踏襲
4. 検討・判断は `AGENTS.md` の運用ルールを優先

コミット例:
```
feat(ui): 設定サイドバーにFPS選択を追加

UIデモに合わせてFPS選択UIを実装。既定値は30fps。
選択値はlocalStorageに保存し、再読込後も維持。

Refs: Docs/frontend_sample.html
```

## ドキュメント
- UIサンプル: `Docs/frontend_sample.html`
- 要件定義: `Docs/01_要件定義書.md`
- アーキテクチャ: `Docs/02_アーキテクチャ設計書.md`
- サイトマップ: `Docs/05_サイトマップ.md`
- 実装計画・課題: `Docs/MotionCast実装計画・Issue管理.md`

E2E/スモークテストの方針:
- 参照: `Docs/issues/23-e2e-smoke-test-and-guide.md`

## 使い方（開発）
- 開発起動（Tauri + フロント同時）: `npm run dev`
- フロント単体起動（ブラウザで確認）: `npm run app:dev`
- Lint/整形（app/ 配下）:
  - `cd app && npm run lint`
  - `cd app && npm run format:check`

## ビルド
- デスクトップアプリのビルド: `npm run build`
  - 生成物: `src-tauri/target/` 配下（OS/アーキテクチャ別）

注意: macOS の配布にはコード署名/公証が必要になる場合がある（CI 設定は後続Issue）。

## 注意事項（セキュリティ/品質）
- `.env` や個人情報はコミットしない
- 入力値は検証・エスケープ（XSS 等を考慮）
- `innerHTML` 直書き禁止。`textContent` など安全APIを使用
- 依存追加は最小限。理由と代替を明記
