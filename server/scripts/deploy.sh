#!/usr/bin/env bash
# Cloud Run へのデプロイ（何度実行しても同じ状態になるように作ってある）
#
# 使い方:
#   cd server
#   gcloud auth login                       # 初回のみ
#   npx firebase-tools@latest login         # 初回のみ（Firestore ルールの適用に使う）
#   ./scripts/deploy.sh                     # server/.env の値を使ってデプロイ
#
# やること:
#   1. 必要な API を有効化
#   2. シークレット（OAuth クライアントシークレット、トークン暗号鍵、タスク用シークレット）を Secret Manager に登録
#   3. Cloud Run の実行サービスアカウントに権限を付与
#   4. Cloud Run にデプロイ（初回は URL 確定後に、その URL で環境変数を設定して再デプロイ）
#   5. Firestore のセキュリティルールを適用
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
  iamcredentials.googleapis.com identitytoolkit.googleapis.com

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
  local env_vars="NODE_ENV=production|OWNER_EMAILS=${OWNER_EMAILS}|GOOGLE_OAUTH_CLIENT_ID=${CLIENT_ID}|APP_RETURN_URL_PREFIXES=${RETURN_PREFIXES}"
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
    --set-secrets "GOOGLE_OAUTH_CLIENT_SECRET=google-oauth-client-secret:latest,TOKEN_ENCRYPTION_KEY=token-encryption-key:latest,TASKS_SECRET=tasks-secret:latest" \
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
curl -sf "$SERVICE_URL/healthz" >/dev/null && echo "   ヘルスチェック: OK" || echo "   ヘルスチェック: 失敗（ログを確認してください）"

echo "▶ 5. Firestore のセキュリティルールを適用"
npx -y firebase-tools@latest deploy --only firestore:rules --project "$PROJECT" --non-interactive

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
  2. アプリのルートの .env を本番向けに変更:
       EXPO_PUBLIC_API_BASE_URL=${SERVICE_URL}
       EXPO_PUBLIC_FIREBASE_API_KEY / EXPO_PUBLIC_FIREBASE_APP_ID に Firebase のウェブアプリ設定の値
       EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST は空にする
  3. アプリでログインし直し、Google アカウントを連携し直す（エミュレータのデータは本番に移らない）
  4. watch チャネルを張る: 同期設定を作ったあとに
       gcloud scheduler jobs run calendar-renew-watch --location $REGION
EOF
