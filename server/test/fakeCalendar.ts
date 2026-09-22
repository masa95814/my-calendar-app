import {
  AuthRevokedError,
  NotFoundError,
  SyncTokenExpiredError,
  type CalendarClient,
  type CalendarEvent,
} from "../src/lib/calendar.js";

// Google Calendar API の偽物。アカウントとカレンダーごとに予定を保持し、
// バージョン番号で syncToken による差分取得を模倣する

type StoredEvent = { event: CalendarEvent; version: number };

export type FakeCall = {
  method: string;
  accountId: string;
  calendarId: string;
  eventId?: string;
};

export type FakeCalendars = {
  clientFor: (accountId: string) => CalendarClient;
  /** 元予定を追加・更新する（テスト側からの操作） */
  put(accountId: string, calendarId: string, event: CalendarEvent): void;
  /** 元予定をキャンセル扱いにする */
  cancel(accountId: string, calendarId: string, eventId: string): void;
  /** 元予定を完全に消す（差分に現れない = 孤児の再現用） */
  purge(accountId: string, calendarId: string, eventId: string): void;
  /** キャンセルされていない予定 */
  list(accountId: string, calendarId: string): CalendarEvent[];
  /** 次の差分取得で 410 を返す */
  expireSyncTokens(): void;
  /** そのアカウントの呼び出しをすべて認証失効にする */
  revoke(accountId: string): void;
  calls: FakeCall[];
  now: () => Date;
};

export function createFakeCalendars(now: () => Date): FakeCalendars {
  const store = new Map<string, Map<string, StoredEvent>>();
  const revoked = new Set<string>();
  let version = 0;
  let expireNext = false;
  let insertCounter = 0;
  const calls: FakeCall[] = [];

  const key = (accountId: string, calendarId: string) =>
    `${accountId}/${calendarId}`;
  const bucket = (accountId: string, calendarId: string) => {
    const k = key(accountId, calendarId);
    let b = store.get(k);
    if (!b) {
      b = new Map();
      store.set(k, b);
    }
    return b;
  };

  const fake: FakeCalendars = {
    calls,
    now,
    put(accountId, calendarId, event) {
      if (!event.id) {
        throw new Error("event.id は必須");
      }
      bucket(accountId, calendarId).set(event.id, {
        event: { status: "confirmed", ...event },
        version: ++version,
      });
    },
    cancel(accountId, calendarId, eventId) {
      const stored = bucket(accountId, calendarId).get(eventId);
      if (stored) {
        stored.event = { ...stored.event, status: "cancelled" };
        stored.version = ++version;
      }
    },
    purge(accountId, calendarId, eventId) {
      bucket(accountId, calendarId).delete(eventId);
    },
    list(accountId, calendarId) {
      return [...bucket(accountId, calendarId).values()]
        .map((s) => s.event)
        .filter((e) => e.status !== "cancelled");
    },
    expireSyncTokens() {
      expireNext = true;
    },
    revoke(accountId) {
      revoked.add(accountId);
    },
    clientFor(accountId) {
      const guard = () => {
        if (revoked.has(accountId)) {
          throw new AuthRevokedError("invalid_grant");
        }
      };
      return {
        async listEvents(params) {
          guard();
          calls.push({
            method: "list",
            accountId,
            calendarId: params.calendarId,
          });
          const b = bucket(accountId, params.calendarId);
          if (params.syncToken) {
            if (expireNext) {
              expireNext = false;
              throw new SyncTokenExpiredError();
            }
            const since = Number(params.syncToken.replace("v:", ""));
            return {
              items: [...b.values()]
                .filter((s) => s.version > since)
                .map((s) => s.event),
              nextSyncToken: `v:${version}`,
            };
          }
          const tags = (params.privateExtendedProperty ?? []).map((kv) => {
            const [k, ...rest] = kv.split("=");
            return [k ?? "", rest.join("=")] as const;
          });
          return {
            items: [...b.values()]
              .filter((s) => s.event.status !== "cancelled")
              .filter((s) =>
                tags.every(
                  ([k, v]) => s.event.extendedProperties?.private?.[k] === v,
                ),
              )
              .map((s) => s.event),
            nextSyncToken: `v:${version}`,
          };
        },
        async insertEvent(calendarId, event) {
          guard();
          const id = `${accountId}-evt-${++insertCounter}`;
          calls.push({ method: "insert", accountId, calendarId, eventId: id });
          const created = { ...event, id, status: "confirmed" };
          bucket(accountId, calendarId).set(id, {
            event: created,
            version: ++version,
          });
          return created;
        },
        async patchEvent(calendarId, eventId, event) {
          guard();
          calls.push({ method: "patch", accountId, calendarId, eventId });
          const b = bucket(accountId, calendarId);
          const stored = b.get(eventId);
          if (!stored || stored.event.status === "cancelled") {
            throw new NotFoundError();
          }
          stored.event = { ...stored.event, ...event };
          stored.version = ++version;
          return stored.event;
        },
        async deleteEvent(calendarId, eventId) {
          guard();
          calls.push({ method: "delete", accountId, calendarId, eventId });
          const b = bucket(accountId, calendarId);
          const stored = b.get(eventId);
          if (stored) {
            stored.event = { ...stored.event, status: "cancelled" };
            stored.version = ++version;
          }
        },
        async watchEvents(params) {
          guard();
          calls.push({
            method: "watch",
            accountId,
            calendarId: params.calendarId,
            eventId: params.channelId,
          });
          return {
            resourceId: `resource-${params.channelId}`,
            expiresAt: new Date(now().getTime() + params.ttlSeconds * 1000),
          };
        },
        async stopChannel(channelId) {
          calls.push({
            method: "stop",
            accountId,
            calendarId: "",
            eventId: channelId,
          });
        },
      };
    },
  };
  return fake;
}
