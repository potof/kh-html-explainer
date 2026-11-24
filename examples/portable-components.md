# MermaidとMarkdownで書く技術資料

## フロー図

```mermaid
flowchart TB
  accTitle: リクエストの経路
  client["利用者"] -->|リクエスト| api["API"]
  api -->|データ取得| store["ストア"]
```

## シーケンス図

```mermaid
sequenceDiagram
    accTitle: リクエストと応答
    autonumber
    participant C as 利用者
    participant A as API
    participant D as ストア
    C->>A: 一覧を要求
    A->>D: 一覧を照会
    D-->>A: 一覧を返す
    A-->>C: 結果を返す
```

## 状態遷移図

```mermaid
stateDiagram-v2
  accTitle: 公開申請
  state "下書き" as draft
  state "公開済み" as published
  [*] --> draft
  draft --> published: 承認
  published --> [*]
```

## ER図

```mermaid
erDiagram
  accTitle: チームとメンバー
  direction LR
  TEAM ||..o{ MEMBER : 所属
  TEAM["チーム"] {
    uuid id PK
  }
  MEMBER["メンバー"] {
    uuid id PK
    uuid team_id FK
  }
```

## 数値グラフ

```mermaid
xychart horizontal
  title "方式ごとの処理時間（例示）"
  x-axis ["方式A", "方式B"]
  y-axis "処理時間 (ms)" 0 --> 24
  bar [20, 12]
```

## タイムライン

**タイムライン**

| 日付 | 出来事 | 補足 |
| --- | --- | --- |
| 1日目 | 検証環境で試す | |
| 2日目 | 段階的に切り替える | 旧構成へ戻せる状態を保つ |

## ファイル構成

**ディレクトリツリー**

- `kh-html-explainer/`
  - `SKILL.md` — Codexが読む指示
  - `scripts/`
    - `render.mjs` — 原稿をHTMLに変換
  - `dist/`
    - `render.mjs` — 同梱の実行ファイル

## 警告の囲み

> **警告 — 切り替えを中断する条件**
>
> エラー率が基準を超えたら、切り替えを止めて元の設定に戻す。

## 変更の表示

```diff
--- a/retry.conf
+++ b/retry.conf
@@ -1 +1 @@
-retry_count = 1
+retry_count = 3
```

## 確認事項

> **確認事項**
>
> どの構成で進めますか？
>
> 影響範囲を確認してから1つ選んでください。
>
> 1. 既存環境で検証する
> 2. 検証環境を追加する

## ガントの遅延表示

```mermaid
gantt
  dateFormat YYYY-MM-DD
  axisFormat %m/%d
  設計レビュー :done, review, 2026-11-26, 1d
  切り戻し手順（遅延） :active, backout, after review, 2d
  リリース判定 :milestone, gate, after backout, 0d
```
