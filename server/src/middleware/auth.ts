import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

export type AuthUser = {
  uid: string;
  email: string;
};

/** 認証済みルートで `c.get("user")` を型付きで使うための Hono 環境型 */
export type AuthEnv = {
  Variables: {
    user: AuthUser;
  };
};

/** Firebase ID トークンを検証して uid とメールアドレスを返す関数（テストで差し替えられるようにする） */
export type VerifyIdToken = (
  token: string,
) => Promise<{ uid: string; email?: string | undefined }>;

type RequireOwnerOptions = {
  ownerEmails: readonly string[];
  verifyIdToken: VerifyIdToken;
};

/**
 * `Authorization: Bearer <Firebase ID トークン>` を検証し、
 * OWNER_EMAILS に含まれるメールアドレスのユーザーだけを通す。
 * 個人利用のアプリなので、許可された本人以外は 403 にする。
 */
export function requireOwner(
  options: RequireOwnerOptions,
): MiddlewareHandler<AuthEnv> {
  const ownerEmails = new Set(
    options.ownerEmails.map((email) => email.toLowerCase()),
  );

  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      throw new HTTPException(401, { message: "認証が必要です" });
    }

    let decoded: Awaited<ReturnType<VerifyIdToken>>;
    try {
      decoded = await options.verifyIdToken(token);
    } catch {
      throw new HTTPException(401, { message: "トークンが無効です" });
    }

    const email = decoded.email?.toLowerCase();
    if (!email || !ownerEmails.has(email)) {
      throw new HTTPException(403, {
        message: "このアプリを利用する権限がありません",
      });
    }

    c.set("user", { uid: decoded.uid, email });
    await next();
  };
}
