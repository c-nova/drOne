
# ✨ Deep Research Chat UI ✨

---

## 🚀 概要

AIリサーチをもっと楽しく、もっとスマートに！
このプロジェクトは Azure Static Web Apps × Lit × Vite で作った、超イケてるチャット型リサーチUIだよ💜

- **履歴サイドバー**で過去のジョブを一発確認！
- **リアルタイム進捗**でAIの思考を実況中継！
- **Foundry API連携**で本格的なAIリサーチ体験！
- **PDF/Markdown/Copy**ボタンで結果を即シェア！



---

## 🌈 主な機能

| 機能                | 説明                                                                 |
|---------------------|----------------------------------------------------------------------|
| 履歴サイドバー      | 過去ジョブ（completed/failed）を一覧表示。Job ID・Thread ID・タイトル・ステータス・日時もバッチリ！ |
| 履歴クリック        | 履歴ジョブをクリックすると、そのThreadの全メッセージ（中間・最終含む）をチャットウィンドウに表示！ |
| 進行中ジョブ実況    | ジョブ実行中は進捗・中間メッセージをリアルタイムでチャットウィンドウに表示！                        |
| ブランク表示        | 進行中ジョブがない時はチャットウィンドウを完全ブランクに！履歴だけでスッキリ！                    |
| Foundry API連携     | 履歴も進行中もFoundry APIのThread/Message構造に合わせてメッセージ取得＆表示！                    |
| メッセージ抽出強化  | contentがstring/parts/array/objなど多様な形式に対応！                                                  |
| UI/UX改善           | チャットウィンドウ幅拡大（max-width:1200px）、履歴タイトル折り返し、PDF/MD/Copyボタン追加！         |
| エラー表示           | APIエラーやThread ID未取得時は分かりやすくエラーメッセージを表示！                                   |
| コード整理           | LitElementのプロパティ管理・レンダリング最適化・不要な履歴機能の削除！                             |

---


## 🛠️ セットアップ＆起動方法

### フロントエンド（Vite）

```zsh
cd swa-chat-ui
npm install
npm run dev
```
ブラウザで http://localhost:3000 にアクセス！

### バックエンド（Azure Functions API）

```zsh
cd DeepResearchFunctionApp
# Python仮想環境のセットアップ（必要なら）
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Azure Functionsのローカル起動
func start
```
APIは http://localhost:7071 で動くよ！

#### 必要な環境変数 (local.settings.json / Azure Configuration)

| 変数 | 役割 | 例 / 備考 |
|------|------|-----------|
| `PROJECT_ENDPOINT` | Azure AI Foundry プロジェクトエンドポイント | `https://<your-project>.regions.azureai.azure.com` |
| `MODEL_DEPLOYMENT_NAME` | エージェント基盤モデルのデプロイ名 | `gpt-4o` など |
| `DEEP_RESEARCH_MODEL_DEPLOYMENT_NAME` | Deep Research 用モデル名 (未指定で `latest`) | `gpt-4o` / `latest` |
| `BING_RESOURCE_NAME` | Bing 検索コネクションのリソース名 | connections から取得 |
| `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` | (必要なら) サービスプリンシパル認証 | 開発端末で `az login` するなら不要 |

`local.settings.json` のサンプル:

```json
{
	"IsEncrypted": false,
	"Values": {
		"AzureWebJobsStorage": "UseDevelopmentStorage=true",
		"FUNCTIONS_WORKER_RUNTIME": "python",
		"PROJECT_ENDPOINT": "https://<project>.eastus2.azureai.azure.com",
		"MODEL_DEPLOYMENT_NAME": "gpt-4o",
		"DEEP_RESEARCH_MODEL_DEPLOYMENT_NAME": "latest",
		"BING_RESOURCE_NAME": "my-bing-conn"
	}
}
```

### API エンドポイント一覧 (ローカル)

| メソッド | Path | 用途 | 備考 |
|----------|------|------|------|
| POST | `/api/research/start` | リサーチ開始 | body: `{ query: string }` |
| GET | `/api/research/status/{job_id}` | 進捗 / 中間メッセージ取得 | annotations 保存対応 |
| GET | `/api/research/result/{job_id}` | 完了結果 + citations | `citations[]` 追加済 |
| DELETE | `/api/research/job/{job_id}` | (実装されていれば) ジョブ削除 | UI テストページから利用 |

### ありがちなトラブル

