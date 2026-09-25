import { logger } from "./logger.js";

/** 運用上の通知（同期エラーなど）を送る。失敗しても例外は投げない */
export type Notify = (text: string) => Promise<void>;

/** Slack の Incoming Webhook に送る通知 */
export function createSlackNotifier(
  webhookUrl: string,
  fetchImpl: typeof fetch = fetch,
): Notify {
  return async (text) => {
    try {
      const res = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        logger.warn("Slack への通知に失敗しました", { status: res.status });
      }
    } catch (error) {
      logger.warn("Slack への通知に失敗しました", { error: String(error) });
    }
  };
}
