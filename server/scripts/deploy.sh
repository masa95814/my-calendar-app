#!/usr/bin/env bash
# Cloud Run へのデプロイ（何度実行しても同じ状態になるように作ってある）
#
# 使い方:
#   cd server
#   gcloud auth login                       # 初回のみ
#   ./scripts/deploy.sh                     # server/.env の値を使ってデプロイ
#
# やること:
#   1. 必要な API を有効化
#   2. シークレット（OAuth クライアントシークレット、トークン暗号鍵、タスク用シークレット）を Secret Manager に登録
#   3. Cloud Run の実行サービスアカウントに権限を付与
#   4. Cloud Run にデプロイ（初回は URL 確定後に、その URL で環境変数を設定して再デプロイ）
#   5. Firebase の初期設定（Firebase の追加、Firestore 作成、Authentication 有効化、ルール適用、ウェブアプリ登録）
#   6. Cloud Scheduler のジョブ（差分同期 10 分ごと、全件同期と watch 更新は毎日）を作成・更新
#
# シークレットの値は画面に表示しない。
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-my-calendar-app-server}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "server/.env が見つかりません" >&2
  exit 1
fi

# .env から値を読む（シェルに展開せず、そのまま取り出す）
env_value() {
  grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-
}

PROJECT="$(env_value GOOGLE_CLOUD_PROJECT)"
OWNER_EMAILS="$(env_value OWNER_EMAILS)"
CLIENT_ID="$(env_value GOOGLE_OAUTH_CLIENT_ID)"
CLIENT_SECRET="$(env_value GOOGLE_OAUTH_CLIENT_SECRET)"
TOKEN_KEY="$(env_value TOKEN_ENCRYPTION_KEY)"
TASKS_SECRET="$(env_value TASKS_SECRET || true)"
RETURN_PREFIXES="$(env_value APP_RETURN_URL_PREFIXES || true)"
RETURN_PREFIXES="${RETURN_PREFIXES:-mycalendarapp://,exp://}"
# Web 版アプリを公開している URL（例: https://<サイト>.web.app）。CORS とログイン後の戻り先に許可する
WEB_APP_URL="$(env_value WEB_APP_URL || true)"
# 同期エラーなどを通知する Slack の Incoming Webhook の URL（任意）
SLACK_WEBHOOK_URL="$(env_value SLACK_WEBHOOK_URL || true)"
# 同期エラーと連携切れの通知でメンションする Slack のメンバー ID（任意）
SLACK_MENTION_USER_ID="$(env_value SLACK_MENTION_USER_ID || true)"
# 予算アラートを Pub/Sub から push するサービスアカウント（setup-budget-alert.sh が .env に書く。任意）
BUDGET_PUSH_SA_EMAIL="$(env_value BUDGET_PUSH_SA_EMAIL || true)"
if [[ -n "$WEB_APP_URL" && ",${RETURN_PREFIXES}," != *",${WEB_APP_URL},"* ]]; then
  RETURN_PREFIXES="${RETURN_PREFIXES},${WEB_APP_URL}"
fi

for name in PROJECT OWNER_EMAILS CLIENT_ID CLIENT_SECRET TOKEN_KEY; do
  if [[ -z "${!name}" ]]; then
    echo "server/.env に値がありません: $name" >&2
    exit 1
  fi
done

command -v gcloud >/dev/null || {
  echo "gcloud が見つかりません。brew install --cask gcloud-cli でインストールしてください" >&2
  exit 1
}

gcloud config set project "$PROJECT" >/dev/null
echo "▶ プロジェクト: $PROJECT / リージョン: $REGION / サービス: $SERVICE"

echo "▶ 1. API を有効化"
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudscheduler.googleapis.com \
  calendar-json.googleapis.com firestore.googleapis.com \
  iamcredentials.googleapis.com identitytoolkit.googleapis.com \
  firebase.googleapis.com firebaserules.googleapis.com

echo "▶ 2. シークレットを登録"
# 値が変わったときだけ新しいバージョンを追加する
put_secret() {
  local name="$1" value="$2"
  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then
    gcloud secrets create "$name" --replication-policy=automatic >/dev/null
  fi
  local current
  current="$(gcloud secrets versions access latest --secret="$name" 2>/dev/null || true)"
  if [[ "$current" != "$value" ]]; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
    echo "   $name: 更新しました"
  else
    echo "   $name: 変更なし"
  fi
}

if [[ -z "$TASKS_SECRET" ]]; then
  # 未設定なら既存のものを使い、無ければ生成する
  TASKS_SECRET="$(gcloud secrets versions access latest --secret=tasks-secret 2>/dev/null || openssl rand -hex 24)"
fi
put_secret google-oauth-client-secret "$CLIENT_SECRET"
put_secret token-encryption-key "$TOKEN_KEY"
put_secret tasks-secret "$TASKS_SECRET"
if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
  put_secret slack-webhook-url "$SLACK_WEBHOOK_URL"
