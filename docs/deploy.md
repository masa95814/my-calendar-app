# 本番デプロイ手順

バックエンドを Cloud Run に置き、Cloud Scheduler で定期同期を回します。
作業のほとんどは `server/scripts/deploy.sh` が行います。何度実行しても同じ状態になるので、コードを更新したときの再デプロイにもそのまま使えます。

## CI/CD（GitHub Actions）

通常の本番反映は **main へのマージで自動** で行われます。手元での `deploy.sh` の実行は、初回構築や設定（環境変数・シークレット・権限・Scheduler）を変えるときだけで済みます。

| ワークフロー                             | タイミング                                          | 内容                                                                                  |
| ---------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| CI（`.github/workflows/ci.yml`）         | develop / main への Pull Request、develop への push | アプリの型チェック・ESLint・Prettier・Web ビルド、サーバーの型チェック・テスト        |
| Deploy（`.github/workflows/deploy.yml`） | main への push（マージ）、手動実行（main のみ）     | バックエンドを Cloud Run に配置、Web 版アプリとホームページを Firebase Hosting に公開 |

- Google Cloud へは Workload Identity 連携で認証する。鍵ファイルや秘密情報は GitHub に置かない
- 受け付けるのは `masa95814/my-calendar-app` の `refs/heads/main` からの実行だけ（Workload Identity プロバイダの条件で制限）
- デプロイ専用アカウント `github-deployer@my-calendar-app-509416.iam.gserviceaccount.com` の権限: `roles/run.sourceDeveloper`、`roles/firebasehosting.admin`、`roles/logging.viewer`、`roles/serviceusage.serviceUsageConsumer`、実行アカウント（compute の既定）への `roles/iam.serviceAccountUser`
- Cloud Run の環境変数とシークレットは既存の設定を引き継ぐ。変える場合は手元で `server/scripts/deploy.sh` を実行する
- GitHub のリポジトリ変数（Settings → Secrets and variables → Actions → Variables）: `GCP_PROJECT_ID`、`GCP_REGION`、`CLOUD_RUN_SERVICE`、`GCP_WIF_PROVIDER`、`GCP_DEPLOY_SA`、`EXPO_PUBLIC_*`（すべて公開情報）

## 1. 事前準備（初回のみ）

```bash
curl https://sdk.cloud.google.com | bash   # Homebrew が使えない場合もこちらで入る
gcloud auth login
```

Apple シリコンの Mac では、gcloud 用に Python 3.10 以上を `CLOUDSDK_PYTHON` で指定する必要があります（システムの Python が 3.9 以下の場合）。

`server/.env` に次の値が入っていることを確認します（ローカル開発で使っているものと同じ）。

| 変数                                                    | 内容                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `GOOGLE_CLOUD_PROJECT`                                  | `my-calendar-app-509416`                                                              |
| `OWNER_EMAILS`                                          | アプリにログインできるメールアドレス                                                  |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | ウェブ用 OAuth クライアント                                                           |
| `TOKEN_ENCRYPTION_KEY`                                  | リフレッシュトークンの暗号鍵                                                          |
| `TASKS_SECRET`                                          | 任意。空ならスクリプトが生成して Secret Manager に保存する                            |
| `SLACK_WEBHOOK_URL`                                     | 任意。同期エラーなどを通知する Slack の Incoming Webhook の URL（下の「Slack 通知」） |

## 2. デプロイ

```bash
cd server
./scripts/deploy.sh
```

スクリプトが行うこと:

1. 必要な API の有効化（Cloud Run、Cloud Build、Secret Manager、Cloud Scheduler、Calendar、Firestore、Firebase など）。請求先アカウントのリンクが事前に必要
2. シークレット 3 つ（OAuth クライアントシークレット、トークン暗号鍵、タスク用シークレット）を Secret Manager に登録。値が変わったときだけ新しいバージョンを追加
3. Cloud Run の実行サービスアカウントに権限を付与（シークレットの読み取り、Firestore、Firebase Auth、カスタムトークンの署名）
4. Cloud Run にデプロイ。初回は URL が決まってから、その URL を `PUBLIC_BASE_URL` と `OAUTH_REDIRECT_URI` に設定して再デプロイ
5. Firebase の初期設定: Firebase の追加、Firestore データベースの作成、Firebase Authentication の有効化、セキュリティルール（クライアントからの直接アクセスをすべて禁止）の適用、アプリ用ウェブアプリの登録
6. Cloud Scheduler のジョブ 3 つを作成・更新

| ジョブ                 | 間隔      | 内容                                         |
| ---------------------- | --------- | -------------------------------------------- |
| `calendar-poll`        | 10 分ごと | 差分同期                                     |
| `calendar-full-resync` | 毎日 3:15 | 全件同期（同期範囲の前進と孤児ミラーの掃除） |
| `calendar-renew-watch` | 毎日 3:30 | 変更通知（watch）チャネルの登録・更新        |

## 3. デプロイ後の手動作業（初回のみ）

