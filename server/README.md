# server（バックエンド）

カレンダー連携アプリのバックエンド。Cloud Run 上で動かす Node.js 22 + TypeScript（Hono）のサービスです。
設計は [docs/requirements-and-design.md](../docs/requirements-and-design.md) を参照してください。

## 構成

```text
src/
  index.ts                  起動処理（.env 読み込み、Firebase 初期化、依存の組み立て、HTTP サーバー）
  app.ts                    Hono アプリの組み立て（ルート、エラーハンドリング）
  config.ts                 環境変数の検証と型付け
  lib/firebase.ts           Firebase Admin SDK の初期化
  lib/google.ts             Google OAuth（同意 URL、トークン交換、ID トークン検証、カレンダー一覧）
  lib/calendar.ts           Google Calendar API（予定の一覧・作成・更新・削除、watch）とエラー分類
  lib/crypto.ts             リフレッシュトークンの暗号化（AES-256-GCM）
  lib/url.ts                アプリへ戻る URL の検証とクエリ付与
  lib/logger.ts             Cloud Logging 向けの JSON ログ
  middleware/auth.ts        Firebase ID トークン検証と利用者の制限
  domain/rules.ts           同期設定のスキーマと検証（F2〜F4）
  domain/filter.ts          元予定をフィルタ条件で評価（F3）
  domain/mirror.ts          ミラー予定の組み立てと指紋（F4）
  services/sync.ts          同期エンジン（全件 / 差分同期、ミラーの作成・更新・削除、watch チャネル）
  repositories/index.ts     永続化のインターフェースと型
  repositories/firestore.ts Firestore 実装
  routes/health.ts          ヘルスチェック
  routes/auth.ts            ログインと OAuth コールバック
  routes/accounts.ts        連携アカウントの一覧・連携開始・解除
  routes/rules.ts           同期設定の CRUD と手動同期
  routes/tasks.ts           Cloud Scheduler 用の定期処理
  routes/webhooks.ts        Google の変更通知の受け口
test/                       vitest によるテスト（Firebase / Google / Calendar API は偽物に差し替え）
```

## エンドポイント

| メソッド | パス                           | 認証 | 用途                                                                                                                            |
| -------- | ------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/healthz`                     | 不要 | ヘルスチェック                                                                                                                  |
| GET      | `/auth/login/start?return_to=` | 不要 | アプリへのログイン開始。Google の同意画面へリダイレクト                                                                         |
| GET      | `/auth/google/callback`        | 不要 | Google からのコールバック。完了後 `return_to` に `?token=`（ログイン）または `?linked=`（連携）を付けて戻す。失敗時は `?error=` |
| GET      | `/api/me`                      | 必要 | ログイン確認                                                                                                                    |
| GET      | `/api/accounts`                | 必要 | 連携アカウント一覧（トークンは含まない）                                                                                        |
| POST     | `/api/accounts/link`           | 必要 | 連携開始。`{ "returnTo": "..." }` を渡すと同意画面の `url` が返る                                                               |
| DELETE   | `/api/accounts/:id`            | 必要 | 連携解除（Google 側のトークンも失効。そのアカウントを使う同期設定は無効化）                                                     |
| GET      | `/api/rules`                   | 必要 | 同期設定の一覧                                                                                                                  |
| POST     | `/api/rules`                   | 必要 | 同期設定の作成。形式エラーは 400（`details` に項目ごとの理由）、同じ送信元と同期先の組み合わせは 409                            |
| GET      | `/api/rules/:id`               | 必要 | 同期設定の取得                                                                                                                  |
| PUT      | `/api/rules/:id`               | 必要 | 同期設定の更新（全体置換）                                                                                                      |
| DELETE   | `/api/rules/:id`               | 必要 | 同期設定の削除（ミラー予定も削除）                                                                                              |
| POST     | `/api/rules/:id/sync`          | 必要 | その同期設定を手動で全件同期                                                                                                    |
| POST     | `/api/sync`                    | 必要 | すべての同期設定を手動で全件同期                                                                                                |
| POST     | `/tasks/poll`                  | 秘密 | 差分同期（Cloud Scheduler から 10 分間隔を想定）                                                                                |
| POST     | `/tasks/full-resync`           | 秘密 | 全件同期（1 日 1 回を想定。同期範囲の前進と孤児ミラーの掃除）                                                                   |
| POST     | `/tasks/renew-watch`           | 秘密 | watch チャネルの登録・更新（1 日 1 回を想定。`PUBLIC_BASE_URL` が必要）                                                         |
| POST     | `/webhooks/calendar`           | 不要 | Google からの変更通知（チャネル ID とトークンで検証）                                                                           |

「秘密」は `X-Tasks-Secret: <TASKS_SECRET>` ヘッダーが必要な意味です（開発で `TASKS_SECRET` が空なら不要）。

### 同期の仕組み

- 同期設定の作成・更新・手動同期は、その送信元カレンダーの**全件同期**を行います（同期範囲内を取得し、範囲内で消えた元予定のミラーも掃除）
- `/tasks/poll` と watch 通知は **差分同期** です（`syncToken` で変更分だけ取得）。`syncToken` が失効（410）したら自動で全件同期に切り替えます
- ミラー予定には `extendedProperties.private.mcaApp = "1"` と元予定の情報を埋め込み、ミラーのミラーができないようにしています。対応表は Firestore の `users/{uid}/mirrors` にあります
- 元予定が更新されたらミラーを更新、キャンセルやフィルタ対象外になったら削除、同期先で手動削除されていたら作り直します。種別（不在 / 予定あり）が変わった場合は作り直します
- 送信元・同期先のトークンが失効したら、そのアカウントを `reauth_required` にし、同期設定の `lastError` に記録します

### Cloud Scheduler の設定（デプロイ後）

```bash
SERVICE_URL=https://<サービスの URL>
gcloud scheduler jobs create http calendar-poll --location asia-northeast1 --schedule "*/10 * * * *" \
  --uri "$SERVICE_URL/tasks/poll" --http-method POST --headers "X-Tasks-Secret=<TASKS_SECRET>"
