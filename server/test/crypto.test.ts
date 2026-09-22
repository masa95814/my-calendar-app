import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createTokenCipher } from "../src/lib/crypto.js";

const key = randomBytes(32).toString("base64");

describe("createTokenCipher", () => {
  it("暗号化した値を復号すると元に戻る", () => {
    const cipher = createTokenCipher(key);
    const stored = cipher.encrypt("refresh-token-1");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("refresh-token-1");
    expect(cipher.decrypt(stored)).toBe("refresh-token-1");
  });

  it("同じ平文でも毎回違う暗号文になる（IV がランダム）", () => {
    const cipher = createTokenCipher(key);
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  it("改ざんされた値は復号できない", () => {
    const cipher = createTokenCipher(key);
    const stored = cipher.encrypt("secret");
    const tampered =
      stored.slice(0, -2) + (stored.endsWith("A=") ? "B=" : "A=");
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it("別の鍵では復号できない", () => {
    const stored = createTokenCipher(key).encrypt("secret");
    const other = createTokenCipher(randomBytes(32).toString("base64"));
    expect(() => other.decrypt(stored)).toThrow();
  });

  it("鍵の長さが 32 バイトでなければ作れない", () => {
    expect(() => createTokenCipher(randomBytes(16).toString("base64"))).toThrow(
      /32/,
    );
  });

  it("鍵が無い場合は plain: を付けた平文として扱う", () => {
    const cipher = createTokenCipher();
    expect(cipher.encrypt("abc")).toBe("plain:abc");
    expect(cipher.decrypt("plain:abc")).toBe("abc");
    expect(() => cipher.decrypt("v1:x:y:z")).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });

  it("鍵を後から設定しても平文保存の値は読める", () => {
    expect(createTokenCipher(key).decrypt("plain:legacy")).toBe("legacy");
  });
});
