// 連携アカウントの色分け。連携順に割り当てる

export const ACCOUNT_COLORS = [
  "#007AFF",
  "#34C759",
  "#FF9500",
  "#AF52DE",
  "#FF2D55",
  "#5AC8FA",
  "#A2845E",
  "#FFCC00",
] as const;

export function colorForIndex(index: number): string {
  return ACCOUNT_COLORS[index % ACCOUNT_COLORS.length] ?? ACCOUNT_COLORS[0];
}

/** アカウント ID → 色 の対応を作る */
export function buildAccountColors(
  accountIds: readonly string[],
): Map<string, string> {
  return new Map(accountIds.map((id, index) => [id, colorForIndex(index)]));
}
