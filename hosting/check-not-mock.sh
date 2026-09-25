#!/usr/bin/env bash
# 本番に出すビルドがモック表示（EXPO_PUBLIC_MOCK=1）になっていないかを確かめる。なっていれば失敗する。
# Metro のキャッシュにモック表示の設定が残ったまま本番向けにビルドすると、見本のデータの画面を公開してしまうため。
#
# 使い方: ./hosting/check-not-mock.sh <ビルドしたフォルダ>
set -euo pipefail

DIR="${1:?ビルドしたフォルダを指定してください}"
# src/config/env.ts の mock は、ビルド時に真偽値（!0 / !1）へ置き換わる
if grep -rqE 'mock:!0' "$DIR/_expo"; then
  echo "❌ $DIR はモック表示でビルドされています。公開を中止しました（EXPO_PUBLIC_MOCK を外し、--clear でビルドし直してください）" >&2
  exit 1
fi
if ! grep -rqE 'mock:!1' "$DIR/_expo"; then
  echo "❌ $DIR のビルドにモック表示の設定が見つかりません（確認の方法が古くなっている可能性があります）" >&2
  exit 1
fi
echo "✓ モック表示ではありません"
