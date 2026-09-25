import { z } from "zod";

const commaSeparatedList = (value: string): string[] =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

// 環境変数の定義。起動時に一度だけ検証し、以降は型付きの Config として扱う
const envSchema = z
  .object({
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
        commaSeparatedList(value).map((email) => email.toLowerCase()),
      ),

    // Google OAuth（ログインとアカウント連携の両方で同じウェブ用クライアントを使う）
    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
    OAUTH_REDIRECT_URI: z.string().url(),

    // OAuth 完了後にアプリへ戻る URL として許可する先頭文字列（カンマ区切り）
    // 例: mycalendarapp://（開発ビルド）、exp://（Expo Go）、http://localhost（Web）
    APP_RETURN_URL_PREFIXES: z
      .string()
      .default("mycalendarapp://,exp://,http://localhost")
      .transform(commaSeparatedList),

    // ブラウザ（Web 版アプリ）から /api を呼ぶことを許可するオリジン（カンマ区切り、完全一致）
    // localhost と 127.0.0.1 はポートを問わず常に許可する（開発用の Web 版）
    WEB_ALLOWED_ORIGINS: z.string().default("").transform(commaSeparatedList),

    // OAuth の state（CSRF 対策の一時トークン）の有効期間
    OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().positive().default(600),

    // リフレッシュトークンを Firestore に保存するときの暗号鍵（base64 の 32 バイト）
    // `openssl rand -base64 32` で生成する。本番では必須、開発では省略可（平文保存になる）
    TOKEN_ENCRYPTION_KEY: z.string().min(1).optional(),

    // Cloud Scheduler からの /tasks/* 呼び出しを認証する共有シークレット（X-Tasks-Secret ヘッダー）
    // 本番では必須。開発で未設定なら認証なしで呼べる
    TASKS_SECRET: z.string().min(1).optional(),

    // このサービスの公開 URL（例: https://xxx.run.app）。設定すると events.watch の通知先に使う
    // 未設定ならポーリングだけで同期する（ローカル開発）
    PUBLIC_BASE_URL: z.string().url().optional(),

    // 同期エラーや再認証が必要になったときに通知する Slack の Incoming Webhook の URL。未設定なら通知しない
    SLACK_WEBHOOK_URL: z.string().url().optional(),
    // 同期エラーと連携切れの通知でメンションする Slack のメンバー ID（例: U01ABCDEF）。未設定ならメンションしない
    // Slack のプロフィール →「︙」→「メンバー ID をコピー」で確認できる
    SLACK_MENTION_USER_ID: z
      .string()
      .regex(/^[UW][A-Z0-9]+$/, "Slack のメンバー ID（U から始まる英数字）")
      .optional(),

    // 予算アラートを Pub/Sub から push するサービスアカウントのメール。設定すると /webhooks/budget を受け付ける
    // （push に付く ID トークンを、このアカウント・このサービスの URL 宛てとして検証する）
    BUDGET_PUSH_SA_EMAIL: z.string().email().optional(),

    // watch チャネルの有効期間（秒）。Google の上限に合わせて既定は 7 日
    WATCH_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(7 * 24 * 60 * 60),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.TOKEN_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TOKEN_ENCRYPTION_KEY"],
        message: "本番では必須です（openssl rand -base64 32 で生成した値）",
      });
    }
    if (env.NODE_ENV === "production" && !env.TASKS_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TASKS_SECRET"],
        message:
          "本番では必須です（Cloud Scheduler のヘッダーに設定する共有シークレット）",
      });
    }
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
