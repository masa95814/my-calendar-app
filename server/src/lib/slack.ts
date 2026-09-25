import { logger } from "./logger.js";

export type NotifyOptions = {
  /** 対応が必要な通知。メンション先が設定されていればメンションを付ける */
  urgent?: boolean;
};

/** 運用上の通知（同期エラーなど）を送る。失敗しても例外は投げない */
export type Notify = (text: string, options?: NotifyOptions) => Promise<void>;

/** Slack の Incoming Webhook に送る通知 */
export function createSlackNotifier(
  webhookUrl: string,
  options: {
    /** urgent の通知でメンションする Slack のメンバー ID（例: U01ABCDEF） */
    mentionUserId?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Notify {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (text, notifyOptions = {}) => {
    const body =
      notifyOptions.urgent && options.mentionUserId
        ? `<@${options.mentionUserId}> ${text}`
        : text;
    try {
      const res = await fetchImpl(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: body }),
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