fi
# Slack の URL は .env に無くても、シークレットが作られていれば使う（gcloud で直接作った場合）
SECRETS="GOOGLE_OAUTH_CLIENT_SECRET=google-oauth-client-secret:latest,TOKEN_ENCRYPTION_KEY=token-encryption-key:latest,TASKS_SECRET=tasks-secret:latest"
if gcloud secrets describe slack-webhook-url >/dev/null 2>&1; then
  SECRETS="${SECRETS},SLACK_WEBHOOK_URL=slack-webhook-url:latest"
fi

echo "▶ 3. 実行サービスアカウントに権限を付与"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
# roles/cloudbuild.builds.builder: 新しいプロジェクトでは --source のビルドもこのアカウントで行われるため必要
for role in roles/secretmanager.secretAccessor roles/datastore.user roles/firebaseauth.admin roles/cloudbuild.builds.builder; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$RUN_SA" --role="$role" --condition=None >/dev/null
done
# Firebase のカスタムトークンに署名するため、自分自身のトークン作成権限が必要
gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" \
  --member="serviceAccount:$RUN_SA" --role=roles/iam.serviceAccountTokenCreator >/dev/null
echo "   $RUN_SA"

deploy() {
  local base_url="$1"
  # OWNER_EMAILS と APP_RETURN_URL_PREFIXES はカンマを含むので、区切り文字を | にして渡す（^|^ 記法）
  local env_vars="NODE_ENV=production|OWNER_EMAILS=${OWNER_EMAILS}|GOOGLE_OAUTH_CLIENT_ID=${CLIENT_ID}|APP_RETURN_URL_PREFIXES=${RETURN_PREFIXES}|WEB_ALLOWED_ORIGINS=${WEB_APP_URL}"
  if [[ -n "$SLACK_MENTION_USER_ID" ]]; then
    env_vars="${env_vars}|SLACK_MENTION_USER_ID=${SLACK_MENTION_USER_ID}"
  fi
  if [[ -n "$BUDGET_PUSH_SA_EMAIL" ]]; then
    env_vars="${env_vars}|BUDGET_PUSH_SA_EMAIL=${BUDGET_PUSH_SA_EMAIL}"
  fi
  if [[ -n "$base_url" ]]; then
    env_vars="${env_vars}|PUBLIC_BASE_URL=${base_url}|OAUTH_REDIRECT_URI=${base_url}/auth/google/callback"
  else
    # URL が決まる前の初回だけ仮の値で起動する
    env_vars="${env_vars}|OAUTH_REDIRECT_URI=http://localhost:8080/auth/google/callback"
  fi
  gcloud run deploy "$SERVICE" \
    --source . \
    --region "$REGION" \
    --allow-unauthenticated \
    --min-instances 0 \
    --max-instances 2 \
    --memory 512Mi \
    --timeout 300 \
    --set-env-vars "^|^${env_vars}" \
    --set-secrets "$SECRETS" \
    --quiet
}

echo "▶ 4. Cloud Run にデプロイ"
SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)' 2>/dev/null || true)"
if [[ -z "$SERVICE_URL" ]]; then
  deploy ""
  SERVICE_URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
fi
deploy "$SERVICE_URL"
echo "   URL: $SERVICE_URL"
curl -sf "$SERVICE_URL/health" >/dev/null && echo "   ヘルスチェック: OK" || echo "   ヘルスチェック: 失敗（ログを確認してください）"

echo "▶ 5. Firebase の初期設定"
# Google API を gcloud のログイン情報で直接呼ぶ（firebase-tools のログインは不要）
ACCESS_TOKEN="$(gcloud auth print-access-token)"
gapi() {
  local method="$1" url="$2" body="${3:-}"
  curl -sS -X "$method" "$url" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "x-goog-user-project: ${PROJECT}" \
    -H "Content-Type: application/json" \
    ${body:+--data "$body"}
}
http_status() {
  curl -s -o /dev/null -w '%{http_code}' "$1" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" -H "x-goog-user-project: ${PROJECT}"
}
wait_until() {
  local desc="$1" url="$2"
  for _ in $(seq 1 30); do
    [[ "$(http_status "$url")" == "200" ]] && return 0
    sleep 5
  done
  echo "   $desc の完了を確認できませんでした" >&2
  return 1
}

FIREBASE_API="https://firebase.googleapis.com/v1beta1/projects/${PROJECT}"
if [[ "$(http_status "$FIREBASE_API")" != "200" ]]; then
  gapi POST "${FIREBASE_API}:addFirebase" '{}' >/dev/null
  wait_until "Firebase の追加" "$FIREBASE_API"
  echo "   Firebase をプロジェクトに追加しました"
else
  echo "   Firebase: 追加済み"
fi

if ! gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcloud firestore databases create --database='(default)' --location="$REGION" --type=firestore-native >/dev/null
  echo "   Firestore データベースを作成しました（$REGION）"
else
  echo "   Firestore: 作成済み"
fi

