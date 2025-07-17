@echo off
REM venv作成＆有効化＆pip install自動化バッチ（Windows用）

REM Python 3.11推奨
python --version

REM venv作成
python -m venv .venv

REM venv有効化
call .venv\Scripts\activate.bat

REM pipアップグレード＆依存インストール
python -m pip install --upgrade pip
pip install -r requirements.txt

echo =============================
echo venv作成＆パッケージインストール完了！
echo venv有効化中はプロンプトの先頭に(.venv)が付くよ！
echo =============================
pause
