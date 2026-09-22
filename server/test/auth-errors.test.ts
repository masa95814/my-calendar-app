import { describe, expect, it } from "vitest";

import {
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_LIST_SCOPE,
} from "../src/lib/google.js";
import { classifyCallbackError } from "../src/routes/auth.js";
import { buildTestApp, ownerHeaders } from "./helpers.js";

const LINK_SCOPE_STRING = `openid email ${CALENDAR_EVENTS_SCOPE} ${CALENDAR_LIST_SCOPE}`;

describe("classifyCallbackError", () => {
  it("Calendar API が未有効化のメッセージを判別する", () => {
    expect(
      classifyCallbackError(
        new Error(
          "Google Calendar API has not been used in project 123 before or it is disabled. Enable it by visiting ...",
        ),
      ),
    ).toBe("calendar_api_disabled");
  });

  it("OAuth の代表的なエラーを判別する", () => {
    expect(classifyCallbackError(new Error("invalid_grant: Bad Request"))).toBe(
      "invalid_grant",
    );
    expect(classifyCallbackError(new Error("invalid_client"))).toBe(
      "invalid_client",
    );
    expect(classifyCallbackError(new Error("unauthorized_client"))).toBe(
      "invalid_client",
    );
    expect(classifyCallbackError(new Error("redirect_uri_mismatch"))).toBe(
      "redirect_uri_mismatch",
    );
  });

  it("分類できないものは callback_failed", () => {
    expect(classifyCallbackError(new Error("network down"))).toBe(
      "callback_failed",
    );
    expect(classifyCallbackError("string error")).toBe("callback_failed");
  });
});

describe("GET /auth/google/callback のエラーコード", () => {
  async function startLink(h: ReturnType<typeof buildTestApp>) {
    await h.app.request("/api/accounts/link", {
      method: "POST",
      headers: { ...ownerHeaders, "content-type": "application/json" },
      body: JSON.stringify({ returnTo: "mycalendarapp://accounts" }),
    });
    return "state-1";
  }

  it("カレンダー一覧の取得で API 未有効化なら error=calendar_api_disabled で戻す", async () => {
    const h = buildTestApp();
    const state = await startLink(h);
    h.google.codes.set("code-1", {
      idToken: "id-1",
      refreshToken: "refresh-1",
      scope: LINK_SCOPE_STRING,
    });
    h.google.identities.set("id-1", {
      sub: "sub-x",
      email: "x@example.com",
      emailVerified: true,
    });
    h.google.listCalendars = async () => {
      throw new Error(
        "Google Calendar API has not been used in project 1 before or it is disabled.",
      );
    };
    const res = await h.app.request(
      `/auth/google/callback?code=code-1&state=${state}`,
    );
    expect(res.headers.get("location")).toBe(
      "mycalendarapp://accounts?error=calendar_api_disabled",
    );
    expect(h.stores.accounts.data.size).toBe(0);
  });

  it("認可コードの交換で invalid_grant なら error=invalid_grant で戻す", async () => {
    const h = buildTestApp();
    const state = await startLink(h);
    h.google.exchangeCode = async () => {
      throw new Error("invalid_grant");
    };
    const res = await h.app.request(
      `/auth/google/callback?code=code-1&state=${state}`,
    );
    expect(res.headers.get("location")).toBe(
      "mycalendarapp://accounts?error=invalid_grant",
    );
  });
});
