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
- [ ] 最小OSCスキーマをドキュメント化（アドレス/型/範囲）
- [ ] Blink/Mouth/Headが設定レートで送出される
- [ ] 無効時は送信停止（ゼロ送出しない）
- [ ] レート変更に追従する

### テスト観点
- リクエスト: 送信ループの開始/停止/レート
- 検証方法: 受信ツールで値更新/停止を確認

(必要なら) 要確認事項:
- cluster仕様の最小必須項目の確定

