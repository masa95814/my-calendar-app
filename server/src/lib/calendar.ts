import { calendar, type calendar_v3 } from "@googleapis/calendar";
import { OAuth2Client } from "google-auth-library";

// Google Calendar API の薄いラッパー。同期エンジンが必要とする操作だけを持つ。
// テストでは偽物（test/fakeCalendar.ts）に差し替える。

export type CalendarEvent = calendar_v3.Schema$Event;

export type ListEventsParams = {
  calendarId: string;
  /** 差分取得用。指定時は timeMin / timeMax を付けない（API の制約） */
  syncToken?: string;
  timeMin?: string;
  timeMax?: string;
  pageToken?: string;
};

export type ListEventsResult = {
  items: CalendarEvent[];
  nextPageToken?: string;
  /** 最後のページでだけ返る */
  nextSyncToken?: string;
};

export type WatchParams = {
  calendarId: string;
  channelId: string;
  /** 通知を受け取る URL（HTTPS 必須） */
  address: string;
  /** 通知の正当性確認用トークン */
  token: string;
  ttlSeconds: number;
};

export type WatchResult = {
  resourceId: string;
  expiresAt: Date;
};

/** syncToken が無効化された（410 Gone）。全件同期をやり直す */
export class SyncTokenExpiredError extends Error {
  constructor() {
    super("sync token expired");
    this.name = "SyncTokenExpiredError";
  }
}

/** リフレッシュトークンが失効した（再連携が必要） */
export class AuthRevokedError extends Error {
  constructor(message = "auth revoked") {
    super(message);
    this.name = "AuthRevokedError";
  }
}

/** 予定やチャネルが存在しない（404 / 410） */
export class NotFoundError extends Error {
  constructor(message = "not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export interface CalendarClient {
  listEvents(params: ListEventsParams): Promise<ListEventsResult>;
  insertEvent(calendarId: string, event: CalendarEvent): Promise<CalendarEvent>;
  patchEvent(
    calendarId: string,
    eventId: string,
    event: CalendarEvent,
  ): Promise<CalendarEvent>;
  /** 存在しない場合は何もしない */
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
  watchEvents(params: WatchParams): Promise<WatchResult>;
  stopChannel(channelId: string, resourceId: string): Promise<void>;
}

/** リフレッシュトークンからクライアントを作る */
export type CalendarClientFactory = (refreshToken: string) => CalendarClient;

export function createCalendarClientFactory(options: {
  clientId: string;
  clientSecret: string;
}): CalendarClientFactory {
  return (refreshToken) => {
    const auth = new OAuth2Client({
      clientId: options.clientId,
      clientSecret: options.clientSecret,
    });
    auth.setCredentials({ refresh_token: refreshToken });
    const api = calendar({ version: "v3", auth });

    return {
      async listEvents(params) {
        try {
          const response = await api.events.list({
            calendarId: params.calendarId,
            ...(params.syncToken
              ? { syncToken: params.syncToken }
              : { timeMin: params.timeMin, timeMax: params.timeMax }),
            ...(params.pageToken ? { pageToken: params.pageToken } : {}),
            // 繰り返し予定は各回に展開し、キャンセルも受け取る
            singleEvents: true,
            showDeleted: true,
            maxResults: 2500,
          });
          return {
            items: response.data.items ?? [],
            nextPageToken: response.data.nextPageToken ?? undefined,
            nextSyncToken: response.data.nextSyncToken ?? undefined,
          };
        } catch (error) {
          throw translateError(error);
        }
      },

      async insertEvent(calendarId, event) {
        try {
          const response = await api.events.insert({
            calendarId,
            requestBody: event,
            sendUpdates: "none",
          });
          return response.data;
        } catch (error) {
          throw translateError(error);
        }
      },

      async patchEvent(calendarId, eventId, event) {
        try {
          const response = await api.events.patch({
            calendarId,
            eventId,
            requestBody: event,
            sendUpdates: "none",
          });
          return response.data;
        } catch (error) {
          throw translateError(error);
        }
      },

      async deleteEvent(calendarId, eventId) {
        try {
          await api.events.delete({ calendarId, eventId, sendUpdates: "none" });
        } catch (error) {
          const translated = translateError(error);
          if (translated instanceof NotFoundError) {
            return;
          }
          throw translated;
        }
      },

      async watchEvents(params) {
        try {
          const response = await api.events.watch({
            calendarId: params.calendarId,
            requestBody: {
              id: params.channelId,
              type: "web_hook",
              address: params.address,
              token: params.token,
              params: { ttl: String(params.ttlSeconds) },
            },
          });
          return {
            resourceId: response.data.resourceId ?? "",
            expiresAt: new Date(Number(response.data.expiration ?? 0)),
          };
        } catch (error) {
          throw translateError(error);
        }
      },

      async stopChannel(channelId, resourceId) {
        try {
          await api.channels.stop({
            requestBody: { id: channelId, resourceId },
          });
        } catch (error) {
          const translated = translateError(error);
          if (translated instanceof NotFoundError) {
            return;
          }
          throw translated;
        }
      },
    };
  };
}

/** Google API のエラーを同期エンジンが扱いやすい型に変換する */
export function translateError(error: unknown): Error {
  if (
    error instanceof SyncTokenExpiredError ||
    error instanceof AuthRevokedError ||
    error instanceof NotFoundError
  ) {
    return error;
  }
  const e = error as {
    code?: number | string;
    status?: number;
    message?: string;
    response?: {
      status?: number;
      data?: { error?: string | { message?: string } };
    };
  };
  const status = Number(e.response?.status ?? e.status ?? e.code ?? 0);
  const message = String(e.message ?? "");
  const data = e.response?.data?.error;
  const dataMessage =
    typeof data === "string" ? data : String(data?.message ?? "");

  if (status === 410) {
    // 予定の削除で 410 が返ることもあるが、一覧取得では syncToken の失効を意味する
    return message.includes("Sync token") || dataMessage.includes("Sync token")
      ? new SyncTokenExpiredError()
      : new NotFoundError(message);
  }
  if (status === 404) {
    return new NotFoundError(message);
  }
  if (
    status === 401 ||
    /invalid_grant|invalid_rapt|Token has been expired or revoked/i.test(
      `${message} ${dataMessage}`,
    )
  ) {
    return new AuthRevokedError(message);
  }
  return error instanceof Error ? error : new Error(String(error));
}
