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

## 調査まとめ（Web: 精度向上と軽量化）

目的・対象・前提:
- 目的: Web（Tauri+Vite+React）環境で、トラッキング精度を上げつつ計算を軽量化し、体感品質を落とさない運用指針を確立する。
- 対象: MediaPipe Tasks（Face/Pose Landmarker）, three-vrm, 既存の Stabilizer(#24) と OSC 送信経路。
- 前提: UI/構造は `Docs/frontend_sample.html` を踏襲。ブラウザは Chromium 系優先。時間基準は `performance.now()` の単調増加時刻で統一。

決定事項（提案）:
- 時間の一貫性: 取得→推定→平滑→適用→送信の各段で `ts` を受け渡す。平滑・予測は `dt` を用いた時間依存式にする。
- 角度はクォータニオン基準: Eular は表示のみ。内部は `quat` の `slerp` と角速度クランプで安定化。
- 動的負荷制御: 入力解像度/フレーム間引き（frame stride）/推定fps/送信fpsを予算に応じて自動調整（最小構成は1秒ごとの調整）。
- 計測は常時軽量・表示は低頻度: メトリクス集計は1Hz、DOM更新は必要最小限（テキスト1箇所、ARIA配慮）。
- 外れ値は段階処理: 可視性ゲート→残差/速度ゲート→ホールド/フェード/再取得（#24）で段階的に緩和。

未決事項（要検討）:
- MediaPipe の推定を Web Worker + OffscreenCanvas に分離（描画と推定の分離の是非、対応ブラウザ）。
- Tauri 側 `invoke` への TypedArray 受け渡し最適化（JSONからの移行可否/利得）。
- 一部ジョイントの可変レート（重要度に応じて送信Hzを下げる）。

推奨テクニック（段階別）:
- 取得・前処理
  - 入力解像度の自動スケール: 既定 720p（1280×720）→負荷高時 960×540/640×360 へ段階的に縮小。
  - ROI 収束: 肩幅/腰中心から上半身領域を推定し、次フレームのクロップに利用（画像処理は OffscreenCanvas で）。
  - `MediaStreamTrack.applyConstraints` を用いた fps/解像度制御。設定変更はラッチして反映（頻繁な切替は避ける）。
- 推定（MediaPipe Tasks）
  - モデル選択: Pose は `lite` 優先、Face は標準。`numPoses=1` 固定。信頼度閾値は 0.5±0.1 で検討。
  - フレーム間引き: 顔30fps/ポーズ15〜30fps。負荷時は 2フレームに1回 `detect`、間のフレームは前回結果を保持。
  - 時間渡し: `detectForVideo(video, ts)` の `ts` は `performance.now()` を渡して揃える。
- 平滑・予測
  - One Euro Filter（座標用）: 低速時は強、速い動きでは弱める動的平滑。推奨初期値: `min_cutoff=1.6〜2.0`, `beta=0.005〜0.02`, `d_cutoff≈1.5`。
  - EMA の時間依存化: `alpha = dt / (tau + dt)`（例: `tau_base=0.06` を速度で縮小）。現行の固定 `alpha` を `dt` ベースへ。
  - クォータニオン平滑: 方位は `slerp(prev, meas, t)`。`t` は速度に応じて 0.1〜0.5 の範囲に自動調整。
  - 角速度クランプ: 現行の deg/s クランプを維持しつつ、`maxRad = degPerSec * dt` を徹底（既に実装済）。
  - 予測（低コスト）: `dq = q_t * inv(q_{t-1})` を軸角に変換して角速度推定、`q_pred = normalize(exp(ω·Δt) * q_t)` を 1 フレ以内で使用。
- 外れ値・安定化
  - 可視性（`visibility`）で一次ゲート: しきい値は `0.3±0.1`。部位合成は平均/最小でロバスト化（現行実装と整合）。
  - 残差・速度ゲート: 予測との差分角が閾値超過なら当該フレームを抑制/減衰して滑らかに復帰。
  - フェーズ管理: `normal → hold → fade → reacq` の既存#24設計を継続。再取得は `slerp(prev, meas, t)` で段階復帰。
- 送信・ランタイム最適化
  - 送信レート30Hz既定。負荷検知時は 20Hz まで段階ダウン。表情のみは 15Hz に抑える選択肢。
  - メモリ/GC: 毎フレのオブジェクト生成を避け、`Float32Array` を再利用。配列長固定・リングバッファで集計。
  - `invoke` 呼び出しを 1フレ1回に集約し、ペイロードは数値配列優先。ログ/デバッグ文字列はトグルで無効化。

具体パラメータ例（初期プリセット）:
- フレーム/解像度
  - Face: 30fps / Pose: 20fps（重い端末は 15fps）/ 送信: 30Hz
  - 入力: 1280×720（負荷高時 960×540 → 640×360）
- One Euro（座標）
  - `min_cutoff=1.8`, `beta=0.01`, `d_cutoff=1.5`（手首は `min_cutoff=2.2`）
- EMA（座標・可視性）
  - `tau_base=0.06`, `alpha=dt/(tau+dt)`, 速度が速いとき `tau=0.03` まで縮小
- 角速度クランプ（deg/s 上限）
  - chest: 120 / shoulder: 180〜220 / upper-lower: 240〜320 / wrist: 360〜540
- 再取得ウィンドウ
  - hold: 400ms / fade: 800ms / reacq: 300ms（現行既定）

実装ポイント（このリポジトリへの当て込み）:
- `app/src/features/estimation/useFaceLandmarker.ts`
  - 顔向き: 4×4行列からクォータニオンを構築し、オイラー化は最後に限定。`slerp` 平滑に切替。
  - フレーム間引き: 現状 ~30fps にスロットル済。負荷監視で 20fps に落とす分岐を追加可能。
- `app/src/features/estimation/usePoseLandmarker.ts`
  - 現在の EMA を `dt` 依存に変更。必要に応じて簡易 One Euro を導入（各ランドマークの速度を内部推定）。
  - `worldLandmarks` の可視性を指数移動平均で安定化し、Stabilizer の可視性判断へ供給。
- `app/src/features/osc/OscBridge.tsx`
  - 角速度クランプ済み。`dt` 由来値のばらつき対策として `dt` の最小/最大を 1/90〜1/15 にクリップ。
  - 再取得フェーズで `slerp(prev, meas, t)` の `t` を可視性×時間で調整（暗所・遮蔽時に過剰飛び込みを抑制）。
- `app/src/features/osc/OscTest.tsx`
  - 実験用 UI: 入力解像度/推定fps/送信fps/OneEuro(min_cutoff,beta)/角速度上限の簡易プリセットを追加（localStorage 永続）。

追加実装（Hands: 両手ランドマーク検出とイベント公開）
- Hook: `app/src/features/estimation/useHandLandmarker.ts`
  - MediaPipe Tasks HandLandmarker(lite)で両手（最大2）を検出。
  - 出力: `motioncast:hands-3d`（detail: 配列）。各要素は `{ handed, world[0..20], curls{thumb..pinky}, wrist, ts }`。
  - curlsは関節の角度から0..1に正規化（おおよそ120度で1.0）。
- UI: `EstimatorTest` に Hands トグル/簡易表示（左右の平均カール）を追加。
- 今後: VRMの指ボーン適用（Proximal/Intermediate/Distalへカールを割当）と、VMCの指ボーン出力を段階導入。

計測と検証方法（軽量）:
- 集計: 1Hz で `rAF` 連続数→Hz、`now - ts` の平均→推定→送信のパイプ遅延、フレーム間隔の分散→ジッタ。
- ドロップ: 推定トリガ/送信トリガのカウント差分で粗く推定。目標は < 3%（10秒移動平均）。
- CPU/GC: DevTools Performance で 10秒プロファイル。オブジェクト割当/フラグメントが顕著な箇所を削減。
- 主観評価: 直線軌道の腕振り・停止→開始の応答性（オーバーシュート/遅延）を観察。

優先度付き実験（小さく刻む）:
1) 推定fps/入力解像度の自動段階ダウン（1秒ごと判定）
2) EMA を `dt` 依存に変更し、角速度クランプと整合（既存 Stabilizer と干渉しないことを確認）
3) 顔向きのクォータニオン化（`useFaceLandmarker`）と `slerp` 平滑
4) Pose 2D/3D に簡易 One Euro を導入して微小ノイズ減衰
5) `invoke` ペイロードの TypedArray 化/集約送信（効果測定後に採否判断）

