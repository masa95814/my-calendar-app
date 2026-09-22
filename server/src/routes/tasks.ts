import { Hono } from "hono";

import type { Config } from "../config.js";
import { logger } from "../lib/logger.js";
import type { Stores } from "../repositories/index.js";
import type { SyncService } from "../services/sync.js";

export type TaskRouteDeps = {
  config: Config;
  stores: Stores;
  sync: SyncService;
};

/**
 * Cloud Scheduler から呼ぶ定期処理。`X-Tasks-Secret` ヘッダーが TASKS_SECRET と一致するときだけ受け付ける。
 * - POST /tasks/poll         差分同期（10 分間隔を想定）
 * - POST /tasks/full-resync  全件同期（1 日 1 回を想定。同期範囲の前進と孤児の掃除）
 * - POST /tasks/renew-watch  watch チャネルの登録・更新（1 日 1 回を想定）
 */
export function taskRoutes(deps: TaskRouteDeps) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const secret = deps.config.TASKS_SECRET;
    if (secret && c.req.header("X-Tasks-Secret") !== secret) {
      return c.json({ error: "unauthorized" }, 401);
    }
    if (!secret && deps.config.NODE_ENV === "production") {
      return c.json({ error: "tasks_disabled" }, 503);
    }
    await next();
  });

  app.post("/tasks/poll", async (c) => {
    const summary = await deps.sync.syncAllUsers(false);
    logger.info("定期同期（差分）を実行しました", { ...summary });
    return c.json({ summary });
  });

  app.post("/tasks/full-resync", async (c) => {
    const summary = await deps.sync.syncAllUsers(true);
    logger.info("定期同期（全件）を実行しました", { ...summary });
    return c.json({ summary });
  });

  app.post("/tasks/renew-watch", async (c) => {
    const results: Record<string, unknown> = {};
    for (const uid of await deps.stores.users.listUids()) {
      results[uid] = await deps.sync.ensureWatchChannels(uid);
    }
    logger.info("watch チャネルを更新しました", { results });
    return c.json({ results });
  });

  return app;
}
