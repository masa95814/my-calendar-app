// アプリの公開設定。EXPO_PUBLIC_ で始まる環境変数はビルド時に埋め込まれる（シークレットは置かない）。
// 値は .env（git 管理外）で上書きできる。.env.example を参照。
// 注意: Expo は `process.env.EXPO_PUBLIC_XXX` と直接書いた箇所だけを置換するため、変数経由で参照しない。

export const appEnv = {
  /** バックエンド（server/）の URL。末尾のスラッシュなし */
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:8080",

  /** Firebase のウェブアプリ設定（Firebase コンソール → プロジェクトの設定 → マイアプリ）。公開情報 */
  firebase: {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId:
      process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "my-calendar-app-509416",
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
  },

  /**
   * 画面確認用のモック表示（EXPO_PUBLIC_MOCK=1）。サーバーにも Firebase にもつながず、見本のデータで動く。
   * ログインも省く。PR ごとのプレビュー URL と `npm run web:mock` で使う
   */
  mock: process.env.EXPO_PUBLIC_MOCK === "1",

  /** Firebase Auth エミュレータに接続する場合のホスト（例: 127.0.0.1:9099）。未設定なら本物に接続 */
  firebaseAuthEmulatorHost: process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
};