備考:
- MediaPipe の `worldLandmarks` は右手座標・メートル相当。座標系変換時の左右反転/奥行き符号に注意。
- VRM への適用は `q_map` の算出が要。胸・肩の軸定義は REST 姿勢からとり、推定軸との符号整合を一貫化。

## 送信フォーマット比較と連携設計（VRChat OSC Trackers vs VMC）

目的・前提:
- 目的: トラッキング後の“出口”として、FBT用途（VRChat/cluster）とポーズ直制御（VMC）の両立を図る。
- 前提: 片方だけでなく、利用シーンに応じて切替可能な実装とし、将来的な“同時出力”にも拡張できる構造にする。

概要比較（要点）:
- VRChat (OSC) Trackers: 世界座標[m]の位置 + オイラー角[deg]を `/tracking/trackers/{1..8}/position|rotation` 等で送る。FBT（IK）前提の“仮想トラッカー入力”。既定ポート受信9000（変更可）。
- VMC Protocol: `/VMC/Ext/Bone/Pos` でボーン名 + 位置 + クォータニオン回転、`/VMC/Ext/Blend/*` で表情。親ボーン基準のローカル回転が前提。典型ポート39539/39540。
- 座標/回転の違いが本質: VRChatはワールド+Euler、VMCはローカル+Quat。適用対象もIK vs ボーン直適用で異なる。

