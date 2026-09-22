// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // app-example はテンプレートの雛形（gitignore 済み）なので lint 対象外にする
    // server はバックエンド（Node.js）で、Expo 用の設定とは別に管理する
    ignores: ["dist/*", "app-example/*", "server/**"],
  },
]);
