### 背景／目的
VRM 0.xモデルの読み込みとThree.js + three-vrmでの表示を実装し、MVPの可視化基盤を整える。
参照: Docs/02_アーキテクチャ設計書.md

- 依存： #2
- ラベル：frontend

### スコープ / 作業項目
- three/three-vrmの導入と最小ビューワ実装
- VRMファイル選択/読み込み/破棄（リセット）
- パフォーマンス低下時の簡易対策（品質/解像度低下等）

### ゴール / 完了条件(Acceptance Criteria)
- [ ] UIからVRM 0.xファイルを読み込んで表示できる
- [ ] リセットで未読み込み状態に戻せる
- [ ] VRM 0.xを優先対応（1.0は対象外）
- [ ] 高負荷時の簡易軽減策が用意されている

### テスト観点
- 手動: サンプルVRMで表示/リセット
- 検証方法: ログ/FPSで負荷確認、クラッシュがないこと

(必要なら) 要確認事項:
- three/three-vrmのバージョン固定

---

## 進捗 / 現状（v0 プレースホルダ）

- 実装: `app/src/features/vrm/VrmPlaceholder.tsx`
  - ファイル選択/リセットのUIを追加（`input[type=file]`）
  - 選択したファイル名/サイズを表示し、`localStorage(vrm.fileName/vrm.fileSize)` に保存
  - 読み込み処理は未実装である旨を明示
- 組み込み: `app/src/App.tsx` のVRMビューア枠に配置

## 進捗 / 現状（v0.1 ビューア準備）

- 依存追加: `three`, `@pixiv/three-vrm`（将来の0.x対応用）, 型定義 `@types/three`
- ビューア枠: `app/src/features/vrm/VrmViewer.tsx` を追加（Three.js の最小枠・スピニングキューブ）
- 組み込み: `App.tsx` のVRMビューア領域に `VrmViewer` を配置（プレースホルダUIの下）

次段階 TODO
- [x] three-vrm を用いた VRM 0.x 読み込みの配線（ObjectURL 経由）
- [ ] リソース破棄（VRM/テクスチャ/GLTFLoader）の管理
- [ ] 描画負荷の最小化（pixelRatio上限/アニメ停止スイッチ等）

既知の制約/TODO
- [ ] three/three-vrm の導入と実ファイル読み込み
- [ ] VRM 0.x のみ対応を明示（1.0は対象外）
- [ ] リセットでThreeリソース破棄（将来実装）
- [ ] 低負荷モード/品質調整の検討

## 進捗 / 現状（v0.2 負荷対策・描画制御）

- 描画制御: ビューア右上に操作を追加（`viewer.running`）。描画停止/再開が可能
- FPS固定: 30/45/60 を選択し固定FPSでレンダ（`viewer.targetFps`）
- PixelRatio上限: 1.0/1.5/2.0 を選択し初期化時に反映（`viewer.pixelRatioCap`）
- リソース破棄: 新VRM読込時に既存VRMを `VRMUtils.deepDispose` で破棄、ObjectURL を適切に `revokeObjectURL`

今後の強化案
- [ ] 非表示時の自動停止（`IntersectionObserver` でキャンバスが画面外の時に停止）
- [ ] PixelRatio の動的反映（renderer を ref 化して選択直後に再設定）
- [ ] GLTFLoader およびテクスチャの追加破棄（必要に応じて）
