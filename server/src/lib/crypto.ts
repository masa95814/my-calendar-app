import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** リフレッシュトークンなどの機密文字列を保存用に暗号化・復号する */
export type TokenCipher = {
  encrypt(plainText: string): string;
  decrypt(storedValue: string): string;
};

const PLAIN_PREFIX = "plain:";
const V1_PREFIX = "v1:";

/**
 * AES-256-GCM のトークン暗号化を作る。
 * 鍵が未指定の場合は `plain:` を付けて平文のまま扱う（開発用。本番では config 側で鍵を必須にしている）。
 * 保存形式: `v1:<iv base64>:<authTag base64>:<暗号文 base64>`
 */
export function createTokenCipher(base64Key?: string): TokenCipher {
  if (!base64Key) {
    return {
      encrypt: (plainText) => `${PLAIN_PREFIX}${plainText}`,
      decrypt: (storedValue) => decryptPlain(storedValue),
    };
  }

  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY は base64 エンコードした 32 バイトの鍵にしてください（openssl rand -base64 32）",
    );
  }

  return {
    encrypt(plainText) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(plainText, "utf8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();
      return [
        V1_PREFIX.slice(0, -1),
        iv.toString("base64"),
        authTag.toString("base64"),
        encrypted.toString("base64"),
      ].join(":");
    },
    decrypt(storedValue) {
      // 鍵を後から設定した場合でも、平文で保存済みの値は読めるようにする
      if (storedValue.startsWith(PLAIN_PREFIX)) {
        return decryptPlain(storedValue);
      }
      const [version, ivBase64, authTagBase64, dataBase64] =
        storedValue.split(":");
      if (version !== "v1" || !ivBase64 || !authTagBase64 || !dataBase64) {
        throw new Error("暗号化されたトークンの形式が不正です");
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivBase64, "base64"),
      );
      decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(dataBase64, "base64")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

function decryptPlain(storedValue: string): string {
  if (!storedValue.startsWith(PLAIN_PREFIX)) {
    throw new Error(
      "暗号化されたトークンですが TOKEN_ENCRYPTION_KEY が設定されていません",
    );
  }
  return storedValue.slice(PLAIN_PREFIX.length);
}
