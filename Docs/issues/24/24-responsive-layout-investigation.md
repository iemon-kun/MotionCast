### 背景／目的
ウィンドウサイズ変更時にUIがはみ出す・比率が崩れる・描画がぼやける等の事象を再現・切り分けし、恒久対応を整理する。既に暫定対策を実装済みだが、抜けや回帰を防ぐための調査項目と確認手順を整備する。

- 参照: app/src/App.css, app/src/features/camera/CameraPreview.tsx, app/src/features/vrm/VrmViewer.tsx
- 関連: #2, #5, #8, #22

### スコープ / 作業項目
- 再現条件の整理（解像度・DPR・サイドバー開閉・グリッド切替）
- 既存対策の確認（ResizeObserver/実描画サイズ同期/PixelRatioクランプ/レスポンシブCSS）
- 懸念点の追加対策（モバイル閾値・サイドバーオーバーレイ・タイポグラフィ縮退）
- 確認チェックリストの作成（幅×DPR マトリクス）

### 既知の対策（実装済み）
- Sidebar はみ出し対策: `.sidebar.open { width: min(320px, 100%); }`、`.sidebar-inner { width: 100%; }`
- グリッドの自動詰め: `.content-grid { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }`
- 余白の縮退: gap/padding を `clamp()` 化
- Video の実描画サイズ同期: `ResizeObserver` で `video.width/height = containerRect` 同期（狭幅でもぼやけ/引き伸ばし軽減）
- Canvas(Three.js) の安全化: `getBoundingClientRect()` 基準で整数寸法、`pixelRatio` を `min(devicePixelRatio, cap, 4096/width, 4096/height)` でクランプ、`ResizeObserver + rAF` スロットリング

### ゴール / 完了条件 (Acceptance Criteria)
- [ ] 横スクロールが出ない（1280/1024/768/480px 各幅で確認）
- [ ] サイドバー開閉/グリッド切替時にプレビュー/ビューアがウィンドウ内で比率維持
- [ ] DPR=1/1.5/2 環境で描画が極端にぼやけたり巨大キャンバスにならない
- [ ] 最小端末幅（~360px相当）で機能退避/縮退が成立（テキスト/ボタンの溢れがない）

### 調査手順（再現/確認）
1. 幅: 1280/1024/768/480px で表示確認（横スクロール有無、はみ出し）
2. DPR: DevTools のデバイスシミュレーションで 1/1.5/2 を切替
3. サイドバー: open/closed 切替でカメラ/VRM枠の再レイアウト挙動を確認
4. プレビュー/ビューア: アスペクト比維持（16:9）と実描画解像度が概ね一致すること
5. Canvas/Video: リサイズ直後に `width/height` 属性が直近のコンテナ矩形と整合（ログ必要なら一時的に出力）

### 懸念点と追加対策（案）
- [ ] モバイル閾値の明確化（例: `@media (max-width: 640px)` で `.viewer-box/.camera-preview { max-height: 40vh; }` 調整）
- [ ] サイドバーを一定幅以下でオーバーレイ化（表示/非表示の切替のみでメインを広げる）
- [ ] タイポグラフィ縮退（見出し/本文の `clamp()` 微調整、ボタンpaddingの段階的縮退）
- [ ] 画像/アイコンの最大幅制約（`max-width: 100%` の徹底）

### 影響範囲 / リスク
- CSS中心の変更でJS依存は最小。ResizeObserver/rAF周りは既存対策のため影響小
- 既存の比率/余白に慣れた見た目との差分が出る可能性

### 参考（該当ファイル）
- `app/src/App.css`: レイアウト/レスポンシブ/比率/余白
- `app/src/features/camera/CameraPreview.tsx`: `<video>` 実描画サイズ同期
- `app/src/features/vrm/VrmViewer.tsx`: Three.js renderer サイズ・pixelRatio クランプ

### メモ（現状の既知事象）
- 稀に OS/DPR 切替直後に 1フレームだけキャッシュ寸法に依存するケースあり → rAF スロットリングで概ね解消
- サイドバーを極端に広げた後すぐ閉じる操作で、1フレームだけ Canvas が旧寸法を保持 → 次フレームで解消

### スクリーンショット
- 起動時
  
  ![起動時](./%202025-09-03%2010.26.25起動時.png)

- ウィンドウサイズ変更時
  
  ![ウィンドウサイズ変更時](./%202025-09-03%2010.27.36ウィンドウサイズ変更時.png)

補足: 先頭にスペースが含まれるファイル名のため、Markdown ではスペースを `%20` としてエンコードして参照しています（レンダラによってはリンクが機能しない場合があるため、次回以降は先頭スペース無しの命名を推奨）。
