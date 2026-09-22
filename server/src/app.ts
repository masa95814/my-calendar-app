import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { Config } from "./config.js";
import { logger } from "./lib/logger.js";
import {
  requireOwner,
  type AuthEnv,
  type VerifyIdToken,
} from "./middleware/auth.js";
import { healthRoutes } from "./routes/health.js";

export type AppDependencies = {
  config: Config;
  verifyIdToken: VerifyIdToken;
};

/**
 * Hono アプリを組み立てる。外部依存（設定、トークン検証）は引数で受け取り、
 * テストでは Firebase なしで `app.request()` から呼べるようにする。
 */
export function createApp(deps: AppDependencies) {
  const app = new Hono();

  // 認証不要
  app.route("/", healthRoutes);

  // 認証必須（許可されたメールアドレスのみ）
  const api = new Hono<AuthEnv>();
  api.use(
    "*",
    requireOwner({
      ownerEmails: deps.config.OWNER_EMAILS,
      verifyIdToken: deps.verifyIdToken,
    }),
  );
  // ログイン確認用。アプリ側がトークンとバックエンドの疎通を確かめるのに使う
  api.get("/me", (c) => c.json(c.get("user")));
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