1. **リダイレクト URI の追加**: Google Cloud コンソール → Google Auth Platform → クライアント → ウェブ用クライアント の「承認済みのリダイレクト URI」に、スクリプトの最後に表示される `https://.../auth/google/callback` を追加
2. **アプリの接続先を本番に**: ルートの `.env` を次のように変更
   - `EXPO_PUBLIC_API_BASE_URL` にサービスの URL
   - `EXPO_PUBLIC_FIREBASE_API_KEY` などの Firebase の値（スクリプトの最後に表示される）
   - `EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` を空にする
3. **ログインと連携のやり直し**: エミュレータのデータは本番に移らないので、アプリでログインし、Google アカウントを連携し直して同期設定を作る
4. **watch チャネルの登録**: 同期設定を作ったら一度だけ手動で実行（以降は毎日自動）

   ```bash
   gcloud scheduler jobs run calendar-renew-watch --location asia-northeast1
   ```

5. **OAuth 同意画面を「本番」に**: 動作確認ができたら、Google Auth Platform → 対象 で公開ステータスを「本番環境」にする。「テスト」のままだとリフレッシュトークンが 7 日で失効し、毎週連携し直しが必要になる

## 4. 運用

- **ログ**: `gcloud run services logs read my-calendar-app-server --region asia-northeast1 --limit 100`
- **手動で同期**: アプリの設定タブの「今すぐ同期」、または `gcloud scheduler jobs run calendar-poll --location asia-northeast1`
- **再デプロイ**: `cd server && ./scripts/deploy.sh`
- **Slack 通知**: 同期設定がエラーになったとき・復旧したとき、アカウントの連携が切れた（再認証が必要）ときに、Slack の Incoming Webhook へ通知する。状態が変わったときだけ送るので、10 分ごとの同期で同じ通知は繰り返さない
  1. Slack で Incoming Webhook を作り、URL（`https://hooks.slack.com/services/...`）を控える
  2. シークレットに登録する（URL は履歴に残らないよう `read -s` で入力する）:
     ```bash
     read -rs SLACK_URL && printf '%s' "$SLACK_URL" | gcloud secrets create slack-webhook-url --replication-policy=automatic --data-file=- ; unset SLACK_URL
     ```
     URL を変えるときは `gcloud secrets versions add slack-webhook-url --data-file=-`
  3. Cloud Run に渡す: `gcloud run services update my-calendar-app-server --region asia-northeast1 --update-secrets SLACK_WEBHOOK_URL=slack-webhook-url:latest`（以後の自動デプロイ・`deploy.sh` でも引き継ぐ）
  4. アプリの設定タブの「Slack にテスト通知を送る」で届くか確認する
- **費用**: 個人利用の規模（10 分ごとの同期、4 アカウント程度）なら Cloud Run・Firestore・Scheduler とも無料枠に収まる想定。Cloud Scheduler は 3 ジョブまで無料

## トラブルシューティング

| 症状                                                      | 原因と対処                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `Billing account ... is not found`                        | プロジェクトに請求先アカウントがリンクされていない。`gcloud billing projects link <PROJECT> --billing-account=<ID>` |
| ビルドで `PERMISSION_DENIED ... could not resolve source` | 実行サービスアカウントに `roles/cloudbuild.builds.builder` が無い（スクリプトで付与済み）                           |
| `/healthz` が Google の 404 ページになる                  | Cloud Run は末尾が z のパスを予約している。`/health` を使う                                                         |

## ホームページとプライバシーポリシー

OAuth 同意画面を本番環境にするには、ブランディングにホームページとプライバシーポリシーの URL が必要です。`hosting/public/` のページを Firebase Hosting（既定のサイト）に公開しています。

```bash
./hosting/deploy.sh my-calendar-app-509416
```

| ページ               | URL                                              |
| -------------------- | ------------------------------------------------ |
| ホームページ         | `https://my-calendar-app-509416.web.app`         |
| プライバシーポリシー | `https://my-calendar-app-509416.web.app/privacy` |

検索エンジンに載らないよう、`robots.txt`（全ページ拒否）、各ページの `<meta name="robots">`、`X-Robots-Tag` ヘッダーの 3 つで `noindex` を指定しています。

## Web 版アプリの公開

アプリの Web 版を Firebase Hosting のアプリ用サイトに公開しています。ブラウザからそのまま本番のアプリを使えます。

```bash
npm run deploy:web      # = ./hosting/deploy-app.sh（ビルドして公開）
```

| 項目         | 値                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| アプリの URL | `https://my-calendar-app-509416-app.web.app`                                                                                      |
| 接続先       | ルートの `.env` の `EXPO_PUBLIC_*` がビルドに埋め込まれる（本番向けにしておくこと。エミュレータ向けのままだとスクリプトが止める） |

バックエンドがこの URL からのアクセス（CORS）とログイン後の戻り先を許可するよう、`server/.env` の `WEB_APP_URL` に URL を設定し、`server/scripts/deploy.sh` で反映します。
