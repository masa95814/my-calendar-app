import { describe, expect, it } from "vitest";

import { appendQuery, validateReturnUrl } from "../src/lib/url.js";

const prefixes = ["mycalendarapp://", "exp://", "http://localhost"];

describe("validateReturnUrl", () => {
  it("許可された先頭文字列の URL だけ通す", () => {
    expect(validateReturnUrl("mycalendarapp://auth", prefixes)).toBe(
      "mycalendarapp://auth",
    );
    expect(validateReturnUrl("exp://192.168.1.5:8081/--/auth", prefixes)).toBe(
      "exp://192.168.1.5:8081/--/auth",
    );
    expect(validateReturnUrl("http://localhost:8081/auth", prefixes)).toBe(
      "http://localhost:8081/auth",
    );
  });

  it("許可されていない URL や壊れた値は弾く", () => {
    expect(validateReturnUrl(undefined, prefixes)).toBeUndefined();
    expect(validateReturnUrl("", prefixes)).toBeUndefined();
    expect(
      validateReturnUrl("https://evil.example/", prefixes),
    ).toBeUndefined();
    expect(validateReturnUrl("mycalendarapp:", prefixes)).toBeUndefined();
    expect(validateReturnUrl("exp://", prefixes)).toBeUndefined();
  });
});

describe("appendQuery", () => {
  it("独自スキームの URL にクエリを付けられる", () => {
    expect(appendQuery("mycalendarapp://auth", { token: "abc" })).toBe(
      "mycalendarapp://auth?token=abc",
    );
    expect(
      appendQuery("exp://192.168.1.5:8081/--/auth", { linked: "a@b.com" }),
    ).toBe("exp://192.168.1.5:8081/--/auth?linked=a%40b.com");
  });

  it("既存のクエリは保持し、同名は上書きする", () => {
    expect(
      appendQuery("http://localhost:8081/auth?x=1&error=old", {
        error: "new",
      }),
    ).toBe("http://localhost:8081/auth?x=1&error=new");
  });
});
