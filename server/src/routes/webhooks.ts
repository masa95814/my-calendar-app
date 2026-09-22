import { Hono } from "hono";

import { logger } from "../lib/logger.js";
import type { SyncService } from "../services/sync.js";

export type WebhookRouteDeps = {
  sync: SyncService;
};

/**
 * Google Calendar の変更通知（events.watch）の受け口。
 * ヘッダーのチャネル ID とトークンで正当性を確認し、該当カレンダーの差分同期を走らせる。
 * Google は 2xx 以外だと再送するため、無視する通知にも 200 を返す。
 */
export function webhookRoutes(deps: WebhookRouteDeps) {
  const app = new Hono();

  app.post("/webhooks/calendar", async (c) => {
    const channelId = c.req.header("X-Goog-Channel-ID");
    const token = c.req.header("X-Goog-Channel-Token");
    const resourceState = c.req.header("X-Goog-Resource-State");
    try {
      const result = await deps.sync.handleNotification({
        channelId,
        token,
        resourceState,
      });
      if (!result.handled) {
        logger.warn("不明な watch 通知を無視しました", {
          channelId,
          resourceState,
        });
      } else if (result.summary) {
        logger.info("watch 通知で差分同期を実行しました", {
          channelId,
          ...result.summary,
        });
      }
      return c.body(null, 200);
    } catch (error) {
      logger.error("watch 通知の処理に失敗しました", {
        channelId,
        error: String(error),
      });
      // 再送されても同じ結果になる可能性が高いので 200 で握りつぶし、次回のポーリングに任せる
      return c.body(null, 200);
    }
  });

  return app;
}