AUTH_CONFIG="https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config"
if [[ "$(http_status "$AUTH_CONFIG")" != "200" ]]; then
  gapi POST "https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/identityPlatform:initializeAuth" '{}' >/dev/null
  wait_until "Authentication の有効化" "$AUTH_CONFIG"
  echo "   Firebase Authentication を有効化しました"
else
  echo "   Authentication: 有効化済み"
fi

# セキュリティルール: ルールセットを作成し、cloud.firestore のリリースに紐付ける
RULES_JSON="$(python3 -c 'import json,sys; print(json.dumps({"source":{"files":[{"name":"firestore.rules","content":open("firestore.rules").read()}]}}))')"
RULESET="$(gapi POST "https://firebaserules.googleapis.com/v1/projects/${PROJECT}/rulesets" "$RULES_JSON" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
RELEASE="projects/${PROJECT}/releases/cloud.firestore"
if [[ "$(http_status "https://firebaserules.googleapis.com/v1/${RELEASE}")" == "200" ]]; then
  gapi PATCH "https://firebaserules.googleapis.com/v1/${RELEASE}" \
    "{\"release\":{\"name\":\"${RELEASE}\",\"rulesetName\":\"${RULESET}\"}}" >/dev/null
else
  gapi POST "https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases" \
    "{\"name\":\"${RELEASE}\",\"rulesetName\":\"${RULESET}\"}" >/dev/null
fi
echo "   Firestore のセキュリティルールを適用しました"

# アプリ用のウェブアプリを登録し、設定値（公開情報）を取得する
WEB_APP="$(gapi GET "${FIREBASE_API}/webApps" | python3 -c 'import json,sys; a=json.load(sys.stdin).get("apps",[]); print(a[0]["name"] if a else "")')"
if [[ -z "$WEB_APP" ]]; then
  gapi POST "${FIREBASE_API}/webApps" '{"displayName":"my-calendar-app"}' >/dev/null
  for _ in $(seq 1 30); do
    WEB_APP="$(gapi GET "${FIREBASE_API}/webApps" | python3 -c 'import json,sys; a=json.load(sys.stdin).get("apps",[]); print(a[0]["name"] if a else "")')"
    [[ -n "$WEB_APP" ]] && break
    sleep 5
  done
  echo "   ウェブアプリを登録しました"
fi
WEB_CONFIG="$(gapi GET "https://firebase.googleapis.com/v1beta1/${WEB_APP}/config")"
FIREBASE_API_KEY="$(printf '%s' "$WEB_CONFIG" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("apiKey",""))')"
FIREBASE_APP_ID="$(printf '%s' "$WEB_CONFIG" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("appId",""))')"
FIREBASE_AUTH_DOMAIN="$(printf '%s' "$WEB_CONFIG" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("authDomain",""))')"
echo "   ウェブアプリ: ${FIREBASE_APP_ID}"

echo "▶ 6. Cloud Scheduler のジョブを作成・更新"
scheduler_job() {
  local name="$1" schedule="$2" path="$3"
  local args=(--location "$REGION" --schedule "$schedule" --time-zone "Asia/Tokyo"
    --uri "${SERVICE_URL}${path}" --http-method POST
    --attempt-deadline 300s)
  if gcloud scheduler jobs describe "$name" --location "$REGION" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$name" "${args[@]}" \
      --update-headers "X-Tasks-Secret=${TASKS_SECRET}" >/dev/null
  else
    gcloud scheduler jobs create http "$name" "${args[@]}" \
      --headers "X-Tasks-Secret=${TASKS_SECRET}" >/dev/null
  fi
  echo "   $name: $schedule → $path"
}
scheduler_job calendar-poll "*/10 * * * *" /tasks/poll
scheduler_job calendar-full-resync "15 3 * * *" /tasks/full-resync
scheduler_job calendar-renew-watch "30 3 * * *" /tasks/renew-watch

cat <<EOF

✅ デプロイが完了しました: $SERVICE_URL

残りの手動作業（初回のみ）:
  1. Google Cloud コンソール → Google Auth Platform → クライアント → ウェブ用クライアントの
     「承認済みのリダイレクト URI」に次を追加:
       ${SERVICE_URL}/auth/google/callback
  2. アプリのルートの .env を本番向けに変更（値はすべて公開情報）:
       EXPO_PUBLIC_API_BASE_URL=${SERVICE_URL}
       EXPO_PUBLIC_FIREBASE_API_KEY=${FIREBASE_API_KEY}
       EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN}
       EXPO_PUBLIC_FIREBASE_PROJECT_ID=${PROJECT}
       EXPO_PUBLIC_FIREBASE_APP_ID=${FIREBASE_APP_ID}
       EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=
  3. アプリでログインし直し、Google アカウントを連携し直す（エミュレータのデータは本番に移らない）
  4. watch チャネルを張る: 同期設定を作ったあとに
       gcloud scheduler jobs run calendar-renew-watch --location $REGION
EOF
