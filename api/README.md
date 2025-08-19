# Deep Research API (FastAPI Migration)

Azure Functions から Azure Container Apps + FastAPI への移行用バックエンド。

## ローカル起動
```bash
cd api
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

## エンドポイント（現状）
- GET /healthz
- GET /api/ListJobs
- POST /api/StartResearch  body: {"query": "..."}
- GET /api/GetResult/{job_id}
- GET /api/CheckStatus/{job_id}
- DELETE /api/DeleteJob/{job_id}

## 今後の実装タスク
- Cosmos DB への実データ移行 (shared/database backend cosmos 切替)
- Azure AI Foundry / Deep Research 処理（StartResearch の非同期実行部）
- Key Vault / Managed Identity の credential 差し替え
- Bicep: ACR + Container Apps + Role Assignments 追加
- SWA ルーティング更新

## Cosmos DB 利用方法
`DATABASE_PROVIDER=cosmos` を環境変数（または KV シークレット）で指定し、以下をセット:

必須:
- `COSMOS_DB_ACCOUNT_URI` 例: https://xxx-account.documents.azure.com:443/

認証パターン:
1. キーベース: `COSMOS_DB_KEY` を指定
2. Managed Identity (推奨): `COSMOS_DB_KEY` を未設定にし、コンテナアプリの UAMI / System MI に Cosmos DB Data Contributor ロール付与

任意（無ければデフォルト）:
- `COSMOS_DB_DATABASE` (既定: DeepResearch)
- `COSMOS_JOBS_CONTAINER` (既定: research_jobs)
- `COSMOS_STEPS_CONTAINER` (既定: job_steps)

RBAC (MI) 時は最初のデータベース / コンテナ作成権限が必要 (Data Contributor)。

## ヘッダ認証
Azure Static Web Apps の `x-ms-client-principal` をデコードしてユーザー判定。無い場合 anonymous。

## ライセンス
MIT 予定（必要なら変更）
