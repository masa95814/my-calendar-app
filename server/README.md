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
  lib/google.ts             Google OAuth / Calendar API（同意 URL、トークン交換、ID トークン検証、カレンダー一覧）
  lib/crypto.ts             リフレッシュトークンの暗号化（AES-256-GCM）
  lib/url.ts                アプリへ戻る URL の検証とクエリ付与
  lib/logger.ts             Cloud Logging 向けの JSON ログ
  middleware/auth.ts        Firebase ID トークン検証と利用者の制限
  repositories/index.ts     永続化のインターフェースと型
  repositories/firestore.ts Firestore 実装
  routes/health.ts          ヘルスチェック
  routes/auth.ts            ログインと OAuth コールバック
  routes/accounts.ts        連携アカウントの一覧・連携開始・解除
test/                       vitest によるテスト（Firebase / Google は偽物に差し替え）
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
| DELETE   | `/api/accounts/:id`            | 必要 | 連携解除（Google 側のトークンも失効）                                                                                           |

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
- エミュレータを使う場合: `npx firebase emulators:start`（要 firebase-tools と Java）を起動し、
  `.env` の `FIRESTORE_EMULATOR_HOST` と `FIREBASE_AUTH_EMULATOR_HOST` のコメントを外す

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
