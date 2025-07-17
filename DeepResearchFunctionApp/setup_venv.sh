#!/bin/bash
# venv作成＆有効化＆pip install自動化スクリプト（macOS/Linux用）

# Python 3.11推奨
python3 --version

# venv作成
python3 -m venv .venv

# venv有効化
source .venv/bin/activate

# pipアップグレード＆依存インストール
python3 -m pip install --upgrade pip
pip install -r requirements.txt

echo "============================="
echo "venv作成＆パッケージインストール完了！"
echo "venv有効化中はプロンプトの先頭に(.venv)が付くよ！"
echo "============================="
