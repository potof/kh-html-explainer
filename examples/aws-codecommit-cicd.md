# AWS CI/CD構成図

開発アカウントにCodeCommitを1つ置きます。各アカウントのCodePipelineは、対応するブランチを読み取ります。

## CodeCommitと各アカウントのCodePipeline

矢印はソースコードの流れです。実線は同一アカウント内、破線はアカウントをまたぐ取得を示します。

```mermaid
flowchart LR
  accTitle: 1つのCodeCommitから3つのCodePipelineへ
  accDescr: 開発アカウントにCodeCommitと開発用CodePipelineがある。stgブランチはステージング用CodePipeline、mainブランチは本番用CodePipelineが別アカウントから参照する。
  subgraph dev_account["開発アカウント"]
    subgraph repo["CodeCommit リポジトリ"]
      dev_branch["dev"]
      stg_branch["stg"]
      main_branch["main"]
    end
    dev_pipeline@{ icon: "aws:codepipeline", w: 28, h: 28, label: "CodePipeline" }
  end
  subgraph stg_account["ステージングアカウント"]
    stg_pipeline@{ icon: "aws:codepipeline", w: 28, h: 28, label: "CodePipeline" }
  end
  subgraph prod_account["本番アカウント"]
    prod_pipeline@{ icon: "aws:codepipeline", w: 28, h: 28, label: "CodePipeline" }
  end
  dev_branch --> dev_pipeline
  stg_branch -.-> stg_pipeline
  main_branch -.-> prod_pipeline
```

## ブランチとアカウントの対応

| ブランチ | CodeCommitの配置先 | CodePipelineの配置先 |
| --- | --- | --- |
| `dev` | 開発アカウント | 開発アカウント |
| `stg` | 開発アカウント | ステージングアカウント |
| `main` | 開発アカウント | 本番アカウント |

ステージングと本番は、開発アカウント側のIAMロールでソースを取得します。

## 参考リンク

- [AWS re:Post — 別アカウントのCodeCommitをCodePipelineのソースにする](https://repost.aws/knowledge-center/codepipeline-codecommit-repository)
- [AWS CodePipeline — CodeCommitソースアクション](https://docs.aws.amazon.com/codepipeline/latest/userguide/action-reference-CodeCommit.html)
