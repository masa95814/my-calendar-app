# 本番デプロイ手順

バックエンドを Cloud Run に置き、Cloud Scheduler で定期同期を回します。
作業のほとんどは `server/scripts/deploy.sh` が行います。何度実行しても同じ状態になるので、コードを更新したときの再デプロイにもそのまま使えます。

## 1. 事前準備（初回のみ）

```bash
curl https://sdk.cloud.google.com | bash   # Homebrew が使えない場合もこちらで入る
gcloud auth login
```

Apple シリコンの Mac では、gcloud 用に Python 3.10 以上を `CLOUDSDK_PYTHON` で指定する必要があります（システムの Python が 3.9 以下の場合）。

`server/.env` に次の値が入っていることを確認します（ローカル開発で使っているものと同じ）。

| 変数                                                    | 内容                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------- |
| `GOOGLE_CLOUD_PROJECT`                                  | `my-calendar-app-509416`                                   |
| `OWNER_EMAILS`                                          | アプリにログインできるメールアドレス                       |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | ウェブ用 OAuth クライアント                                |
| `TOKEN_ENCRYPTION_KEY`                                  | リフレッシュトークンの暗号鍵                               |
| `TASKS_SECRET`                                          | 任意。空ならスクリプトが生成して Secret Manager に保存する |

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
