import { describe, expect, it } from "vitest";

import type { SyncRule } from "../src/domain/rules.js";
import type { LinkedAccount } from "../src/repositories/index.js";
import { buildTestApp, ownerHeaders, type TestHarness } from "./helpers.js";

const jsonHeaders = { ...ownerHeaders, "content-type": "application/json" };

function account(
  h: TestHarness,
  overrides: Partial<LinkedAccount> & { id: string; email: string },
): LinkedAccount {
  return {
    hd: undefined,
    type: "personal",
    refreshTokenEnc: h.cipher.encrypt("rt"),
    scopes: [],
    status: "ok",
    calendars: [
      {
        id: "primary",
        summary: overrides.email,
        primary: true,
        accessRole: "owner",
      },
    ],
    linkedAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

/** Workspace の A と B、個人の P を連携済みにする */
async function seedAccounts(h: TestHarness) {
  await h.stores.accounts.upsert(
    "owner-uid",
    account(h, {
      id: "acc-a",
      email: "a@company-a.example",
      hd: "company-a.example",
      type: "workspace",
      calendars: [
        { id: "primary", summary: "a", primary: true, accessRole: "owner" },
        {
          id: "team-cal",
          summary: "チーム",
          primary: false,
          accessRole: "writer",
        },
      ],
    }),
  );
  await h.stores.accounts.upsert(
    "owner-uid",
    account(h, {
      id: "acc-b",
      email: "b@company-b.example",
      hd: "company-b.example",
      type: "workspace",
    }),
  );
  await h.stores.accounts.upsert(
    "owner-uid",
    account(h, { id: "acc-p", email: "me@gmail.com", type: "personal" }),
  );
}

const minimalInput = {
  source: { accountId: "acc-a", calendarIds: ["primary"] },
  target: { accountId: "acc-b" },
  output: { kind: "outOfOffice" },
};

async function createRule(h: TestHarness, body: unknown) {
  const res = await h.app.request("/api/rules", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(body),
  });
  return {
    res,
    body: (await res.json()) as {
      rule?: SyncRule;
      error?: string;
      details?: unknown[];
    },
  };
}

describe("POST /api/rules", () => {
  it("認証が必要", async () => {
    const h = buildTestApp();
    const res = await h.app.request("/api/rules", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("最小限の入力で作成でき、既定値と名前・タイトルが補われる", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const { res, body } = await createRule(h, minimalInput);
    expect(res.status).toBe(201);
    const rule = body.rule!;
    expect(rule.id).toBeTruthy();
    expect(rule.name).toBe("a@company-a.example → b@company-b.example");
    expect(rule.enabled).toBe(true);
    expect(rule.windowDays).toBe(60);
    expect(rule.filters).toEqual({
      minAttendees: null,
      requireMeetLink: false,
      excludeKeywords: [],
      includeKeywords: [],
      alwaysIncludeKeywords: [],
      excludeAllDay: true,
      excludeTransparent: true,
      excludeDeclined: true,
      includeTentative: true,
    });
    expect(rule.output).toEqual({
      kind: "outOfOffice",
      title: "不在",
      copyDescription: false,
      copyLocation: false,
      visibility: "public",
      colorId: null,
      maxDurationMinutes: null,
      maxDurationKeywords: [],
      alternateKindKeywords: [],
      alternateKindTitle: null,
      allDaySourceHandling: "fullDay",
      autoDeclineMode: "declineOnlyNewConflictingInvitations",
      declineMessage: "別件の予定があるため参加できません。",
    });
    // 有効な設定は作成時に初回同期が走る
    expect(new Date(rule.lastSyncAt ?? "")).toEqual(h.clock.now);
    expect(rule.lastError).toBeNull();
    expect(new Date(rule.createdAt)).toEqual(h.clock.now);
  });

  it("「予定あり」のタイトル既定値は「予定あり」", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const { body } = await createRule(h, {
      ...minimalInput,
      target: { accountId: "acc-p" },
      output: { kind: "busy" },
    });
    expect(body.rule?.output.title).toBe("予定あり");
  });

  it("形式が不正なら 400 と項目ごとの詳細", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const { res, body } = await createRule(h, {
      ...minimalInput,
      windowDays: 0,
      output: { kind: "nope" },
    });
    expect(res.status).toBe(400);
    expect(body.error).toBe("validation_error");
    const paths = (body.details as { path: string }[]).map((d) => d.path);
    expect(paths).toContain("windowDays");
    expect(paths).toContain("output.kind");
  });

  it("連携していないアカウントや同一アカウントは 400", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const { res, body } = await createRule(h, {
      ...minimalInput,
      source: { accountId: "acc-a", calendarIds: ["primary"] },
      target: { accountId: "acc-a" },
    });
    expect(res.status).toBe(400);
    const codes = (body.details as { code: string }[]).map((d) => d.code);
    expect(codes).toContain("same_account");

    const missing = await createRule(h, {
      ...minimalInput,
      target: { accountId: "acc-zzz" },
    });
    expect(missing.res.status).toBe(400);
    expect(
      (missing.body.details as { code: string }[]).map((d) => d.code),
    ).toContain("target_account_not_found");
  });

  it("送信元に存在しないカレンダーは 400", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const { res, body } = await createRule(h, {
      ...minimalInput,
      source: { accountId: "acc-a", calendarIds: ["primary", "ghost"] },
    });
    expect(res.status).toBe(400);
    expect((body.details as { code: string }[])[0]?.code).toBe(
      "unknown_source_calendar",
    );
  });

  it("個人アカウント宛ての「不在」は 400", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const { res, body } = await createRule(h, {
      ...minimalInput,
      target: { accountId: "acc-p" },
      output: { kind: "outOfOffice" },
    });
    expect(res.status).toBe(400);
    expect((body.details as { code: string }[])[0]?.code).toBe(
      "out_of_office_not_available_for_personal",
    );
  });

  it("個人アカウント宛てでは、種別を切り替えるキーワードは 400（不在を作れないため）", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const { res, body } = await createRule(h, {
      ...minimalInput,
      target: { accountId: "acc-p" },
      output: { kind: "busy", alternateKindKeywords: ["外出"] },
    });
    expect(res.status).toBe(400);
    expect((body.details as { code: string }[])[0]?.code).toBe(
      "alternate_kind_not_available_for_personal",
    );
  });

  it("同じ送信元と同期先の組み合わせは 409。逆方向は別設定として作れる", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const first = await createRule(h, minimalInput);
    expect(first.res.status).toBe(201);

    const dup = await createRule(h, { ...minimalInput, name: "別名" });
    expect(dup.res.status).toBe(409);
    expect(dup.body.error).toBe("duplicate_rule");
    expect((dup.body as { existingRuleId?: string }).existingRuleId).toBe(
      first.body.rule?.id,
    );

    const reverse = await createRule(h, {
      source: { accountId: "acc-b", calendarIds: ["primary"] },
      target: { accountId: "acc-a" },
      output: { kind: "busy", title: "予定あり（B）" },
      filters: { requireMeetLink: true, excludeKeywords: ["仮"] },
    });
    expect(reverse.res.status).toBe(201);
    expect(reverse.body.rule?.output.kind).toBe("busy");
    expect(reverse.body.rule?.filters.requireMeetLink).toBe(true);
    expect(reverse.body.rule?.filters.excludeKeywords).toEqual(["仮"]);
  });
});

