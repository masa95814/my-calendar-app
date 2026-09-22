import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { baseEnv } from "./helpers.js";

describe("loadConfig", () => {
  it("既定値が入る", () => {
    const config = loadConfig({ ...baseEnv, OWNER_EMAILS: undefined });
    expect(config.NODE_ENV).toBe("test");
    expect(config.PORT).toBe(8080);
    expect(config.OWNER_EMAILS).toEqual([]);
    expect(config.OAUTH_STATE_TTL_SECONDS).toBe(600);
  });

  it("OWNER_EMAILS はカンマ区切りを配列にし、空白除去と小文字化をする", () => {
    const config = loadConfig({
      ...baseEnv,
      OWNER_EMAILS: " A@Example.com, b@example.com ,, ",
    });
    expect(config.OWNER_EMAILS).toEqual(["a@example.com", "b@example.com"]);
  });

  it("APP_RETURN_URL_PREFIXES は既定で開発ビルド・Expo Go・Web を許可する", () => {
    const config = loadConfig({
      ...baseEnv,
      APP_RETURN_URL_PREFIXES: undefined,
    });
    expect(config.APP_RETURN_URL_PREFIXES).toEqual([
      "mycalendarapp://",
      "exp://",
      "http://localhost",
    ]);
  });

  it("PORT は数値に変換する", () => {
    expect(loadConfig({ ...baseEnv, PORT: "3000" }).PORT).toBe(3000);
  });

  it("OAuth の設定が無ければ起動できない", () => {
    expect(() =>
      loadConfig({ ...baseEnv, GOOGLE_OAUTH_CLIENT_ID: undefined }),
    ).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });

  it("本番では TOKEN_ENCRYPTION_KEY が必須", () => {
    expect(() => loadConfig({ ...baseEnv, NODE_ENV: "production" })).toThrow(
      /TOKEN_ENCRYPTION_KEY/,
    );
    expect(
      loadConfig({
        ...baseEnv,
        NODE_ENV: "production",
        TOKEN_ENCRYPTION_KEY: "x",
      }).TOKEN_ENCRYPTION_KEY,
    ).toBe("x");
  });

  it("不正な値は理由付きで例外にする", () => {
    expect(() => loadConfig({ ...baseEnv, PORT: "abc" })).toThrow(/PORT/);
    expect(() =>
      loadConfig({ ...baseEnv, OAUTH_REDIRECT_URI: "not-a-url" }),
    ).toThrow(/OAUTH_REDIRECT_URI/);
  });
});
