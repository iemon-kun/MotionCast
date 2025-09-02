### 背景／目的
WebカメラのMediaStreamを取得し、UIのプレビューに表示。MVPの入力基盤を整える。
参照: Docs/01_要件定義書.md, Docs/frontend_sample.html

- 依存： #2
- ラベル：frontend

### スコープ / 作業項目
- `getUserMedia`で映像取得（解像度/FPS指定を可能な範囲で反映）
- プレビュー表示/非表示の切替を実装
- デバイス選択/切替の再取得フロー
- 権限未許可や非対応時のUIメッセージ

### ゴール / 完了条件(Acceptance Criteria)
- [ ] 指定解像度/FPSが可能な範囲で反映される
- [ ] プレビューの表示/非表示がスムーズに動作
- [x] デバイス切替後に再取得/再生できる（v0 実装済）
- [x] 権限未許可時に対処メッセージが表示される（v0 実装済）
 - [x] 実測の解像度/FPSがUIに表示される（getSettings ベース）

### テスト観点
- E2E: カメラ選択→表示、切替、非表示
- 検証方法: 実機カメラで主要操作を手動確認

(必要なら) 要確認事項:
- デバイス列挙キー（label/ID）と権限前の列挙挙動

---

## 進捗 / 現状（v0 完了）

実装: `app/src/features/camera/CameraPreview.tsx`

- 取得/再生: `getUserMedia({ video: { width:1280, height:720, frameRate:30 }, audio:false })`
- 再生/停止: ボタンで開始/停止、クリーンアップ時に全 `track.stop()`
- デバイス選択: `enumerateDevices()` で `videoinput` を列挙しセレクト表示
  - 選択値は `localStorage("camera.deviceId")` に保存・復元
  - `devicechange` イベントで自動再列挙
  - 起動中に選択変更した場合、同制約で再取得
- エラー表示: 例外時に日本語メッセージをUI表示（権限未許可/デバイス未接続等）
- アクセシビリティ: `playsInline`/`muted` 指定、エラーは `role=alert`

既知の制約（v0）
- 解像度/FPSのUI反映は未実装（固定: 1280x720/30fps）
- UI構造は暫定。`Docs/frontend_sample.html` の「カメラ設定」セクションに準拠する必要あり
- デバイス名（label）は権限未許可時に空になる場合あり（仕様）

次のTODO（v1 目標）
- [ ] 実測FPSの平滑化/計測（必要時）
- [ ] UIを `Docs/frontend_sample.html` の構造・文言に合わせる
- [ ] メトリクス拡張（推定FPS/遅延など）

テスト観点（更新）
- 選択保存/復元: 再起動後に前回選択デバイスが既定で選ばれる
- デバイス増減: 接続/切断→セレクトに反映、起動中は選択保持
- 例外系: 権限未許可/デバイスなし時にエラーメッセージ表示
