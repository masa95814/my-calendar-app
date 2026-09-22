/** @typedef  {import("prettier").Config} PrettierConfig */
/** @typedef  {import("@ianvs/prettier-plugin-sort-imports").PluginConfig} SortImportsConfig */

/** @type { PrettierConfig | SortImportsConfig } */
const config = {
  // import の並び順を揃える
  // https://github.com/IanVS/prettier-plugin-sort-imports#importorder
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  importOrder: [
    "^(react/(.*)$)|^(react$)|^(react-native(.*)$)",
    "^(expo(.*)$)|^(expo$)",
    "<THIRD_PARTY_MODULES>",
    "",
    "^[../]",
    "^[./]",
  ],
  importOrderParserPlugins: ["typescript", "jsx", "decorators-legacy"],
  importOrderTypeScriptVersion: "5.0.0",
  // https://prettier.io/docs/en/options.html
  arrowParens: "always",
  printWidth: 80,
  singleQuote: false,
  semi: true,
  trailingComma: "all",
  tabWidth: 2,
  proseWrap: "always",
  overrides: [
    {
      // 日本語の Markdown は行の途中で折り返すと表示上スペースが入るため、折り返さずそのまま保持する
      files: "**/*.md",
      options: { proseWrap: "preserve" },
    },
  ],
};

export default config;
