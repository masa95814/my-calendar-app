import { Hono } from "hono";

/** Cloud Run の起動確認や監視で使うヘルスチェック。認証不要 */
export const healthRoutes = new Hono().get("/healthz", (c) =>
  c.json({ status: "ok", time: new Date().toISOString() }),
);
