# kh-html-explainer

技術解説・調査・比較のための個人用 Codex Skill。Markdown から、テーマと図を内包した単一の HTML を生成します。[サンプル原稿「HTTP キャッシュ再検証の設計ガイド」](examples/http-cache-validation.md)では、RFC を根拠に、処理フロー、方針の比較、HTTP の例、導入後の検証を説明しています。

## Mac で生成する

Node.js 22 以上を用意し、このリポジトリを Codex で開きます。下のサンプルにはMermaid図があるため、ChromeまたはChromiumを用意してください。

> $kh-html-explainer キャッシュ更新方式の比較を、日本語のHTML資料にしてください。処理フロー図と比較表を入れてください。

Codex を介さず、同梱の変換器を直接呼び出せます。

```sh
npm ci --ignore-scripts
mkdir -p out
node .agents/skills/kh-html-explainer/dist/render.mjs examples/http-cache-validation.md out/http-cache-validation.html
open out/http-cache-validation.html
```

出力先の親ディレクトリを先に作ってください。既存ファイルへの上書きはエラーになります。別のリポジトリでも使う場合は `.agents/skills/kh-html-explainer` 一式を `~/.agents/skills/` に配置できます。[Codex の Skill 検出ルール](https://learn.chatgpt.com/docs/build-skills)

## Codex Cloud と iPhone で使う

1. このリポジトリを Codex Cloud の環境に接続します。Node.js 22 以上を選びます。同梱の変換器を使います。Mermaid図が含まれる場合は、下記の描画環境も用意します。AWS公式アイコンの初回取得が必要な場合は、下記のAWS構成図の手順を使います。
2. iPhone の ChatGPT アプリの Codex で、その環境から生成できる場合はタスクを開始します。Skill が選択肢に出なければ「`.agents/skills/kh-html-explainer/SKILL.md` を使ってHTMLを生成して」と指定します。使える Cloud 環境や起動方法はアカウントに表示される機能に従ってください。[Codex Cloud の環境設定](https://learn.chatgpt.com/docs/environments/cloud-environment)
3. タスクで HTML の添付を依頼し、添付を開くか「ファイル」に保存してプレビューします。使っているクライアントが HTML を添付できない場合は、生成した資料は別の非公開リポジトリで共有するか、Mac に保存した HTML を AirDrop で iPhone に渡します。Cloud の作業ディレクトリへのリンクは、iPhone からのダウンロード URL としては使えません。
4. iPhone から Mac 上の Codex を使う場合は、ChatGPT のリモート接続を設定して Mac のワークスペースで同じ Skill を起動できます。[リモート接続の設定](https://learn.chatgpt.com/docs/remote-connections)

オフライン閲覧は保存済みの HTML が対象です。初期表示はライトで、ページ上部の「ライト / ダーク」で切り替えます。「A− / A＋」では文字と図の表示サイズを90〜130%に調整できます。広い画面では表の列数、図の幅、コードの行幅に応じてカードの幅を配分します。狭い画面では縦一列になり、収まらない表・図・コードは枠内で横にスクロールできます。

## 確認事項と AI Agent へのコメント

確認事項は、対応する段落・表・図の直後に `> **確認事項**` で始まる引用を書きます。単一選択・複数選択・自由記述を使えます。参考リンクは末尾の `## 参考リンク` にまとめ、本文から `#references` で参照できます。

確認事項に回答するか、各カード見出しの吹き出しアイコンを押して指示を書きます。上部の「指示文を生成」を押すと、回答、コメント、段落への注記をカードID・見出し付きでまとめられます。同じボタンをもう一度押すと指示文を閉じます。カードIDは本文の `##` 見出し順に A〜Z、その後は P27 から割り当てます。「指示文をコピー」で Codex などに貼り付けられます。クリップボードを使えないプレビューでは表示された指示文を手動でコピーしてください。回答、コメント、注記は閲覧中の入力欄にあり、元の HTML ファイルへの保存や外部送信は行いません。

文章の一箇所に修正を頼むときは、上部の「段落に注記」を押して対象の段落を選びます。指示文には段落の引用と原稿の開始行が含まれます。

## AWS構成図

[Mermaidのサンプル原稿](examples/aws-mermaid.md)には、マルチアカウントとECSの構成例があります。シンプルなAWS構成図では、サービス名とアイコンを白い枠に収め、外枠と入れ子を薄いグレーの濃淡で区別します。[環境別CodePipelineの例](examples/aws-codecommit-cicd.md)は、ブランチと対応するパイプラインを同じ高さに表示します。[従来の原稿サンプル](examples/aws-architecture-samples.md)にある `aws` や `sequence` も引き続き使えます。

ガント以外のMermaid図を生成するには、リポジトリで初回に `npm ci --ignore-scripts` を実行し、ChromeまたはChromiumを用意します。macOSではネットワーク遮断にOS標準の `sandbox-exec` を使います。Linux（x64/arm64）ではPython 3と `libseccomp.so.2` が必要です。Chromeの実行ファイルを指定する場合は `KH_HTML_EXPLAINER_CHROMIUM` を、Skillをホームにコピーした場合は `KH_HTML_EXPLAINER_MERMAID_DIR` にリポジトリの `node_modules/mermaid` の絶対パスを設定できます。

Chromiumのサンドボックスを起動できない隔離済みのCloud環境では、`KH_HTML_EXPLAINER_CHROMIUM_NO_SANDBOX=1` を指定できます。OSのネットワーク遮断はこの設定でも有効です。

```sh
npm ci --ignore-scripts
mkdir -p out
node .agents/skills/kh-html-explainer/dist/render.mjs examples/aws-mermaid.md out/aws-mermaid.html
```

原稿に `icon: "aws:ecs"` などのアイコンIDを書くと、対応するAWS公式アイコンを使います。シンプルなAWS構成図では、ノードの対応サービス名からもアイコンを補います。アイコンが必要でキャッシュが空なら、`--offline` を付けずに変換すると `curl` が固定版の公式ZIP全体を取得します。SHA-256で検証したZIPをキャッシュし、次回以降はそのZIPを再利用します。出力HTMLに埋め込むのは使用したアイコンだけです。[AWS公式アイコン](https://aws.amazon.com/architecture/icons/)

キャッシュ先はMacでは `~/Library/Caches/html-explainer`、Linuxでは `${XDG_CACHE_HOME:-~/.cache}/html-explainer` です。別の端末やCodex Cloudで通信を禁止する場合は、検証済みの `aws-architecture-icons-2026-07-31.zip` をその環境のキャッシュ先に置くか、保存先を `HTML_EXPLAINER_CACHE_DIR` で指定して `--offline` を付けます。必要なZIPがキャッシュにないときはエラーを表示します。完成HTMLには静的SVGが入り、ZIPのない環境でもオフラインで閲覧できます。

## 原稿とセキュリティ

- フロー図・シーケンス図・状態遷移図・ER図・棒／折れ線グラフは標準のMermaidで書きます。ガントも日付、工程、依存関係、進捗をMermaidで書けます。[ガントのサンプル原稿](examples/release-schedule.md)
- タイムラインにはMarkdownの表、ディレクトリツリーには入れ子のリストを使います。専用の見出しを添えた箇所だけをHTMLで装飾します。警告は引用、変更はunified diffで書きます。[各書式のサンプル原稿](examples/portable-components.md)
- Markdown の生 HTML、外部画像、外部 CSS、外部フォント、入力由来の JavaScript の実行を防ぎます。外部 URL はテキストとして保持します。 `#top`／`#section-1` 形式のリンクは文書内で動作します。
- 変換時に CSS と SVG をインライン化し、CSP は固定の CSS と操作用スクリプトのハッシュだけを許可します。閲覧とキャッシュ済みの変換はローカルで完結します。
- UTF-8 と入力サイズ、図の構造と参照を検証します。HTML は変換成功後に書き出し、既存の出力先は保護します。
- 同じ原稿・同じ変換器・同じ Node/ICU 環境で、同じ内容の HTML が得られます。ガント以外のMermaid図は、生成時のChromiumのバージョンとシステムフォントも揃えてください。ファイル名、時刻、乱数は HTML に含めません。

## 原稿の警告

変換時に本文の長い文・段落をチェックし、段落または手順の開始行を標準エラーに出します。日本語の目安は説明45文字、番号付き手順35文字、段落6文です。英語などの語数で数える文章は、説明25語、番号付き手順20語が目安です。見出し、表、コード、図と確認欄の入力、URL、参考リンクの一覧は長さの対象から外します。

長さの指摘は警告です。文面を変えずにHTMLを生成し、標準出力には出力先のパスを表示します。1回の変換では最初の20件と残りの件数を表示します。

## 保守

```sh
npm ci --ignore-scripts
npm run build
npm test
```

`scripts/` の読みやすいソースを編集し、`dist/` の変換器とライセンス表記を再生成して Git に含めます。npm への接続は依存を取得するときにだけ必要です。変換器は markdown-it と Dagre をバンドルしています。

Mermaidは `package-lock.json` で固定し、ガント以外のMermaid図の変換時にだけ読み込みます。バージョンを更新する場合は、`mermaid.mjs` のELKの間隔調整とサンプルの表示を確認します。Chromiumを用意した環境では `KH_HTML_EXPLAINER_TEST_MERMAID=1 npm test` でMermaid図の変換もテストします。

Markdown に執筆を集中させる方針は [answer-me-with-html v0.6.2](https://github.com/QingYunA/answer-me-with-html/tree/v0.6.2) を参考にしました。変換処理、テーマ、図の入力形式はこのリポジトリで保守します。
