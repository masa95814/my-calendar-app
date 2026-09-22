# server（バックエンド）

カレンダー連携アプリのバックエンド。Cloud Run 上で動かす Node.js 22 + TypeScript（Hono）のサービスです。
設計は [docs/requirements-and-design.md](../docs/requirements-and-design.md) を参照してください。

## 構成

```text
src/
  index.ts           起動処理（.env 読み込み、Firebase 初期化、HTTP サーバー）
  app.ts             Hono アプリの組み立て（ルート、エラーハンドリング）
  config.ts          環境変数の検証と型付け
  lib/firebase.ts    Firebase Admin SDK の初期化
  lib/logger.ts      Cloud Logging 向けの JSON ログ
  middleware/auth.ts Firebase ID トークン検証と利用者の制限
  routes/health.ts   ヘルスチェック
test/                vitest によるテスト（Firebase 不要）
```

## ローカルで動かす

```bash
cd server
npm install
cp .env.example .env   # 値を埋める
npm run dev            # http://localhost:8080
curl http://localhost:8080/healthz
```

`/api/*` は Firebase ID トークン（`Authorization: Bearer <token>`）が必要で、
`OWNER_EMAILS` に含まれるメールアドレスのユーザーだけが呼べます。

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
  --set-env-vars OWNER_EMAILS=you@example.com \
  --set-secrets GOOGLE_OAUTH_CLIENT_SECRET=google-oauth-client-secret:latest
```

`GOOGLE_CLOUD_PROJECT` は Cloud Run が自動で設定します。
OAuth のクライアントシークレットは Secret Manager に登録し、`--set-secrets` で注入します。
