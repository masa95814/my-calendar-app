import { describe, expect, it } from "vitest";

import { buildTestApp } from "./helpers.js";

const PUSH_SA = "budget-push@example.iam.gserviceaccount.com";

function buildBudgetApp() {
  return buildTestApp({
    // "good" だけを正当な ID トークンとみなす
    verifyPushToken: async (token) => (token === "good" ? PUSH_SA : undefined),
  });
}

function push(
  h: ReturnType<typeof buildTestApp>,
  message: Record<string, unknown>,
  token = "good",
) {
  return h.app.request("/webhooks/budget", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message: {
        data: Buffer.from(JSON.stringify(message)).toString("base64"),
        attributes: { budgetId: "budget-1", billingAccountId: "000000" },
      },
    }),
  });
}

const base = {
  budgetDisplayName: "カレンダー連携",
  costAmount: 260,
  budgetAmount: 500,
  currencyCode: "JPY",
  costIntervalStart: "2026-09-01T07:00:00Z",
};

describe("POST /webhooks/budget", () => {
  it("しきい値を超えたら Slack に知らせ、同じしきい値は繰り返さない", async () => {
    const h = buildBudgetApp();
    expect(
      (await push(h, { ...base, alertThresholdExceeded: 0.5 })).status,
    ).toBe(204);
    expect(h.notifications).toEqual([
      "💰 請求額が予算の 50% を超えました（カレンダー連携）\n今月: ￥260 / 予算: ￥500",
    ]);
    expect(h.urgentFlags).toEqual([false]);

    // 同じしきい値の再送・しきい値なしの定期メッセージでは知らせない
    await push(h, { ...base, alertThresholdExceeded: 0.5, costAmount: 270 });
    await push(h, { ...base, costAmount: 280 });
    expect(h.notifications).toHaveLength(1);

    // 次のしきい値を超えたら知らせ、100% はメンションを付ける
    await push(h, { ...base, alertThresholdExceeded: 0.9, costAmount: 460 });
    await push(h, { ...base, alertThresholdExceeded: 1, costAmount: 510 });
    expect(h.notifications).toHaveLength(3);
    expect(h.notifications[2]).toContain("100% を超えました");
    expect(h.urgentFlags).toEqual([false, false, true]);
  });

  it("翌月は同じしきい値でも改めて知らせる", async () => {
    const h = buildBudgetApp();
    await push(h, { ...base, alertThresholdExceeded: 0.5 });
    await push(h, {
      ...base,
      alertThresholdExceeded: 0.5,
      costIntervalStart: "2026-10-01T07:00:00Z",
    });
    expect(h.notifications).toHaveLength(2);
  });

  it("ID トークンが無い・不正なら 401 で、知らせない", async () => {
    const h = buildBudgetApp();
    expect(
      (await push(h, { ...base, alertThresholdExceeded: 1 }, "bad")).status,
    ).toBe(401);
    const res = await h.app.request("/webhooks/budget", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(h.notifications).toHaveLength(0);
  });

  it("形式が不正なメッセージは再送させないよう 204 で受け取って捨てる", async () => {
    const h = buildBudgetApp();
    const res = await h.app.request("/webhooks/budget", {
      method: "POST",
      headers: {
        authorization: "Bearer good",
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: { data: "not-json" } }),
    });
    expect(res.status).toBe(204);
    expect(h.notifications).toHaveLength(0);
  });

  it("検証の設定が無ければ受け口は無効（404）", async () => {
    const h = buildTestApp();
    expect((await push(h, { ...base, alertThresholdExceeded: 1 })).status).toBe(
      404,
    );
  });
});