| 症状 | 対処 |
|------|------|
| `PROJECT_ENDPOINT environment variable is not set` | local.settings.json に追記 / Azure でアプリ設定反映 |
| Bing connection エラー | `BING_RESOURCE_NAME` が connections 名と一致するか確認 |
| 認証エラー (DefaultAzureCredential) | `az login` するか、サービスプリンシパルの 3 変数を設定 |
| citations が 0 のまま | Run 完了前に status を見ている可能性。数秒待って再取得 |

---

---

## 🗂️ ディレクトリ構成

```
/Volumes/2TBSSD/repos/drOne/swa-chat-ui/
├── src/
│   ├── main.js
│   └── chat-app.js
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

---

## 💡 こだわりポイント

- **洗練されたUI**：見た目も使い勝手も抜群！
- **現場目線の設計**：履歴・進捗・エラー全部見やすく、操作も直感的！
- **拡張性抜群**：添削機能やAIプロンプト強化もすぐ追加できる設計！
- **Azure Foundry完全対応**：API仕様変更にも柔軟に追従！
 - **印刷 / PDF 専用ビュー**：`print.html` で Final Report / 全履歴 切替 & A4最適化。

---

## 📝 今回のソリューション詳細（2025/07/17）

- 履歴サイドバーで過去ジョブを一発確認！
- 履歴クリックでThreadの全メッセージを表示！
- 進行中ジョブはリアルタイムで進捗・中間メッセージを表示！
- 進行中ジョブがなければチャットウィンドウは完全ブランク！
- Foundry APIのThread/Message構造に合わせてメッセージ取得・表示！
- content抽出ロジック強化でどんな形式でもOK！
- UI/UX大幅改善！チャット幅拡大・履歴タイトル折り返し・PDF/MD/Copyボタン追加！
- エラー時は分かりやすく表示！
- コード整理＆最適化！

---

## 💬 使い方・Tips

- 履歴サイドバーから過去ジョブをクリックすると、詳細がすぐ見れる！
- 新しい質問を入力して送信すると、AIがリアルタイムで進捗を返してくれる！
- 結果はPDFやMarkdownでダウンロード、コピーもワンクリック！
- 「🖨️ PDF用表示」から印刷プレビューを開いて、Final Reportだけ/全やり取りを選んでPDF保存できる！
- 進行中ジョブがなければチャットウィンドウはスッキリ空っぽ！
 - Word 形式もボタン一発で生成（docx ライブラリ利用）。
 - citations リンクが欠落している時は fallback で検索リンクに変換（job コンテキスト推測）。

### 印刷ビュー (print.html) の挙動概要

1. チャット側でAIメッセージ配列を `localStorage.printMessages` に格納
2. 新タブで `/print.html` を開く
3. ロード時に messages を読み取り → Final / All モードでフィルタ
4. 独自 Markdown → HTML 変換 (`processMarkdown` / table 展開 / citation 装飾)
5. ブラウザ印刷 (`window.print()`) を実行して PDF 保存

---
## 🧪 Devtools / Sandbox について

`devtools/` と `sandbox/` は開発者向け補助:

| ディレクトリ | 用途 |
|--------------|------|
| `devtools/` | citation 抽出や Markdown フォーマット検証用の単発スクリプト/HTML |
| `sandbox/` | API 手動テスト用 UI (`test_api.html`) |

本番デプロイ対象じゃないので動かなくてもCI失敗にしない設計。必要なら docs へ昇格。

---
## 🔒 セキュリティ簡易メモ

- Function 認証 `authLevel:function` なので本番は Function Key / APIM / Front Door 等で保護推奨
- 検索系 tool で外部アクセスするため egress ポリシー要件があれば NSG/Firewall で制御
- ログに annotation URL / quote を出し過ぎると機密漏洩の恐れ → 運用移行時は log level 調整

---
## 🧭 これからの改善ロードマップ (例)

- citation 抽出を非同期キュー化 (Run 完了イベント or タイムアウト) でUI応答速度改善
- MarkdownRenderer の単体テスト追加（正規表現回 regres 防止）
- ソース inline コメント英語化 & dx向上
- フロントの巨大バンドル分割 (dynamic import) で初期ロード軽量化

---
## 📄 ライセンス

（必要ならここに License 表記を追加）

---

## 🦄 Special Thanks

- Azure Foundry
- Lit & Vite


---

## 🏄‍♀️ もっと進化させたい？

添削機能やAIプロンプト強化、UIカスタムなど、要望あればどんどん言ってね！
Pull Request・Issueも大歓迎！

---

> 2025/07/17時点の最新ソリューション内容です。全力でアップデート中！
