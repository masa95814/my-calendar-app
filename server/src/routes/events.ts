import { Hono } from "hono";

import type { AuthEnv } from "../middleware/auth.js";
import { toPublicAccount, type Stores } from "../repositories/index.js";
import type { SyncService } from "../services/sync.js";

export type EventRouteDeps = {
  stores: Stores;
  sync: SyncService;
  now: () => Date;
};

/** 統合カレンダー表示で一度に取得できる最大日数 */
const MAX_RANGE_DAYS = 62;

/**
 * 表示用の API（すべて認証必須。/api 配下にマウントする）
 * - GET /events?from=&to=  全連携アカウントのメインカレンダーの予定（ミラーには印付き）
 * - GET /status            連携アカウント・同期設定・同期状態のまとめ
 */
export function eventRoutes(deps: EventRouteDeps) {
  const app = new Hono<AuthEnv>();

  app.get("/events", async (c) => {
    const from = parseDate(c.req.query("from"));
    const to = parseDate(c.req.query("to"));
    if (!from || !to || to.getTime() <= from.getTime()) {
      return c.json(
        {
          error: "invalid_range",
          message: "from と to を ISO 8601 で指定してください",
        },
        400,
      );
    }
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
      return c.json(
        {
          error: "range_too_wide",
          message: `期間は ${MAX_RANGE_DAYS} 日以内にしてください`,
        },
        400,
      );
    }
    const result = await deps.sync.listUnifiedEvents(
      c.get("user").uid,
      from,
      to,
    );
    return c.json(result);
  });

  app.get("/status", async (c) => {
    const uid = c.get("user").uid;
    const [accounts, rules, syncStates] = await Promise.all([
      deps.stores.accounts.list(uid),
      deps.stores.rules.list(uid),
      deps.stores.syncStates.list(uid),
    ]);
    return c.json({
      now: deps.now().toISOString(),
      accounts: accounts.map((a) => {
        const { calendars: _omit, ...rest } = toPublicAccount(a);
        return { ...rest, calendarCount: a.calendars.length };
      }),
      rules: rules.map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        sourceAccountId: r.source.accountId,
        targetAccountId: r.target.accountId,
        lastSyncAt: r.lastSyncAt,
        lastError: r.lastError,
      })),
      syncStates: syncStates.map((s) => ({
        accountId: s.accountId,
        calendarId: s.calendarId,
        lastFullSyncAt: s.lastFullSyncAt,
        lastIncrementalSyncAt: s.lastIncrementalSyncAt,
        watchActive: Boolean(
          s.channelId &&
            s.channelExpiresAt &&
            s.channelExpiresAt.getTime() > deps.now().getTime(),
        ),
        channelExpiresAt: s.channelExpiresAt,
      })),
    });
  });

  return app;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
