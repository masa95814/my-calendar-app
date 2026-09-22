import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import type { Config } from "./config.js";
import type { CalendarClient } from "./lib/calendar.js";
import type { TokenCipher } from "./lib/crypto.js";
import type { GoogleOAuth } from "./lib/google.js";
import { logger } from "./lib/logger.js";
import {
  requireOwner,
  type AuthEnv,
  type VerifyIdToken,
} from "./middleware/auth.js";
import type { LinkedAccount, Stores } from "./repositories/index.js";
import { accountRoutes } from "./routes/accounts.js";
import { authRoutes, type FirebaseUserService } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { healthRoutes } from "./routes/health.js";
import { ruleRoutes } from "./routes/rules.js";
import { taskRoutes } from "./routes/tasks.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { createSyncService } from "./services/sync.js";

export type AppDependencies = {
  config: Config;
  verifyIdToken: VerifyIdToken;
  google: GoogleOAuth;
  stores: Stores;
  firebase: FirebaseUserService;
  cipher: TokenCipher;
  /** 連携アカウントの Calendar API クライアント */
  calendarFor: (account: LinkedAccount) => CalendarClient;
  /** 現在時刻（テストで固定する） */
  now?: () => Date;
  /** OAuth の state を生成する（テストで固定する） */
  randomState?: () => string;
  /** watch チャネルの ID などを生成する（テストで固定する） */
  randomId?: () => string;
};

/**
 * Hono アプリを組み立てる。外部依存（設定、Google、Firestore、Firebase Auth）は引数で受け取り、
 * テストでは偽物に差し替えて `app.request()` から呼べるようにする。
 */
export function createApp(deps: AppDependencies) {
  const now = deps.now ?? (() => new Date());
  const sync = createSyncService({
    stores: deps.stores,
    calendarFor: deps.calendarFor,
    now,
    randomId: deps.randomId ?? (() => randomUUID()),
    ...(deps.config.PUBLIC_BASE_URL
      ? { publicBaseUrl: deps.config.PUBLIC_BASE_URL }
      : {}),
    watchTtlSeconds: deps.config.WATCH_TTL_SECONDS,
  });
  const shared = {
    ...deps,
    now,
    randomState:
      deps.randomState ?? (() => randomBytes(24).toString("base64url")),
    sync,
  };

  const app = new Hono();

  // 認証不要
  app.route("/", healthRoutes);
  app.route("/", authRoutes(shared));
  app.route("/", webhookRoutes(shared));
  // Cloud Scheduler 用（共有シークレットで保護）
  app.route("/", taskRoutes(shared));

  // 認証必須（許可されたメールアドレスのみ）
  const api = new Hono<AuthEnv>();
  // Web 版アプリ（ブラウザ）から呼べるようにする。認証は Authorization ヘッダーで行うので Cookie は使わない。
  // プリフライト（OPTIONS）は認証より前に応答する必要があるため、認証ミドルウェアより先に置く
  const allowedOrigins = new Set(deps.config.WEB_ALLOWED_ORIGINS);
  api.use(
    "*",
    cors({
      origin: (origin) =>
        allowedOrigins.has(origin) ||
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
          ? origin
          : null,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
    }),
  );
  api.use(
    "*",
    requireOwner({
      ownerEmails: deps.config.OWNER_EMAILS,
      verifyIdToken: deps.verifyIdToken,
    }),
  );
  // ログイン確認用。アプリ側がトークンとバックエンドの疎通を確かめるのに使う
  api.get("/me", (c) => c.json(c.get("user")));
  // 手動で全同期設定を同期する（アプリの「今すぐ同期」）
  api.post("/sync", async (c) => {
    const summary = await sync.syncUser(c.get("user").uid, { full: true });
    return c.json({ summary });
  });
  api.route("/", accountRoutes(shared));
  api.route("/", ruleRoutes(shared));
  api.route("/", eventRoutes(shared));
  app.route("/api", api);

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    logger.error("未処理のエラー", {
      error: String(error),
      stack: error.stack,
      path: c.req.path,
    });
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