gcloud scheduler jobs create http calendar-full-resync --location asia-northeast1 --schedule "15 3 * * *" \
  --uri "$SERVICE_URL/tasks/full-resync" --http-method POST --headers "X-Tasks-Secret=<TASKS_SECRET>"
gcloud scheduler jobs create http calendar-renew-watch --location asia-northeast1 --schedule "30 3 * * *" \
  --uri "$SERVICE_URL/tasks/renew-watch" --http-method POST --headers "X-Tasks-Secret=<TASKS_SECRET>"
```

認証が必要な API は `Authorization: Bearer <Firebase ID トークン>` を付け、`OWNER_EMAILS` に含まれるメールアドレスのユーザーだけが呼べます。

### ログインの流れ

1. アプリが `/auth/login/start?return_to=<アプリの URL>` をブラウザで開く
2. Google でアカウントを選んで同意すると `/auth/google/callback` に戻る
3. バックエンドがメールアドレスを `OWNER_EMAILS` と照合し、Firebase のカスタムトークンを発行して `return_to?token=...` へリダイレクト
4. アプリは `signInWithCustomToken` でログインし、以降の API 呼び出しに ID トークンを付ける

### アカウント連携の流れ

1. アプリが `POST /api/accounts/link` で同意画面の URL を受け取り、ブラウザで開く
2. 連携したい Google アカウントでカレンダーの権限を許可すると `/auth/google/callback` に戻る
3. バックエンドがリフレッシュトークンを暗号化して Firestore に保存し、Workspace か個人かを判定、カレンダー一覧を取得して `return_to?linked=<email>` へリダイレクト

`return_to` は `APP_RETURN_URL_PREFIXES` で許可した先頭文字列に一致する URL だけ受け付けます。

失敗時に `return_to?error=` に付く値:

| 値                                                           | 意味                                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `expired`                                                    | state の有効期限切れ（10 分）。やり直す                                                                  |
| `not_allowed`                                                | ログインに使ったアカウントが `OWNER_EMAILS` に無い                                                       |
| `missing_refresh_token`                                      | Google がリフレッシュトークンを返さなかった。Google アカウント側でこのアプリのアクセス権を削除して再連携 |
| `insufficient_scope`                                         | 同意画面でカレンダーの権限が許可されなかった                                                             |
| `calendar_api_disabled`                                      | GCP プロジェクトで Google Calendar API が有効化されていない                                              |
| `invalid_grant` / `invalid_client` / `redirect_uri_mismatch` | OAuth クライアントの設定不備（リダイレクト URI、クライアント ID / シークレット）                         |
| `access_denied` など Google 由来の値                         | ユーザーが同意をキャンセルした、またはテストユーザー未登録                                               |
| `callback_failed`                                            | 上記以外の失敗。サーバーログを確認する                                                                   |

## ローカルで動かす

```bash
cd server
npm install
cp .env.example .env   # 値を埋める（OAuth クライアント ID / シークレットは必須）
npm run dev            # http://localhost:8080
curl http://localhost:8080/healthz
```

### Firebase の認証情報

- ローカルで本物の Firebase を使う場合: `gcloud auth application-default login` を実行しておく
- エミュレータを使う場合: `npx firebase-tools@latest emulators:start --only auth,firestore --project <プロジェクト ID>`（要 Java）を起動し、
  `.env` の `FIRESTORE_EMULATOR_HOST`（127.0.0.1:8090）と `FIREBASE_AUTH_EMULATOR_HOST`（127.0.0.1:9099）のコメントを外す。
  エミュレータの UI は `http://localhost:4000`

`/healthz` だけなら認証情報なしで起動できます。

## テスト・型チェック

```bash
npm test
npm run typecheck
```

## デプロイ（Cloud Run）

```bash
gcloud run deploy my-calendar-app-server \
  --source . \
  --region asia-northeast1 \
  --set-env-vars OWNER_EMAILS=you@example.com,GOOGLE_OAUTH_CLIENT_ID=...,OAUTH_REDIRECT_URI=https://<サービスの URL>/auth/google/callback \
  --set-secrets GOOGLE_OAUTH_CLIENT_SECRET=google-oauth-client-secret:latest,TOKEN_ENCRYPTION_KEY=token-encryption-key:latest
```

`GOOGLE_CLOUD_PROJECT` は Cloud Run が自動で設定します。
シークレット（OAuth のクライアントシークレット、トークン暗号鍵）は Secret Manager に登録し、`--set-secrets` で注入します。
デプロイ後、Google Cloud コンソールの OAuth クライアントの「承認済みのリダイレクト URI」にサービスの URL を追加してください。
