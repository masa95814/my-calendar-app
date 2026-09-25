#!/usr/bin/env bash
# 請求額の予算アラートを Slack に通知する仕組みを作る（何度実行しても同じ状態になるように作ってある）
#
#   Cloud Billing の予算 ──▶ Pub/Sub トピック ──(push, ID トークン付き)──▶ Cloud Run /webhooks/budget ──▶ Slack
#
# 使い方:
#   cd server
#   ./scripts/setup-budget-alert.sh <月の予算（円）>     # 例: ./scripts/setup-budget-alert.sh 500
#
# 前提: Cloud Run にデプロイ済みで、Slack 通知（SLACK_WEBHOOK_URL）が設定済みであること。
# しきい値は 50% / 90% / 100%。請求先アカウントの管理者へのメール通知（既定）もそのまま残る。
set -euo pipefail

cd "$(dirname "$0")/.."

AMOUNT="${1:-}"
if [[ ! "$AMOUNT" =~ ^[0-9]+$ ]]; then
  echo "使い方: $0 <月の予算（円）>" >&2
  exit 1
fi

ENV_FILE=".env"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-my-calendar-app-server}"
PROJECT="$(grep -E '^GOOGLE_CLOUD_PROJECT=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
TOPIC="budget-alerts"
SUBSCRIPTION="budget-alerts-push"
PUSH_SA_NAME="budget-push"
PUSH_SA="${PUSH_SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
BUDGET_NAME="カレンダー連携（${PROJECT}）"

gcloud config set project "$PROJECT" >/dev/null
BILLING_ACCOUNT="$(gcloud billing projects describe "$PROJECT" --format='value(billingAccountName)' | sed 's#billingAccounts/##')"
SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
# アプリが検証する宛先（PUBLIC_BASE_URL + /webhooks/budget）と同じにする
BASE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format=json |
  python3 -c 'import json,sys; env=json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0].get("env",[]); print(next((e.get("value","") for e in env if e["name"]=="PUBLIC_BASE_URL"), ""))')"
BASE_URL="${BASE_URL:-$SERVICE_URL}"
ENDPOINT="${BASE_URL}/webhooks/budget"

echo "▶ 1. API を有効化"
gcloud services enable billingbudgets.googleapis.com pubsub.googleapis.com >/dev/null

echo "▶ 2. push 用のサービスアカウント: $PUSH_SA"
if ! gcloud iam service-accounts describe "$PUSH_SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$PUSH_SA_NAME" --display-name="予算アラートの push" >/dev/null
fi

echo "▶ 3. Pub/Sub トピックと push の購読"
if ! gcloud pubsub topics describe "$TOPIC" >/dev/null 2>&1; then
  gcloud pubsub topics create "$TOPIC" >/dev/null
fi
# 予算の通知を送る Cloud Billing のサービスアカウントに、トピックへの投稿を許可する（gcloud・API で作る場合に必要）
gcloud pubsub topics add-iam-policy-binding "$TOPIC" \
  --member="serviceAccount:billing-budget-alert@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher" >/dev/null
SUB_ARGS=(--push-endpoint="$ENDPOINT" --push-auth-service-account="$PUSH_SA" --push-auth-token-audience="$ENDPOINT")
if gcloud pubsub subscriptions describe "$SUBSCRIPTION" >/dev/null 2>&1; then
  gcloud pubsub subscriptions update "$SUBSCRIPTION" "${SUB_ARGS[@]}" >/dev/null
else
  gcloud pubsub subscriptions create "$SUBSCRIPTION" --topic="$TOPIC" --ack-deadline=30 \
    --message-retention-duration=1d "${SUB_ARGS[@]}" >/dev/null
fi
echo "   $ENDPOINT"

echo "▶ 4. Cloud Run に push のサービスアカウントを設定（ID トークンの検証に使う）"
gcloud run services update "$SERVICE" --region "$REGION" \
  --update-env-vars "BUDGET_PUSH_SA_EMAIL=${PUSH_SA}" --quiet >/dev/null
if ! grep -qE '^BUDGET_PUSH_SA_EMAIL=' "$ENV_FILE"; then
  # deploy.sh でも引き継ぐように .env に書いておく
  printf '\n# 予算アラートを Pub/Sub から push するサービスアカウント（setup-budget-alert.sh が設定）\nBUDGET_PUSH_SA_EMAIL=%s\n' "$PUSH_SA" >>"$ENV_FILE"
fi

echo "▶ 5. 予算（月 ${AMOUNT} 円、50% / 90% / 100%）: 請求先 $BILLING_ACCOUNT"
BUDGET_ARGS=(--display-name="$BUDGET_NAME" --budget-amount="${AMOUNT}JPY"
  --notifications-rule-pubsub-topic="projects/${PROJECT}/topics/${TOPIC}")
EXISTING="$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
  --filter="displayName=\"${BUDGET_NAME}\"" --format='value(name)' | head -1)"
if [[ -n "$EXISTING" ]]; then
  gcloud billing budgets update "$EXISTING" --billing-account="$BILLING_ACCOUNT" \
    "${BUDGET_ARGS[@]}" --clear-threshold-rules \
    --add-threshold-rule=percent=0.5 --add-threshold-rule=percent=0.9 --add-threshold-rule=percent=1.0 >/dev/null
else
  gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" "${BUDGET_ARGS[@]}" \
    --filter-projects="projects/${PROJECT}" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 >/dev/null
fi

echo "✅ 完了。届くかの確認（Slack に 50% の通知が 1 件届く。実際の予算の記録とは別のキーを使う）:"
echo "   gcloud pubsub topics publish $TOPIC --attribute=budgetId=manual-test \\"
echo "     --message='{\"budgetDisplayName\":\"テスト\",\"alertThresholdExceeded\":0.5,\"costAmount\":250,\"budgetAmount\":${AMOUNT},\"currencyCode\":\"JPY\",\"costIntervalStart\":\"$(date -u +%Y-%m)-01T00:00:00Z\"}'"
