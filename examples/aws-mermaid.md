# Mermaidで描くAWS構成図

AWSの構成図で、アカウントやAZの境界と、リクエストやログの経路を示すサンプルです。

## マルチアカウント構成

開発・本番の監査イベントを、CloudTrailの組織の証跡で収集します。監査ログはセキュリティOUのログ保管アカウントにあるS3へ配信します。

```mermaid
flowchart TB
  accTitle: CloudTrail監査ログの集約
  subgraph org["AWS Organizations"]
    subgraph workloads["ワークロード OU"]
      subgraph dev["開発アカウント"]
        dev_api["API操作（開発）"]
      end
      subgraph prod["本番アカウント"]
        prod_api["API操作（本番）"]
      end
    end
    subgraph management["管理アカウント"]
      trail@{ icon: "aws:cloudtrail", w: 28, h: 28, label: "CloudTrail 組織の証跡" }
    end
    subgraph security["セキュリティ OU"]
      subgraph archive["ログ保管"]
        log_bucket@{ icon: "aws:s3", w: 28, h: 28, label: "S3 監査ログ" }
      end
    end
  end
  dev_api -->|監査イベント| trail
  prod_api -->|監査イベント| trail
  trail -->|ログ配信| log_bucket
```

## ECSコンテナ構成

ALBは2つのAZにあるECSタスクにリクエストを振り分けます。FireLensはコンテナのログをCloudWatch Logsへ転送します。図ではAZ Aのログ経路を示します。

```mermaid
flowchart TB
  accTitle: ECSへのリクエストとログの経路
  client["利用者"]
  subgraph vpc["アプリ VPC"]
    alb@{ icon: "aws:alb", w: 28, h: 28, label: "ALB" }
    subgraph aza["AZ A"]
      subgraph subnet_a["プライベート A"]
        subgraph task_a["Fargate タスク A"]
          app_a["Webコンテナ"]
          log_router["FireLens ログルーター"]
        end
      end
    end
    subgraph azc["AZ C"]
      subgraph subnet_c["プライベート C"]
        subgraph task_c["Fargate タスク C"]
          app_c["Webコンテナ"]
        end
      end
    end
  end
  log_group@{ icon: "aws:cloudwatch", w: 28, h: 28, label: "CloudWatch Logs" }
  client -->|HTTPS| alb
  alb -->|HTTP| app_a
  alb -->|HTTP| app_c
  app_a -->|アプリログ| log_router
  log_router -->|転送| log_group
```
