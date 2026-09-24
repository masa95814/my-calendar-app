import type { LinkedAccount } from "./api";

/**
 * 画面に出すアカウントの名前。呼び名（例: メイン、ギブリー）があればそれを、
 * 無ければ Workspace のドメインか、メールアドレスのローカル部（@ の前）を使う
 */
export function accountName(
  account: Pick<LinkedAccount, "label" | "hd" | "email">,
): string {
  return (
    account.label || account.hd || account.email.split("@")[0] || account.email
  );
}
