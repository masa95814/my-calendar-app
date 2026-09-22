// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // app-example はテンプレートの雛形（gitignore 済み）なので lint 対象外にする
    ignores: ['dist/*', 'app-example/*'],
  },
]);
