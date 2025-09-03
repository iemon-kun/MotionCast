### 背景／目的
上半身骨格の最小セットをOSCに拡張し、cluster互換を意識した送信を行う。
参照: https://docs.cluster.mu/creatorkit/ , https://docs.cluster.mu/script/index.html , Docs/02_アーキテクチャ設計書.md

- 依存： #13, #10
- ラベル：backend

### スコープ / 作業項目
- 追加アドレス/値定義（文書化）
- 送信ループへ上半身姿勢の統合（ON/OFF切替）
- パフォーマンス考慮（送信項目の選択/圧縮）

### ゴール / 完了条件(Acceptance Criteria)
- [ ] 追加アドレス/値の定義がDocsに反映
- [ ] 上半身姿勢が安定して送出される
- [ ] 送信項目のON/OFF切替が可能
- [ ] レート変更/停止に追従する

### テスト観点
- リクエスト: 送信内容の妥当性
- 検証方法: 受信ツールで値更新と選択ON/OFF確認

(必要なら) 要確認事項:
- cluster側で解釈可能な最小/推奨項目

---

## 提案スキーマ: mc-upper（最小＋上半身Quat）

- スキーマ名: `mc-upper`（UIのOSCスキーマで選択）
- 送信レート: UI設定に追従（15/30/60fps）
- 値の平滑化: 顔/頭はEMA、上半身Quatは送信側で未平滑（必要なら将来Slerp平滑を追加）

アドレス定義（mc-upperで送信）
- `/mc/ping` string("ok")
- `/mc/blink` float (0..1)
- `/mc/mouth` float (0..1)
- `/mc/head` float yawDeg, float pitchDeg, float rollDeg
- 上半身（ローカル回転。VRMボーンの親ローカル基準、クォータニオン順序: x y z w）
  - `/mc/ub/chest` float qx, float qy, float qz, float qw
  - `/mc/ub/l_shoulder` qx qy qz qw
  - `/mc/ub/r_shoulder` qx qy qz qw
  - `/mc/ub/l_upper_arm` qx qy qz qw
  - `/mc/ub/r_upper_arm` qx qy qz qw
  - `/mc/ub/l_lower_arm` qx qy qz qw
  - `/mc/ub/r_lower_arm` qx qy qz qw
  - `/mc/ub/l_wrist` qx qy qz qw（任意・未実装時は未送信）
  - `/mc/ub/r_wrist` qx qy qz qw（任意・未実装時は未送信）

備考
- ボーン回転はVRM側でのローカル回転（親ローカル）を使用。Tポーズ時にキャリブレーションされる前提。
- 上半身のON/OFFはスキーマ選択で切替（`minimal`でOFF、`mc-upper`でON）。

