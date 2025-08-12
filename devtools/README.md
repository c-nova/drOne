# Devtools

開発/検証用の補助スクリプトとデバッグHTML置き場。

- `check_citations.py`: Azure AI Foundry の run / messages から annotations を直接確認するワンショットスクリプト。
- `debug_bold_fix.html`: Markdown太字レンダリング調整テスト。
- `debug_comma_list.html`: カンマ始まり行のリスト化ロジック検証。
- `test_bold.html`: 太字エッジケース検証簡易ページ。

本番ビルドやデプロイ対象ではないので、変更は原則個別コミットか squash 推奨。必要になったら docs へ昇格させる。
