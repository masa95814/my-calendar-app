import { Hono } from "hono";
import { z } from "zod";

import { logger } from "../lib/logger.js";
import type { Notify } from "../lib/slack.js";
import type { Stores } from "../repositories/index.js";

/** Pub/Sub の push に付く ID トークンを確かめ、正当なら送信元のサービスアカウントのメールを返す */
export type VerifyPushToken = (idToken: string) => Promise<string | undefined>;

export type BudgetRouteDeps = {
  stores: Stores;
  notify?: Notify;
  /** 未設定なら予算アラートの受け口は無効（404） */
  verifyPushToken?: VerifyPushToken;
};

// Cloud Billing の予算が Pub/Sub に送るメッセージ（message.data を base64 デコードした JSON）
const budgetMessageSchema = z.object({
  budgetDisplayName: z.string().default("予算"),
  /** 超えたしきい値（0.5 = 50%）。しきい値を超えていない定期のメッセージには無い */
  alertThresholdExceeded: z.number().optional(),
  costAmount: z.number(),
  budgetAmount: z.number(),
  currencyCode: z.string().default("JPY"),
  /** 集計期間の始まり（月初）。期間ごとに知らせたしきい値を覚える */
  costIntervalStart: z.string(),
});

const pushSchema = z.object({
  message: z.object({
    data: z.string(),
    attributes: z.record(z.string()).optional(),
  }),
});

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "JPY" ? 0 : 2,
  }).format(amount);
}

/**
 * 予算アラートの受け口（Cloud Billing の予算 → Pub/Sub → push）。
 * 予算のメッセージはしきい値を超えていなくても 1 日に何度も届くため、
 * 期間ごとにまだ知らせていないしきい値を超えたときだけ Slack に知らせる。
 * Pub/Sub は 2xx 以外だと再送し続けるため、認証以外の失敗も 204 で受け取って終わりにする。
 */
export function budgetRoutes(deps: BudgetRouteDeps) {
  const app = new Hono();

  app.post("/webhooks/budget", async (c) => {
    if (!deps.verifyPushToken) {
      return c.json({ error: "not_found" }, 404);
    }
    const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
    const sender = token ? await deps.verifyPushToken(token) : undefined;
    if (!sender) {
      logger.warn("予算アラートの push の認証に失敗しました");
      return c.json({ error: "unauthorized" }, 401);
    }

    const push = pushSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!push.success) {
      logger.warn("予算アラートの push の形式が不正です");
      return c.body(null, 204);
    }
    let decoded: unknown;
    try {
      decoded = JSON.parse(
        Buffer.from(push.data.message.data, "base64").toString("utf8"),
      );
    } catch {
      logger.warn("予算アラートのメッセージを読めませんでした");
      return c.body(null, 204);
    }
    const message = budgetMessageSchema.safeParse(decoded);
    if (!message.success) {
      logger.warn("予算アラートのメッセージの形式が不正です");
      return c.body(null, 204);
    }
    const m = message.data;
    if (m.alertThresholdExceeded === undefined) {
      return c.body(null, 204);
    }

    const budgetId = push.data.message.attributes?.budgetId ?? "budget";
    const key = `${budgetId}_${m.costIntervalStart}`.replace(/[^\w.-]/g, "_");
    const notified = await deps.stores.budgetAlerts.getNotifiedThreshold(key);
    if (notified !== undefined && notified >= m.alertThresholdExceeded) {
      return c.body(null, 204);
    }
    await deps.stores.budgetAlerts.setNotifiedThreshold(
      key,
      m.alertThresholdExceeded,
    );
    const percent = Math.round(m.alertThresholdExceeded * 100);
    logger.info("予算アラートを通知します", { key, percent });
    await deps.notify?.(
      `💰 請求額が予算の ${percent}% を超えました（${m.budgetDisplayName}）\n` +
        `今月: ${formatMoney(m.costAmount, m.currencyCode)} / 予算: ${formatMoney(m.budgetAmount, m.currencyCode)}`,
      // 予算を使い切ったときだけメンションする
      { urgent: m.alertThresholdExceeded >= 1 },
    );
    return c.body(null, 204);
  });

  return app;
}
