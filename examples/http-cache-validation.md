# HTTP キャッシュ再検証の設計ガイド

更新される公開 API で転送量を減らすには、**古い応答を許容する時間**を `Cache-Control` で決め、再検証が必要になったら **`ETag` で本文の再送を省く**設計にします。

対象はチーム一覧を返す架空の API `GET /v1/teams` です。URL、タグ、60秒は設計例です。

## 保存したレスポンスはいつ再利用できるか

**新鮮な応答はそのまま使い、再検証が必要なら保存済みのタグを送ります。**

```diagram
{
  "title": "保存済みレスポンスを再利用する流れ",
  "nodes": [
    {"id": "lookup", "label": "保存済みレスポンス"},
    {"id": "validate", "label": "タグを送って再検証"},
    {"id": "reuse", "label": "保存済み本文を使う"},
    {"id": "replace", "label": "新しい本文に更新"}
  ],
  "edges": [
    ["lookup", "reuse", "新鮮で再利用可能"],
    ["lookup", "validate", "再検証が必要"],
    ["validate", "reuse", "304"],
    ["validate", "replace", "200"]
  ]
}
```

- **`304` で受け取るもの** — 本文は空。応答ヘッダーでキャッシュのメタデータを更新します。
- **`200` で更新するもの** — 新しい応答を保存できる場合は、本文とタグを更新します。

[再検証と 304（参考1–2）](#references)

## キャッシュ方針はどう選ぶか

**保存を許す相手**と**再検証の頻度**を、`Cache-Control` で指定します。

| 要件 | `Cache-Control` の例 | 再利用の条件 |
| --- | --- | --- |
| 公開データ。短時間の古さを許容 | `public, max-age=60` | 新鮮な間は CDN などでも再利用 |
| 公開データ。再利用前に毎回確認 | `public, no-cache` | 共有キャッシュに保存可。再利用前に再検証 |
| ユーザー別。端末での保存は可 | `private, no-cache` | 共有キャッシュに保存不可。端末でも再利用前に再検証 |
| 保存を禁止 | `no-store` | 保存不可 |

```confirm
{
  "type": "single",
  "question": "チーム名が更新前の表示のままでもよい時間はどれくらいですか？",
  "hint": "選んだ要件に合わせて、キャッシュの鮮度期間を決めます。",
  "options": ["最大60秒（max-age=60）", "再利用するたびに確認（no-cache）", "更新の許容時間は未決定"]
}
```

- **往復と転送量の違い** — `no-cache` は変更がないときの本文転送を減らせます。オリジンへの往復も減らすには、再検証なしで使える鮮度期間が必要です。

[レスポンスのディレクティブ（参考3）](#references)

## ETag は何に対して発行するか

`ETag` は URL ではなく **選択された表現**に対応します。同じ URL の日本語版と英語版は別の表現です。

```diagram
{
  "title": "オリジンが条件付き GET を処理する順序",
  "direction": "LR",
  "nodes": [
    {"id": "select", "label": "表現を選ぶ"},
    {"id": "match", "label": "タグを照合"},
    {"id": "same", "label": "304 で応答"},
    {"id": "changed", "label": "200 で本文を返す"}
  ],
  "edges": [
    ["select", "match"],
    ["match", "same", "一致"],
    ["match", "changed", "不一致"]
  ]
}
```

- **タグの発行** — 強いタグには、表現データが変わると値も変わるハッシュやバージョン ID を使います。
- **キャッシュの出し分け** — `Accept-Language` で表現を選ぶ場合は、`Vary: Accept-Language` を返します。
- **条件の照合** — `If-None-Match` は弱い比較を使います。引用符、タグの一覧、`W/` の扱いはフレームワークの条件判定に任せます。

```confirm
{
  "type": "multiple",
  "question": "本番経路で、どの表現の違いを検証対象にしますか？",
  "hint": "当てはまる項目を選び、クライアントから見える ETag と Vary を確認します。",
  "options": ["圧縮形式の切り替え", "言語の切り替え", "オリジンと CDN 経由の比較"]
}
```

[タグの照合とキャッシュキー（参考4–6）](#references)

## 実際の HTTP のやり取りはどう見えるか

### 初回取得で本文とタグを受け取る

以下の応答例では、確認に必要なヘッダーを抜粋しています。

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=60
ETag: "teams-v17"

[{"id":"platform","name":"Platform"}]
```

### 再検証で受け取ったタグを送る

検証環境の URL と、初回取得で受け取ったタグを指定します。

```sh
curl -i -H 'If-None-Match: "teams-v17"' https://api.example/v1/teams
```

**変更なしの場合**は、ヘッダーだけの `304` が返ります。

```http
HTTP/1.1 304 Not Modified
Cache-Control: public, max-age=60
ETag: "teams-v17"
```

- **変更後** — 古いタグを送ると、新しいタグと本文を持つ `200` が返ります。
- **ブラウザでの確認** — 画面には保存済み本文が表示されるため、通信上のステータスは開発者ツールのネットワーク欄で確認します。

## 導入後に何を確かめるか

**先にオリジン直結で条件判定を検証し、その後に CDN 経由で再利用を確認します。** データを更新できる検証環境を使います。

| 検証ケース | 実行内容 | 期待結果 |
| --- | --- | --- |
| 初回取得 | 条件なしで `GET` する | `200` と本文、現在の `ETag` を受け取る |
| 変更なし | 取得したタグを付けて同じ表現を取得する | `304` を受け取る。本文は空で、該当する `ETag` やキャッシュ用ヘッダーが返る |
| データ更新後 | 公開されるチーム名を変更して、古いタグを付けて取得する | オリジンで `200` になり、新しいタグと更新後の本文を受け取る |
| 表現の切り替え | 言語など、表現を選ぶヘッダーを変える | 対象の表現に応じた本文とタグが返り、`Vary` が選択に使ったヘッダーを示す |

### CDN 経由で見るポイント

- **鮮度期間の内外** — 保存済み応答が新鮮なら、データ更新直後でもオリジンに届かない場合があります。
- **導入効果** — 同じ期間で本文の転送量、オリジンへのリクエスト数、遅延を比較します。キャッシュだけで答えた分は `304` の件数に現れません。

```confirm
{
  "type": "text",
  "question": "どの環境と経路で検証しますか？",
  "hint": "環境名と、オリジン直結か CDN 経由かを書いてください。"
}
```

## 参考リンク

1. [RFC 9111 §4.3 — Validation](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.3) — 保存済みレスポンスの再検証
2. [RFC 9110 §15.4.5 — 304 Not Modified](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.4.5) — 304 の意味とヘッダー
3. [RFC 9111 §5.2.2 — Response Directives](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2) — キャッシュ方針のディレクティブ
4. [RFC 9110 §8.8.3 — ETag](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3) — 表現に対するタグの定義
5. [RFC 9110 §13.1.2 — If-None-Match](https://www.rfc-editor.org/rfc/rfc9110.html#section-13.1.2) — 条件付きリクエストの判定
6. [RFC 9111 §4.1 — Calculating Cache Keys with Vary](https://www.rfc-editor.org/rfc/rfc9111.html#section-4.1) — Vary による表現の区別
