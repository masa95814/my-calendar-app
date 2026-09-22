import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("既定値が入る", () => {
    const config = loadConfig({});
    expect(config.NODE_ENV).toBe("development");
    expect(config.PORT).toBe(8080);
    expect(config.OWNER_EMAILS).toEqual([]);
    expect(config.APP_DEEP_LINK).toBe("mycalendarapp://linked");
  });

  it("OWNER_EMAILS はカンマ区切りを配列にし、空白除去と小文字化をする", () => {
    const config = loadConfig({
      OWNER_EMAILS: " A@Example.com, b@example.com ,, ",
    });
    expect(config.OWNER_EMAILS).toEqual(["a@example.com", "b@example.com"]);
  });

  it("PORT は数値に変換する", () => {
    expect(loadConfig({ PORT: "3000" }).PORT).toBe(3000);
  });

  it("不正な値は理由付きで例外にする", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ OAUTH_REDIRECT_URI: "not-a-url" })).toThrow(
      /OAUTH_REDIRECT_URI/,
    );
  });
});
