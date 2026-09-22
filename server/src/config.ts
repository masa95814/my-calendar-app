import { z } from "zod";

// 環境変数の定義。起動時に一度だけ検証し、以降は型付きの Config として扱う
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8080),

  // Google Cloud / Firebase のプロジェクト ID（Cloud Run 上では自動で入る）
  GOOGLE_CLOUD_PROJECT: z.string().min(1).optional(),

  // アプリの利用を許可するメールアドレス（カンマ区切り）。小文字に正規化する
  OWNER_EMAILS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email.length > 0),
    ),

  // Google OAuth（フェーズ 1 で必須にする。フェーズ 0 では未設定でも起動できる）
  GOOGLE_OAUTH_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1).optional(),
  OAUTH_REDIRECT_URI: z.string().url().optional(),
  APP_DEEP_LINK: z.string().min(1).default("mycalendarapp://linked"),
});

export type Config = z.infer<typeof envSchema>;

/**
 * 環境変数を検証して Config を返す。不正な値があれば理由をまとめて例外にする。
 * テストでは env を明示的に渡せる。
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`環境変数が不正です:\n${details}`);
  }
  return result.data;
}

/**
 * ローカル開発用に .env を読み込む。ファイルが無ければ何もしない。
 * 本番（Cloud Run）では環境変数を直接注入するため呼ばれても無害。
 */
export function loadDotEnv(path = ".env"): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // .env が存在しない場合は無視する
  }
}