MotionCastでの出口設計（提案）:
- 内部フレーム（Adapter入力）を統一: 下記の“内部表現”を `OscBridge` で構築し、送信Adapterへ渡す。
  - 時刻: `ts`（ms, performance.now）
  - 顔: yaw/pitch/roll（rad, quat併用可）, blink, mouth
  - 上半身ボーン（ローカル回転）: chest, shoulders, upper/lower arms, wrists（Quat, VRM基準）
  - 身体トラッカー用ワールド情報: hips, chest, head, knees, ankles, elbows, wrists（位置[m], 方向/基準ベクトル）
  - 可視性/信頼度: 各部位の visibility（0..1）
- 出力Adapter（切替可能、将来は多重出力も）:
  - Adapter: ClusterBasic（現行）… 顔まわりの簡易アドレス。
  - Adapter: VRChatTrackers（新規）… `/tracking/trackers/*` に位置[m]/Euler[deg]を送る。
  - Adapter: McUpper（現行）… `/mc/ub/*` で上半身Quatを送る（デバッグ/独自用途）。
  - Adapter: VMC（現行強化）… `/VMC/Ext/Bone/Pos` で上半身ボーンQuatを送る。表情は `/VMC/Ext/Blend/*` を追加予定。

VRChat Trackers マッピング指針（上半身優先・段階導入）:
- 最小構成（上半身のみでも動作確認用）:
  - head → `/tracking/trackers/head/position|rotation`
  - chest → `/tracking/trackers/1/position|rotation`（初期割当。実際はクライアント側でID割当を行う想定）
  - wrists（L/R） → `/tracking/trackers/2|3/...`
- 全身構成（Pose Landmarkerのworld座標を利用）:
  - hips（腰中心）, chest, head
  - knees（L/R）, ankles（L/R）, elbows（L/R）, wrists（L/R）から優先度順に選定（最大8）。
- 回転: Eulerはローカル軸順の差で事故が起きやすい。内部はQuatで作ってからVRChat既定（Z→X→Y適用）のEulerに変換する（要検証）。
- 座標系: MediaPipe worldは右手座標。Unity/VRChatは左手系+Y up。Z符号反転（basis flip）で揃える。

VMC マッピング指針（上半身）:
- 送信アドレス: `/VMC/Ext/Bone/Pos "BoneName" px py pz qx qy qz qw`
- BoneName: Chest / LeftShoulder / RightShoulder / LeftUpperArm / RightUpperArm / LeftLowerArm / RightLowerArm / LeftHand / RightHand（現行Rust実装にあり）。
- 座標系調整: three.js(右手)→Cluster/VMC(左手)の基底反転は既実装（`quat_flip_z_basis`）。必要に応じて hips/chest の位置も送る（現状は0）。

