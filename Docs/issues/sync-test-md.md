---
title: Syncテスト: MD→GitHub Issues 同期
labels: [docs, chore]
assignees: [iemon-kun]
---

### 背景／目的
MD→GitHub Issues 同期と「番号の書き戻し」動作を確認するためのテストIssueです。

### 期待する動作
- このMDをpushすると、Actionsが実行され、GitHubにIssueが作成される。
- 作成直後に、このMDのfrontmatterへ `issue: <番号>` が追記され、botがコミットする（[skip md-sync] 付き）。

### 備考
- 同期ワークフロー: .github/workflows/issues-sync-up.yml
- パーサ/同期ロジック: .github/scripts/md-to-issues.mjs
