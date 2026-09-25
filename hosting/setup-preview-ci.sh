#!/usr/bin/env bash
# PR ごとのプレビュー URL（.github/workflows/preview.yml）に必要な Google Cloud と GitHub の設定を作る。
# 何度実行しても同じ状態になるように作ってある。
#
# 使い方: ./hosting/setup-preview-ci.sh
#
# 作るもの:
#   - Workload Identity のプール github-preview と、GitHub の OIDC を受ける入口 github-oidc
#     （このリポジトリの develop 向け PR の実行だけを受け付ける）
#   - プレビュー公開用のサービスアカウント github-preview（Firebase Hosting への公開だけ）
#   - GitHub のリポジトリ変数 GCP_PREVIEW_WIF_PROVIDER / GCP_PREVIEW_SA
#
# 本番デプロイ用のプール github とは分ける。同じプールに PR 用の入口を足すと、
# プールのリポジトリ単位で許可している本番用のサービスアカウント github-deployer に、PR からもなれてしまうため。
set -euo pipefail

PROJECT="${PROJECT:-my-calendar-app-509416}"
REPO="${REPO:-masa95814/my-calendar-app}"
POOL="github-preview"
PROVIDER="github-oidc"
SA_NAME="github-preview"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"

echo "▶ 1. Workload Identity のプールと入口"
if ! gcloud iam workload-identity-pools describe "$POOL" --location=global --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" --location=global --project "$PROJECT" \
    --display-name="GitHub PR preview" --quiet
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" --workload-identity-pool="$POOL" \
  --location=global --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --workload-identity-pool="$POOL" \
    --location=global --project "$PROJECT" --display-name="GitHub OIDC (PR)" \
    --issuer-uri=https://token.actions.githubusercontent.com \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.event_name=assertion.event_name,attribute.base_ref=assertion.base_ref" \
    --attribute-condition="assertion.repository == '${REPO}' && assertion.event_name == 'pull_request' && assertion.base_ref == 'develop'" \
    --quiet
fi

echo "▶ 2. プレビュー公開用のサービスアカウント: $SA"
if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" --display-name="GitHub PR preview deploy"
fi
# Firebase Hosting への公開（プレビューチャネルの作成とリリース）と、API 呼び出しの課金先の指定に必要
for role in roles/firebasehosting.admin roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" \
    --role="$role" --condition=None --quiet >/dev/null
done
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$PROJECT" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  --quiet >/dev/null

echo "▶ 3. GitHub のリポジトリ変数"
gh variable set GCP_PREVIEW_WIF_PROVIDER --repo "$REPO" \
  --body "projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
gh variable set GCP_PREVIEW_SA --repo "$REPO" --body "$SA"

echo "✅ 完了。develop 向けの PR を作ると、プレビュー URL が PR にコメントされます"