UI・設定（`Docs/frontend_sample.html`の方針に沿う）:
- 送信フォーマット: `Cluster / VRChatTrackers / McUpper / VMC`
- 宛先/ポート: 任意（VRChat 9000推奨、VMC 39539/39540 典型）
- 上半身のみ/全身: 切替（全身はPose Landmarkerの下半身を有効化）
- 表情送信: off/raw/VRM同期（現状の exprSource と統合）
  - 最小対応: `vrchat` スキーマを追加（head/rotation と chest/hips/wrists の position[m]、head positionはnose取得時に送出）。

実装計画（最小差分で段階導入）:
1) Adapter層を概念導入（現状は `Schema` に近い）：Rustの `Schema` に `VrchatTrackers` を追加。`osc_start` の送信ループで `/tracking/trackers/*` 出力を実装。
2) `usePoseLandmarker` を拡張：下半身3D（hips/knee/ankle）を `UpperBody3DDetail` 相当の新型に拡張し、`OscBridge` へ供給。
3) `OscBridge` に“内部フレーム”を構築する薄い層を追加：
   - 位置[m]: MediaPipe world（m相当）を採用。原点・向きは初期フレームでキャリブレーション。
   - 回転: 部位方向ベクトル→Quat化→VRChat用Euler化（ZXY）/VMC用Quatを分岐。
4) UIに送信フォーマット切替を追加（OscTestのセレクトに `vrchat` を追加）。
5) 将来: BlendShapeのVMC送出（Blink/Mouth/表情プリセット）と“多重出力”を設ける（例: VRChatTrackers + VMC/Blend）。

## キャリブレーション（基底/スケール/オフセット）

決定事項:
- 起動/任意のタイミングで「肩幅・胸−腰ベクトル」から身体固有の基底を構築し、MediaPipe world座標→内部“トラッカー空間”へ変換。
- スケールは肩幅[m]（既定0.38）から自動推定。Z軸はRust側で左手系へ反転。

操作/UI:
- `OscTest` に「肩幅[m]」入力と「キャリブレーション」ボタンを追加。
  - イベント: `motioncast:tracker-calib-params { shoulderWidthM }`
  - イベント: `motioncast:calibrate`
 - 位置合わせ/方位合わせ:
   - ヨー[deg]（-180..180）とオフセット offX/offY/offZ[m] 入力を追加 → `motioncast:tracker-offset-params` を随時送出。
   - 「原点=現在」ボタンで現在のHip位置を原点に設定 → `motioncast:tracker-set-origin`
   - 「向きを前に」ボタンで現在の頭−腰ベクトルの向きを+Zに合わせる（ヨーを自動設定）→ `motioncast:tracker-align-forward`

変換ロジック（OscBridge内）:
- 原点: 両Hipの中点（calib時）
- 基底: X=右肩−左肩、Y=肩中点−Hip中点、Z=X×Y（正規直交化、YをZ×Xで再算出）
- スケール: `shoulderWidthTarget / |右肩−左肩|`
- 変換: `p1 = scale * [dot(p−origin, X), dot(p−origin, Y), dot(p−origin, Z)]`
- 方位/オフセット: `p2 = R_y(yawDeg) * p1 + offset`
- 送信: Rust側で `Z→-Z` の基底反転後、VRChat Trackersへ `/tracking/trackers/*/position` として[m]送出。

テスト観点（連携検証）:
- 端末: clusterクライアント（OSC Trackers有効）・VMC対応アプリ。
- チェック: 位置スケール（1=1m）、向き（左右反転・床面）、Euler順序（回転のねじれがない）、遅延（<60ms目標）。
- 回帰: Stabilizer（#24）のホールド/フェード挙動と干渉がない（VRChat出力は位置・姿勢のうち姿勢も滑らかさを保つ）。

留意点・落とし穴:
- VRChat TrackersのID割当はクライアント側設定の影響が大きい。初期割当は便宜とし、ユーザに割当表を提示できるUIを用意。
- ワールド/ローカルの混同防止: VMCはローカルQuat（親から順に適用）で、世界Quatを直送しない。
- basis flipは統一: three.js側（Viewer）と送信側（Rust/Tauri）で二重反転にならないように、責務をRust側に寄せる。
