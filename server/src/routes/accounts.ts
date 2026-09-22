import { Hono } from "hono";
import { z } from "zod";

import type { Config } from "../config.js";
import type { TokenCipher } from "../lib/crypto.js";
import { LINK_SCOPES, type GoogleOAuth } from "../lib/google.js";
import { logger } from "../lib/logger.js";
import { validateReturnUrl } from "../lib/url.js";
import type { AuthEnv } from "../middleware/auth.js";
import { toPublicAccount, type Stores } from "../repositories/index.js";

export type AccountRouteDeps = {
  config: Config;
  google: GoogleOAuth;
  stores: Stores;
  cipher: TokenCipher;
  now: () => Date;
  randomState: () => string;
};

const linkRequestSchema = z.object({
  /** 連携完了後に戻るアプリの URL */
  returnTo: z.string().min(1),
});

/**
 * 連携アカウントの API（すべて認証必須。/api 配下にマウントする）
 * - GET    /accounts        連携アカウント一覧
 * - POST   /accounts/link   連携開始。返された url をブラウザで開く
 * - DELETE /accounts/:id    連携解除（Google 側のトークンも失効させる）
 */
export function accountRoutes(deps: AccountRouteDeps) {
  const stateTtlMs = deps.config.OAUTH_STATE_TTL_SECONDS * 1000;
  const app = new Hono<AuthEnv>();

  app.get("/accounts", async (c) => {
    const accounts = await deps.stores.accounts.list(c.get("user").uid);
    return c.json({ accounts: accounts.map(toPublicAccount) });
  });

  app.post("/accounts/link", async (c) => {
    const body = linkRequestSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    const returnTo = body.success
      ? validateReturnUrl(
          body.data.returnTo,
          deps.config.APP_RETURN_URL_PREFIXES,
        )
      : undefined;
    if (!returnTo) {
      return c.json({ error: "invalid_return_to" }, 400);
    }
    const now = deps.now();
    const state = deps.randomState();
    await deps.stores.oauthStates.create({
      state,
      purpose: "link",
      uid: c.get("user").uid,
      returnTo,
      createdAt: now,
      expiresAt: new Date(now.getTime() + stateTtlMs),
    });
    const url = deps.google.authorizeUrl({
      state,
      scopes: LINK_SCOPES,
      offline: true,
    });
    return c.json({ url });
  });

  app.delete("/accounts/:id", async (c) => {
    const uid = c.get("user").uid;
    const accountId = c.req.param("id");
    const account = await deps.stores.accounts.get(uid, accountId);
    if (!account) {
      return c.json({ error: "not_found" }, 404);
    }
    // Google 側の許可も取り消す。失敗しても連携情報の削除は進める
    try {
      await deps.google.revokeToken(
        deps.cipher.decrypt(account.refreshTokenEnc),
      );
    } catch (error) {
      logger.warn(
        "Google トークンの失効に失敗しました（連携情報は削除します）",
        {
          accountId,
          error: String(error),
        },
      );
    }
    // このアカウントを使う同期設定は無効化する（削除はしない。再連携すれば有効に戻せる）
    // TODO(フェーズ 3): このアカウントに作成済みのミラー予定の削除
    const disabledRules = await deps.stores.rules.disableForAccount(
      uid,
      accountId,
    );
    await deps.stores.accounts.delete(uid, accountId);
    logger.info("Google アカウントの連携を解除しました", {
      uid,
      accountId,
      disabledRules,
    });
    return c.body(null, 204);
  });

  return app;
}
