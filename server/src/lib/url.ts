/**
 * OAuth 完了後にアプリへ戻る URL を検証する。
 * 許可された先頭文字列に一致し、URL として解釈できる場合だけその URL を返す。
 * （任意の URL へリダイレクトできるとフィッシングに使われるため）
 */
export function validateReturnUrl(
  candidate: string | undefined,
  allowedPrefixes: readonly string[],
): string | undefined {
  if (!candidate) {
    return undefined;
  }
  if (!allowedPrefixes.some((prefix) => candidate.startsWith(prefix))) {
    return undefined;
  }
  try {
    // `exp://` のようにホストが無い URL はアプリに戻れないので弾く
    if (!new URL(candidate).host) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return candidate;
}

/** URL にクエリパラメータを追加する。`exp://` や `mycalendarapp://` のような独自スキームにも対応する */
export function appendQuery(
  url: string,
  params: Record<string, string>,
): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}
