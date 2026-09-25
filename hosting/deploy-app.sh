#!/usr/bin/env bash
# Web 版アプリをビルドして Firebase Hosting（アプリ用のサイト）に公開する。
# 接続先はルートの .env（EXPO_PUBLIC_*）の値がビルドに埋め込まれる。本番に公開するときは本番向けの .env にしておくこと。
#
# 使い方: ./hosting/deploy-app.sh [プロジェクト ID]
set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT="${1:-$(gcloud config get-value project 2>/dev/null)}"
SITE="${APP_SITE:-${PROJECT}-app}"

if grep -qE '^EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=.+' .env 2>/dev/null; then
  echo ".env が Firebase エミュレータを向いています。本番向けにしてから実行してください" >&2
  exit 1
fi

rm -rf dist
# --clear: ビルドのキャッシュを使わない（直前にモック表示でビルドしていると、その設定が残ることがあるため）
npx expo export --platform web --output-dir dist --clear
./hosting/check-not-mock.sh dist
SITE="$SITE" PUBLIC_DIR="$PWD/dist" SPA=1 ./hosting/deploy.sh "$PROJECT"
