import { Hono } from "hono";

const ok = () => ({ status: "ok", time: new Date().toISOString() });

/**
 * 起動確認や監視で使うヘルスチェック。認証不要。
 * Cloud Run は末尾が z のパス（/healthz など）を予約していてアプリに届かないため、/health を正とする。
 * /healthz はローカル開発との互換のために残す。
 */
export const healthRoutes = new Hono()
  .get("/health", (c) => c.json(ok()))
  .get("/healthz", (c) => c.json(ok()));
