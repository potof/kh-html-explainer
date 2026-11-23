# AWS構成図のサンプル集

5つの架空の構成を、1図ずつ掲載しています。用途に合わせて、処理の順序とリソースの配置を描き分けています。

## API連携方式

```sequence
title: ジョブ受付APIの呼び出しと応答
participants: クライアント, @aws:api-gateway HTTP API, @aws:lambda Lambda, @aws:sqs SQS
クライアント -> HTTP API: POST /jobs
HTTP API -> Lambda: 関数を起動
Lambda -> SQS: ジョブを登録
SQS --> Lambda: 登録成功
Lambda --> HTTP API: 202・jobId
HTTP API --> クライアント: 202・jobId
```

API GatewayのHTTP APIで、JWTを検証します。`202 Accepted` を返す条件は、SQSがメッセージの登録を受け付けたことです。後続のワーカーはキューからメッセージを受け取り、ジョブを処理します。

## マルチアカウント構成

```aws
title: AWS Organizationsと監査ログの集約
scope organization org @aws:organizations AWS Organizations
  scope account management 管理アカウント
    node org_admin @aws:cloudtrail CloudTrail | 組織の証跡
  scope ou workloads ワークロード OU
    scope account dev 開発アカウント
      node dev_api API操作（開発）
    scope account prod 本番アカウント
      node prod_api API操作（本番）
  scope ou security セキュリティ OU
    scope account archive ログ保管
      node log_bucket @aws:s3 S3 監査ログ
dev_api -> org_admin 監査イベント
prod_api -> org_admin 監査イベント
org_admin -> log_bucket ログ配信
```

**枠は所属、矢印は監査イベントの配信**を表します。開発と本番の監査ログは、CloudTrailの組織の証跡で収集します。保管先は別アカウントのS3です。

## DevOpsパイプライン

```aws
title: @aws:codepipeline CodePipelineによるコンテナの段階デプロイ
node git Gitリポジトリ
node source ソース取得
node build @aws:codebuild CodeBuild | テスト・ビルド
node ecr @aws:ecr Amazon ECR
node dev @aws:ecs ECS 開発環境
node approve 本番反映を承認
node prod @aws:ecs ECS 本番環境
git -> source push
source -> build ソース
build -> ecr イメージを登録
build -> dev デプロイ定義
dev -> approve デプロイ成功
approve -> prod 承認
```

**本番には開発で検証した同じイメージを使います。** ビルド時にイメージのダイジェストを記録し、開発・本番のデプロイ定義から参照します。

## CloudWatch連携方式

```aws
title: ECSのアプリログから運用通知まで
node ecs @aws:ecs ECS アプリコンテナ
scope service cloudwatch @aws:cloudwatch CloudWatch
  node logs ロググループ
  node filter メトリクスフィルター
  node alarm アラーム
node sns @aws:sns Amazon SNS
node ops 運用担当者
ecs -> logs 標準出力・標準エラー
logs -> filter ERRORを抽出
filter -> alarm エラー件数
alarm -> sns ALARM状態への遷移
sns -> ops メール通知
```

ECSの `awslogs` ドライバーで標準出力・標準エラーを送ります。フィルターは `ERROR` に一致するログを数えます。一定期間の件数がしきい値に達したら通知します。

## ECSコンテナ構成

```aws
title: 2つのAZに配置したECSサービスとタスク
node client 利用者
scope vpc vpc アプリ VPC
  node alb @aws:alb ALB
  scope az az_a AZ A
    scope subnet subnet_a プライベート A
      scope task task_a @aws:fargate タスク A
        node app_a Webコンテナ
        node log_router FireLens | ログルーター
  scope az az_c AZ C
    scope subnet subnet_c プライベート C
      scope task task_c @aws:fargate タスク C
        node app_c Webコンテナ
node log_group @aws:cloudwatch CloudWatch Logs
client -> alb HTTPS
alb -> app_a HTTP
alb -> app_c HTTP
app_a -> log_router アプリログ
log_router -> log_group 転送
```

- **ネットワーク** — ALBは両AZのパブリックサブネットに関連付けます。ECSサービスはタスクのIPをALBのターゲットグループに登録します。図ではパブリックサブネットを省略しています。
- **タスクの中身** — 両AZで同じFargateタスク定義を使います。タスク内のログルーターとログ経路はAZ A側にだけ描いています。
