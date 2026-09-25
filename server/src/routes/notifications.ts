import { Hono } from "hono";

import type { Notify } from "../lib/slack.js";
import type { AuthEnv } from "../middleware/auth.js";

export type NotificationRouteDeps = {
  notify?: Notify;
};

/**
 * 通知の API（認証必須。/api 配下にマウントする）
 * - POST /notifications/test  Slack にテスト通知を送る（届くかの確認用）
 */
export function notificationRoutes(deps: NotificationRouteDeps) {
  const app = new Hono<AuthEnv>();

  app.post("/notifications/test", async (c) => {
    if (!deps.notify) {
      return c.json({ error: "notifications_not_configured" }, 409);
    }
    await deps.notify(
      `✅ カレンダー連携からのテスト通知です（${c.get("user").email}）`,
    );
    return c.json({ sent: true });
  });

  return app;
}
