import { randomUUID } from "node:crypto";
import { Hono } from "hono";

import {
  buildRule,
  ruleInputSchema,
  validateRuleAgainstAccounts,
} from "../domain/rules.js";
import { logger } from "../lib/logger.js";
import type { AuthEnv } from "../middleware/auth.js";
import type { Stores } from "../repositories/index.js";

export type RuleRouteDeps = {
  stores: Stores;
  now: () => Date;
};

/**
 * 同期設定の API（すべて認証必須。/api 配下にマウントする）
 * - GET    /rules       一覧
 * - POST   /rules       作成
 * - GET    /rules/:id   取得
 * - PUT    /rules/:id   更新（全体置換）
 * - DELETE /rules/:id   削除
 */
export function ruleRoutes(deps: RuleRouteDeps) {
  const app = new Hono<AuthEnv>();

  app.get("/rules", async (c) => {
    const rules = await deps.stores.rules.list(c.get("user").uid);
    return c.json({ rules });
  });

  app.get("/rules/:id", async (c) => {
    const rule = await deps.stores.rules.get(
      c.get("user").uid,
      c.req.param("id"),
    );
    return rule ? c.json({ rule }) : c.json({ error: "not_found" }, 404);
  });

  app.post("/rules", async (c) => {
    const uid = c.get("user").uid;
    const parsed = ruleInputSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return c.json(
        { error: "validation_error", details: formatZodIssues(parsed.error) },
        400,
      );
    }
    const accounts = await deps.stores.accounts.list(uid);
    const errors = validateRuleAgainstAccounts(parsed.data, accounts);
    if (errors.length > 0) {
      return c.json({ error: "validation_error", details: errors }, 400);
    }
    const duplicate = await deps.stores.rules.findBySourceTarget(
      uid,
      parsed.data.source.accountId,
      parsed.data.target.accountId,
    );
    if (duplicate) {
      return c.json(
        {
          error: "duplicate_rule",
          details: [
            {
              code: "duplicate_rule",
              message:
                "同じ送信元と同期先の組み合わせの同期設定がすでにあります",
            },
          ],
          existingRuleId: duplicate.id,
        },
        409,
      );
    }
    const now = deps.now();
    const rule = buildRule(
      parsed.data,
      accounts,
      { id: randomUUID(), createdAt: now, lastSyncAt: null, lastError: null },
      now,
    );
    await deps.stores.rules.create(uid, rule);
    logger.info("同期設定を作成しました", { uid, ruleId: rule.id });
    return c.json({ rule }, 201);
  });

  app.put("/rules/:id", async (c) => {
    const uid = c.get("user").uid;
    const ruleId = c.req.param("id");
    const existing = await deps.stores.rules.get(uid, ruleId);
    if (!existing) {
      return c.json({ error: "not_found" }, 404);
    }
    const parsed = ruleInputSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) {
      return c.json(
        { error: "validation_error", details: formatZodIssues(parsed.error) },
        400,
      );
    }
    const accounts = await deps.stores.accounts.list(uid);
    const errors = validateRuleAgainstAccounts(parsed.data, accounts);
    if (errors.length > 0) {
      return c.json({ error: "validation_error", details: errors }, 400);
    }
    const duplicate = await deps.stores.rules.findBySourceTarget(
      uid,
      parsed.data.source.accountId,
      parsed.data.target.accountId,
    );
    if (duplicate && duplicate.id !== ruleId) {
      return c.json(
        {
          error: "duplicate_rule",
          details: [
            {
              code: "duplicate_rule",
              message:
                "同じ送信元と同期先の組み合わせの同期設定がすでにあります",
            },
          ],
          existingRuleId: duplicate.id,
        },
        409,
      );
    }
    const rule = buildRule(parsed.data, accounts, existing, deps.now());
    await deps.stores.rules.update(uid, rule);
    logger.info("同期設定を更新しました", { uid, ruleId });
    return c.json({ rule });
  });

  app.delete("/rules/:id", async (c) => {
    const uid = c.get("user").uid;
    const ruleId = c.req.param("id");
    const existing = await deps.stores.rules.get(uid, ruleId);
    if (!existing) {
      return c.json({ error: "not_found" }, 404);
    }
    // TODO(フェーズ 3): この同期設定が作成したミラー予定の削除
    await deps.stores.rules.delete(uid, ruleId);
    logger.info("同期設定を削除しました", { uid, ruleId });
    return c.body(null, 204);
  });

  return app;
}

function formatZodIssues(error: {
  issues: { path: (string | number)[]; message: string }[];
}) {
  return error.issues.map((issue) => ({
    code: "invalid_field",
    path: issue.path.join("."),
    message: issue.message,
  }));
}
