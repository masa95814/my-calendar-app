import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { Config } from "./config.js";
import type { TokenCipher } from "./lib/crypto.js";
import type { GoogleOAuth } from "./lib/google.js";
import { logger } from "./lib/logger.js";
import {
  requireOwner,
  type AuthEnv,
  type VerifyIdToken,
} from "./middleware/auth.js";
import type { Stores } from "./repositories/index.js";
import { accountRoutes } from "./routes/accounts.js";
import { authRoutes, type FirebaseUserService } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";

export type AppDependencies = {
  config: Config;
  verifyIdToken: VerifyIdToken;
  google: GoogleOAuth;
  stores: Stores;
  firebase: FirebaseUserService;
  cipher: TokenCipher;
  /** 現在時刻（テストで固定する） */
  now?: () => Date;
  /** OAuth の state を生成する（テストで固定する） */
  randomState?: () => string;
};

/**
 * Hono アプリを組み立てる。外部依存（設定、Google、Firestore、Firebase Auth）は引数で受け取り、
 * テストでは偽物に差し替えて `app.request()` から呼べるようにする。
 */
export function createApp(deps: AppDependencies) {
  const shared = {
    ...deps,
    now: deps.now ?? (() => new Date()),
    randomState:
      deps.randomState ?? (() => randomBytes(24).toString("base64url")),
  };

  const app = new Hono();

  // 認証不要
  app.route("/", healthRoutes);
  app.route("/", authRoutes(shared));

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
  api.route("/", accountRoutes(shared));
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