describe("GET / PUT / DELETE /api/rules", () => {
  it("一覧は作成順、他人の設定は含まない", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const a = await createRule(h, minimalInput);
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    const b = await createRule(h, {
      source: { accountId: "acc-b", calendarIds: ["primary"] },
      target: { accountId: "acc-a" },
      output: { kind: "busy" },
    });
    await h.stores.rules.create("someone-else", {
      ...a.body.rule!,
      id: "other",
    });

    const res = await h.app.request("/api/rules", { headers: ownerHeaders });
    const body = (await res.json()) as { rules: SyncRule[] };
    expect(body.rules.map((r) => r.id)).toEqual([
      a.body.rule!.id,
      b.body.rule!.id,
    ]);
  });

  it("取得: 無ければ 404", async () => {
    const h = buildTestApp();
    const res = await h.app.request("/api/rules/nope", {
      headers: ownerHeaders,
    });
    expect(res.status).toBe(404);
  });

  it("更新は全体置換で、作成日時と同期状態は保つ。同一組み合わせの自分自身は重複扱いしない", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const created = (await createRule(h, minimalInput)).body.rule!;
    await h.stores.rules.update("owner-uid", {
      ...created,
      createdAt: new Date(created.createdAt),
      updatedAt: new Date(created.updatedAt),
      lastSyncAt: new Date("2026-09-10T00:00:00Z"),
      lastError: "前回のエラー",
    });
    h.clock.now = new Date("2026-09-24T00:00:00Z");

    const res = await h.app.request(`/api/rules/${created.id}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({
        ...minimalInput,
        name: "会社A → 会社B",
        enabled: false,
        windowDays: 90,
        source: { accountId: "acc-a", calendarIds: ["primary", "team-cal"] },
        filters: { minAttendees: 2 },
        output: { kind: "outOfOffice", autoDeclineMode: "declineNone" },
      }),
    });
    expect(res.status).toBe(200);
    const { rule } = (await res.json()) as { rule: SyncRule };
    expect(rule.id).toBe(created.id);
    expect(rule.name).toBe("会社A → 会社B");
    expect(rule.enabled).toBe(false);
    expect(rule.windowDays).toBe(90);
    expect(rule.source.calendarIds).toEqual(["primary", "team-cal"]);
    expect(rule.filters.minAttendees).toBe(2);
    expect(rule.output.autoDeclineMode).toBe("declineNone");
    expect(rule.output.title).toBe("不在");
    expect(new Date(rule.createdAt)).toEqual(new Date(created.createdAt));
    expect(new Date(rule.updatedAt)).toEqual(h.clock.now);
    expect(rule.lastSyncAt).toBe("2026-09-10T00:00:00.000Z");
    expect(rule.lastError).toBe("前回のエラー");
  });

  it("更新で別の設定と同じ組み合わせにすると 409", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    await createRule(h, minimalInput);
    const other = (
      await createRule(h, {
        source: { accountId: "acc-b", calendarIds: ["primary"] },
        target: { accountId: "acc-a" },
        output: { kind: "busy" },
      })
    ).body.rule!;
    const res = await h.app.request(`/api/rules/${other.id}`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify(minimalInput),
    });
    expect(res.status).toBe(409);
  });

  it("削除: 204、その後は 404", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const created = (await createRule(h, minimalInput)).body.rule!;
    const del = await h.app.request(`/api/rules/${created.id}`, {
      method: "DELETE",
      headers: ownerHeaders,
    });
    expect(del.status).toBe(204);
    const get = await h.app.request(`/api/rules/${created.id}`, {
      headers: ownerHeaders,
    });
    expect(get.status).toBe(404);
  });
});

describe("アカウント連携解除との連動", () => {
  it("解除したアカウントを使う同期設定は無効化される（削除はされない）", async () => {
    const h = buildTestApp();
    await seedAccounts(h);
    const ab = (await createRule(h, minimalInput)).body.rule!;
    const bp = (
      await createRule(h, {
        source: { accountId: "acc-b", calendarIds: ["primary"] },
        target: { accountId: "acc-p" },
        output: { kind: "busy" },
      })
    ).body.rule!;
    const pa = (
      await createRule(h, {
        source: { accountId: "acc-p", calendarIds: ["primary"] },
        target: { accountId: "acc-a" },
        output: { kind: "outOfOffice" },
      })
    ).body.rule!;

    const res = await h.app.request("/api/accounts/acc-b", {
      method: "DELETE",
      headers: ownerHeaders,
    });
    expect(res.status).toBe(204);

    expect((await h.stores.rules.get("owner-uid", ab.id))?.enabled).toBe(false);
    expect((await h.stores.rules.get("owner-uid", bp.id))?.enabled).toBe(false);
    expect((await h.stores.rules.get("owner-uid", pa.id))?.enabled).toBe(true);
  });
});
