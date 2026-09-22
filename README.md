# my-calendar-app

複数の Google アカウント（Google Workspace と個人）のカレンダーを連携し、あるアカウントの予定を、他のアカウントのカレンダーに「不在」または「予定あり」として自動で反映するアプリです。

- 要件と設計: [docs/requirements-and-design.md](docs/requirements-and-design.md)
- 本番デプロイ: [docs/deploy.md](docs/deploy.md)
- バックエンド: [server/README.md](server/README.md)

## 構成

```text
index.ts                 アプリのエントリーポイント（registerRootComponent）
app.json                 Expo の設定
src/
  App.tsx                アプリのルート（ログイン状態と画面遷移の組み立て）
  navigation/            画面遷移（タブ、同期設定のスタック）と画面パラメータの型
  screens/               画面（ログイン、カレンダー、同期設定の一覧と編集、アカウント、設定）
  components/            画面で共通の部品（フォームの入力部品など）
  auth/                  ログイン状態の管理と、ブラウザでの認証の共通処理
  lib/                   API クライアント、Firebase、日付・色・同期設定の補助関数
  config/                公開設定（EXPO_PUBLIC_* の環境変数）
  assets/images/         アイコン、スプラッシュ画面、ファビコン
server/                  バックエンド（Cloud Run / Node.js 22 + TypeScript）
docs/                    要件・設計、デプロイ手順
```

## ローカルで動かす

```bash
npm install
cp .env.example .env    # 接続先を設定する（EXPO_PUBLIC_* はビルドに埋め込まれる公開情報のみ）
npx expo start --web    # Web 版（http://localhost:8081）
```

`.env` の接続先:

- **本番**: `EXPO_PUBLIC_API_BASE_URL` に Cloud Run の URL、Firebase の値に本番のウェブアプリ設定、`EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` は空
- **ローカル開発**: `.env.example` のとおり。`server/` のバックエンドと Firebase エミュレータを先に起動する（[server/README.md](server/README.md)）

スマホで動かす場合の注意:

- iOS シミュレータと Web は `localhost` でローカルのバックエンドに届く
- Android エミュレータは `adb reverse tcp:8080 tcp:8080`（Auth エミュレータを使うなら `tcp:9099` も）が必要
- 実機は Google の OAuth の戻り先が端末自身の `localhost` になるため、本番（Cloud Run）に接続して使う

## チェック

```bash
npm run typecheck   # 型チェック
npm run lint        # ESLint
npm run format      # Prettier（整形は npm run format:fix）
cd server && npm test && npm run typecheck
```

## 開発の進め方

- 変更は必ずブランチを切り、`develop` への Pull Request にする
- `main` は本番稼働時にだけ `develop` からマージする
- Pull Request では CI（型チェック、ESLint、Prettier、テスト、Web ビルド）が自動で走る。`main` へのマージで本番に自動で反映される（[docs/deploy.md](docs/deploy.md)）
