import {
  evaluateEvent,
  eventEnd,
  isAllDay,
  isMirrorEvent,
  MIRROR_KEYS,
  startOfDayIn,
} from "../domain/filter.js";
import {
  buildMirrorEvent,
  fingerprintOf,
  sourceTimeZone,
} from "../domain/mirror.js";
import type { SyncRule } from "../domain/rules.js";
import {
  AuthRevokedError,
  NotFoundError,
  SyncTokenExpiredError,
  type CalendarClient,
  type CalendarEvent,
} from "../lib/calendar.js";
import { logger } from "../lib/logger.js";
import type { Notify, NotifyOptions } from "../lib/slack.js";
import {
  mirrorId,
  syncStateId,
  type LinkedAccount,
  type MirrorRecord,
  type Stores,
  type SyncState,
} from "../repositories/index.js";

// 同期エンジン（docs/requirements-and-design.md の F5 / 6.5）
// 送信元カレンダー単位で予定を取得し、そのカレンダーを使うすべての同期設定について
// ミラー予定の作成・更新・削除を行う。

/** ミラー予定は常に同期先のメインカレンダーに作る */
export const TARGET_CALENDAR_ID = "primary";

export type SyncDeps = {
  stores: Stores;
  /** 連携アカウントの Calendar API クライアントを返す */
  calendarFor: (account: LinkedAccount) => CalendarClient;
  now: () => Date;
  randomId: () => string;
  /** watch 通知を受ける公開 URL（未設定なら watch を使わずポーリングのみ） */
  publicBaseUrl?: string;
  /** watch チャネルの有効期間（秒）。Google の上限は約 7 日 */
  watchTtlSeconds?: number;
  /** 同期エラー・復旧・再認証が必要になったことを知らせる（未設定なら通知しない） */
  notify?: Notify;
  /** 通知に付けるアプリの URL */
  appUrl?: string;
};

export type SyncSummary = {
  calendars: number;
  processed: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  errors: string[];
};

function emptySummary(): SyncSummary {
  return {
    calendars: 0,
    processed: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    skipped: 0,
    errors: [],
  };
}

function mergeInto(total: SyncSummary, part: SyncSummary): void {
  total.calendars += part.calendars;
  total.processed += part.processed;
  total.created += part.created;
  total.updated += part.updated;
  total.deleted += part.deleted;
  total.skipped += part.skipped;
  total.errors.push(...part.errors);
}

type SourceGroup = {
  account: LinkedAccount;
  calendarId: string;
  rules: SyncRule[];
};

export function createSyncService(deps: SyncDeps) {
  const { stores } = deps;
  const watchTtlSeconds = deps.watchTtlSeconds ?? 7 * 24 * 60 * 60;

  /** 有効な同期設定を送信元カレンダーごとにまとめる */
  async function groupSources(
    uid: string,
    filter?: (rule: SyncRule) => boolean,
  ): Promise<{
    groups: SourceGroup[];
    accountsById: Map<string, LinkedAccount>;
  }> {
    const [rules, accounts] = await Promise.all([
      stores.rules.list(uid),
      stores.accounts.list(uid),
    ]);
    const accountsById = new Map(accounts.map((a) => [a.id, a]));
    const groups = new Map<string, SourceGroup>();
    for (const rule of rules) {
      if (!rule.enabled || (filter && !filter(rule))) {
        continue;
      }
      const account = accountsById.get(rule.source.accountId);
      if (!account || !accountsById.has(rule.target.accountId)) {
        continue;
      }
      for (const calendarId of rule.source.calendarIds) {
        const key = syncStateId(account.id, calendarId);
        const group = groups.get(key) ?? { account, calendarId, rules: [] };
        group.rules.push(rule);
        groups.set(key, group);
      }
    }
    return { groups: [...groups.values()], accountsById };
  }

  /** 全ページを取得する。差分取得で 410 なら SyncTokenExpiredError を投げる */
  async function fetchEvents(
    client: CalendarClient,
    calendarId: string,
    syncToken: string | null,
    windowDays: number,
    windowStart: Date,
  ): Promise<{ events: CalendarEvent[]; nextSyncToken: string | null }> {
    const now = deps.now();
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;
    do {
      const page = await client.listEvents({
        calendarId,
        ...(syncToken
          ? { syncToken }
          : {
              timeMin: windowStart.toISOString(),
              timeMax: new Date(
                now.getTime() + windowDays * 24 * 60 * 60 * 1000,
              ).toISOString(),
            }),
        ...(pageToken ? { pageToken } : {}),
      });
      events.push(...page.items);
      pageToken = page.nextPageToken;
      if (page.nextSyncToken) {
        nextSyncToken = page.nextSyncToken;
      }
    } while (pageToken);
    return { events, nextSyncToken };
  }

  /** タグで絞り込んでメインカレンダーの予定を全ページ取得する（過去 1 日〜先 400 日） */
  async function fetchTaggedEvents(
    client: CalendarClient,
    calendarId: string,
    tags: string[],
  ): Promise<CalendarEvent[]> {
    const now = deps.now();
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    do {
      const page = await client.listEvents({
        calendarId,
        timeMin: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        timeMax: new Date(
          now.getTime() + 400 * 24 * 60 * 60 * 1000,
        ).toISOString(),
        privateExtendedProperty: tags,
        ...(pageToken ? { pageToken } : {}),
      });
      events.push(
        ...page.items.filter((event) => event.status !== "cancelled"),
      );
      pageToken = page.nextPageToken;
    } while (pageToken);
    return events;
  }

  /** 通知を送る。本文の最後にアプリの URL を付ける */
  async function notify(text: string, options?: NotifyOptions): Promise<void> {
    if (!deps.notify) {
      return;
    }
    await deps.notify(deps.appUrl ? `${text}\n${deps.appUrl}` : text, options);
  }

  async function markAccountReauthRequired(
    uid: string,
    account: LinkedAccount,
  ) {
    // 取得し直して、直前に別の処理で切り替わっていれば通知を重ねない
    const current = (await stores.accounts.get(uid, account.id)) ?? account;
    if (current.status !== "reauth_required") {
      await stores.accounts.upsert(uid, {
        ...current,
        status: "reauth_required",
        updatedAt: deps.now(),
      });
      await notify(
        `⚠️ ${current.email} の連携が切れました。アプリの「アカウント」タブから、このアカウントを追加し直してください（同じアカウントで連携すると設定はそのまま使えます）`,
        { urgent: true },
      );
    }
  }

  /**
   * 1 つの元予定を 1 つの同期設定について処理する。
   * ミラーすべきなら作成・更新、すべきでないなら既存ミラーを削除する。
   */
  async function processEvent(
    uid: string,
    event: CalendarEvent,
    rule: SyncRule,
    group: SourceGroup,
    targetAccount: LinkedAccount,
    targetClient: CalendarClient,
    summary: SyncSummary,
    windowStart: Date,
    /**
     * 全件同期のとき、送信元カレンダーの対応表をまとめて読んだもの（id → 対応表）。
     * 予定ごとに Firestore を読まずに済ませ、作成・更新・削除はここにも反映する。
     * 差分同期では変わった予定が少ないので渡さず、1 件ずつ読む
     */
    records?: Map<string, MirrorRecord>,
  ): Promise<void> {
    if (!event.id) {
      return;
    }
    const id = mirrorId(rule.id, group.calendarId, event.id);
    const existing = records
      ? records.get(id)
      : await stores.mirrors.get(uid, id);
    const saveRecord = async (value: MirrorRecord) => {
      await stores.mirrors.upsert(uid, value);
      records?.set(value.id, value);
    };
    const evaluation = evaluateEvent(event, rule, {
      now: deps.now(),
      windowStart,
    });

    if (!evaluation.mirror) {
      // 同期範囲より前に終わった予定のミラーは、履歴として残す（キャンセルされた予定は上で消す）
      if (existing && evaluation.reason !== "past") {
        await targetClient.deleteEvent(
          existing.targetCalendarId,
          existing.targetEventId,
        );
        await stores.mirrors.delete(uid, id);
        records?.delete(id);
        summary.deleted++;
      } else {
        summary.skipped++;
      }
      return;
    }

    const body = buildMirrorEvent(event, rule, {
      sourceAccount: group.account,
      sourceCalendarId: group.calendarId,
      timeZone: sourceTimeZone(group.account, group.calendarId),
    });
    const fingerprint = fingerprintOf(body);
    // 予定の種類によっては色を受け付けないことがあるため、色付きで 400 になったら色なしで再試行する
    const withoutColor = (): CalendarEvent => {
      const { colorId: _omit, ...rest } = body;
      return rest;
    };
    const insertMirror = async () => {
      try {
        return await targetClient.insertEvent(TARGET_CALENDAR_ID, body);
      } catch (error) {
        if (!body.colorId || !isBadRequest(error)) {
          throw error;
        }
        logger.warn("色付きのミラー予定が拒否されたため、色なしで作成します", {
          uid,
          ruleId: rule.id,
          error: describeError(error),
        });
        return targetClient.insertEvent(TARGET_CALENDAR_ID, withoutColor());
      }
    };
    const patchMirror = async (calendarId: string, eventId: string) => {
      try {
        return await targetClient.patchEvent(calendarId, eventId, body);
      } catch (error) {
        if (!body.colorId || !isBadRequest(error)) {
          throw error;
        }
        return targetClient.patchEvent(calendarId, eventId, withoutColor());
      }
    };
    const record = (targetEventId: string): MirrorRecord => ({
      id,
      ruleId: rule.id,
      sourceAccountId: group.account.id,
      sourceCalendarId: group.calendarId,
      sourceEventId: event.id ?? "",
      targetAccountId: targetAccount.id,
      targetCalendarId: TARGET_CALENDAR_ID,
      targetEventId,
      kind: rule.output.kind,
      fingerprint,
      sourceEndAt: eventEnd(event) ?? null,
      updatedAt: deps.now(),
    });

    if (!existing) {
      const created = await insertMirror();
      await saveRecord(record(created.id ?? ""));
      summary.created++;
      return;
    }

    if (existing.kind !== rule.output.kind) {
      // eventType は後から変更できないため、作り直す
      await targetClient.deleteEvent(
        existing.targetCalendarId,
        existing.targetEventId,
      );
      const created = await insertMirror();
      await saveRecord(record(created.id ?? ""));
      summary.updated++;
      return;
    }

    if (existing.fingerprint === fingerprint) {
      // 終了時刻の項目が追加される前の対応表は、ここで埋める（予定自体は変えない）
      if (!existing.sourceEndAt) {
        await saveRecord({
          ...existing,
          sourceEndAt: eventEnd(event) ?? null,
        });
      }
      summary.skipped++;
      return;
    }

    try {
      await patchMirror(existing.targetCalendarId, existing.targetEventId);
      await saveRecord(record(existing.targetEventId));
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
      // 同期先で手動削除されていたら作り直す（設計方針: ミラーは再作成する）
      const created = await insertMirror();
      await saveRecord(record(created.id ?? ""));
    }
    summary.updated++;
  }

  /** 送信元カレンダー 1 つ分を同期する */
  async function syncSourceCalendar(
    uid: string,
    group: SourceGroup,
    accountsById: Map<string, LinkedAccount>,
    full: boolean,
  ): Promise<SyncSummary> {
    const summary = emptySummary();
    summary.calendars = 1;
    const stateId = syncStateId(group.account.id, group.calendarId);
    const state: SyncState = (await stores.syncStates.get(uid, stateId)) ?? {
      id: stateId,
      accountId: group.account.id,
      calendarId: group.calendarId,
      syncToken: null,
      lastFullSyncAt: null,
      lastIncrementalSyncAt: null,
      channelId: null,
      resourceId: null,
      channelToken: null,
      channelExpiresAt: null,
    };
    const windowDays = Math.max(...group.rules.map((r) => r.windowDays));
    // 今日すでに終わった予定も同期するため、範囲は送信元のタイムゾーンでの今日の 0:00 から
    const windowStart = startOfDayIn(
      deps.now(),
      sourceTimeZone(group.account, group.calendarId),
    );
    const sourceClient = deps.calendarFor(group.account);

    let usedFull = full || !state.syncToken;
    let fetched: { events: CalendarEvent[]; nextSyncToken: string | null };
    try {
      try {
        fetched = await fetchEvents(
          sourceClient,
          group.calendarId,
          usedFull ? null : state.syncToken,
          windowDays,
          windowStart,
        );
      } catch (error) {
        if (!(error instanceof SyncTokenExpiredError)) {
          throw error;
        }
        // syncToken が無効化されたので全件同期に切り替える
        usedFull = true;
        fetched = await fetchEvents(
          sourceClient,
          group.calendarId,
          null,
          windowDays,
          windowStart,
        );
      }
    } catch (error) {
      const message = describeError(error);
      if (error instanceof AuthRevokedError) {
        await markAccountReauthRequired(uid, group.account);
      }
      await recordRuleResult(
        uid,
        group.rules,
        `送信元の取得に失敗: ${message}`,
      );
      summary.errors.push(
        `${group.account.email}/${group.calendarId}: ${message}`,
      );
      return summary;
    }

    // 全件同期では、この送信元カレンダーの対応表を 1 回だけ読み、予定の処理と掃除で使い回す
    // （予定ごと・同期設定ごとに読み直すと、Firestore の読み取りが 1 日の無料枠を超えることがあったため）
    const records = usedFull
      ? new Map(
          (
            await stores.mirrors.listBySourceCalendar(
              uid,
              group.account.id,
              group.calendarId,
            )
          ).map((r) => [r.id, r] as const),
        )
      : undefined;
    const seenEventIds = new Set<string>();
    const targetClients = new Map<string, CalendarClient>();
    const ruleErrors = new Map<string, string>();

    for (const event of fetched.events) {
      if (event.id) {
        seenEventIds.add(event.id);
      }
      summary.processed++;
      for (const rule of group.rules) {
        if (ruleErrors.has(rule.id)) {
          continue;
        }
        const targetAccount = accountsById.get(rule.target.accountId);
        if (!targetAccount) {
          continue;
        }
        let targetClient = targetClients.get(targetAccount.id);
        if (!targetClient) {
          targetClient = deps.calendarFor(targetAccount);
          targetClients.set(targetAccount.id, targetClient);
        }
        try {
          await processEvent(
            uid,
            event,
            rule,
            group,
            targetAccount,
            targetClient,
            summary,
            windowStart,
            records,
          );
        } catch (error) {
          const message = describeError(error);
          if (error instanceof AuthRevokedError) {
            await markAccountReauthRequired(uid, targetAccount);
          }
          ruleErrors.set(rule.id, `同期先への反映に失敗: ${message}`);
          summary.errors.push(`${rule.name}: ${message}`);
          logger.warn("ミラー予定の反映に失敗しました", {
            uid,
            ruleId: rule.id,
            eventId: event.id,
            error: message,
          });
        }
      }
    }

    // 全件同期のときは、元予定が無くなった（範囲外・削除済み）ミラーを掃除する
    if (records) {
      for (const rule of group.rules) {
        if (ruleErrors.has(rule.id)) {
          continue;
        }
        const targetAccount = accountsById.get(rule.target.accountId);
        if (!targetAccount) {
          continue;
        }
        // 処理中の作成・削除を反映した対応表を使う（途中で消すので写しを回す）
        for (const record of [...records.values()]) {
          if (
            record.ruleId !== rule.id ||
            seenEventIds.has(record.sourceEventId)
          ) {
            continue;
          }
          // 範囲より前に終わった予定は取得されないので、見えなくても履歴として残す
          if (
            record.sourceEndAt &&
            record.sourceEndAt.getTime() <= windowStart.getTime()
          ) {
            continue;
          }
          try {
            const client =
              targetClients.get(targetAccount.id) ??
              deps.calendarFor(targetAccount);
            await client.deleteEvent(
              record.targetCalendarId,
              record.targetEventId,
            );
            await stores.mirrors.delete(uid, record.id);
            records.delete(record.id);
            summary.deleted++;
          } catch (error) {
            summary.errors.push(`${rule.name}: ${describeError(error)}`);
          }
        }
      }

      // 対応表が失われていても、タグで見つかるこの同期設定のミラーのうち対応表に無いものは掃除する
      for (const rule of group.rules) {
        if (ruleErrors.has(rule.id)) {
          continue;
        }
        const targetAccount = accountsById.get(rule.target.accountId);
        if (!targetAccount) {
          continue;
        }
        try {
          const client =
            targetClients.get(targetAccount.id) ??
            deps.calendarFor(targetAccount);
          // タグの検索はこの送信元カレンダーのミラーに絞るので、同じカレンダーの対応表と突き合わせれば足りる
          const known = new Set(
            [...records.values()]
              .filter((r) => r.ruleId === rule.id)
              .map((r) => r.targetEventId),
          );
          const tagged = await fetchTaggedEvents(client, TARGET_CALENDAR_ID, [
            `${MIRROR_KEYS.ruleId}=${rule.id}`,
            `${MIRROR_KEYS.sourceCalendarId}=${group.calendarId}`,
          ]);
          for (const event of tagged) {
            if (event.id && !known.has(event.id)) {
              await client.deleteEvent(TARGET_CALENDAR_ID, event.id);
              summary.deleted++;
            }
          }
        } catch (error) {
          summary.errors.push(`${rule.name}: ${describeError(error)}`);
        }
      }
    }

    const now = deps.now();
    await stores.syncStates.upsert(uid, {
      ...state,
      syncToken: fetched.nextSyncToken ?? state.syncToken,
      lastFullSyncAt: usedFull ? now : state.lastFullSyncAt,
      lastIncrementalSyncAt: usedFull ? state.lastIncrementalSyncAt : now,
    });
    for (const rule of group.rules) {
      await recordRuleResult(uid, [rule], ruleErrors.get(rule.id) ?? null);
    }
    return summary;
  }

  async function recordRuleResult(
    uid: string,
    rules: SyncRule[],
    error: string | null,
  ): Promise<void> {
    const now = deps.now();
    for (const rule of rules) {
      const current = (await stores.rules.get(uid, rule.id)) ?? rule;
      await stores.rules.update(uid, {
        ...current,
        lastSyncAt: now,
        lastError: error,
      });
      // 状態が変わったときだけ知らせる（10 分ごとの同期で同じ通知を繰り返さない）
      if (error && !current.lastError) {
        await notify(`⚠️ 同期エラー: ${current.name}\n${error}`, {
          urgent: true,
        });
      } else if (!error && current.lastError) {
        await notify(`✅ 同期が復旧しました: ${current.name}`);
      }
    }
  }

  /** ユーザーの有効な同期設定をすべて同期する */
  async function syncUser(
    uid: string,
    options: { full?: boolean; ruleIds?: string[] } = {},
  ): Promise<SyncSummary> {
    const total = emptySummary();
    const { groups, accountsById } = await groupSources(
      uid,
      options.ruleIds
        ? (rule) => options.ruleIds!.includes(rule.id)
        : undefined,
    );
    for (const group of groups) {
      const part = await syncSourceCalendar(
        uid,
        group,
        accountsById,
        options.full ?? false,
      );
      mergeInto(total, part);
    }
    return total;
  }

  /** 特定の同期設定だけを同期する（同じ送信元カレンダーを使う他の設定は対象外） */
  async function syncRule(
    uid: string,
    ruleId: string,
    full = true,
  ): Promise<SyncSummary> {
    return syncUser(uid, { full, ruleIds: [ruleId] });
  }

  /** 全ユーザーを同期する（Cloud Scheduler から） */
  async function syncAllUsers(full = false): Promise<SyncSummary> {
    const total = emptySummary();
    for (const uid of await stores.users.listUids()) {
      try {
        mergeInto(total, await syncUser(uid, { full }));
      } catch (error) {
        total.errors.push(`${uid}: ${describeError(error)}`);
        logger.error("ユーザーの同期に失敗しました", {
          uid,
          error: describeError(error),
        });
      }
    }
    return total;
  }

  /** ミラー対応表に従って同期先の予定を削除する。削除できた件数を返す */
  async function deleteMirrors(
    uid: string,
    records: MirrorRecord[],
    accountsById: Map<string, LinkedAccount>,
  ): Promise<number> {
    let deleted = 0;
    const clients = new Map<string, CalendarClient>();
    for (const record of records) {
      const targetAccount = accountsById.get(record.targetAccountId);
      if (targetAccount) {
        try {
          let client = clients.get(targetAccount.id);
          if (!client) {
            client = deps.calendarFor(targetAccount);
            clients.set(targetAccount.id, client);
          }
          await client.deleteEvent(
            record.targetCalendarId,
            record.targetEventId,
          );
        } catch (error) {
          logger.warn(
            "ミラー予定の削除に失敗しました（対応表からは消します）",
            {
              uid,
              mirrorId: record.id,
              error: describeError(error),
            },
          );
        }
      }
      await stores.mirrors.delete(uid, record.id);
      deleted++;
    }
    return deleted;
  }

  async function deleteMirrorsForRule(
    uid: string,
    ruleId: string,
  ): Promise<number> {
    const accounts = await stores.accounts.list(uid);
    const records = await stores.mirrors.listByRule(uid, ruleId);
    return deleteMirrors(uid, records, new Map(accounts.map((a) => [a.id, a])));
  }

  /** 連携解除の前に呼ぶ（同期先のトークンが失効する前に消す） */
  async function deleteMirrorsForAccount(
    uid: string,
    accountId: string,
  ): Promise<number> {
    const accounts = await stores.accounts.list(uid);
    const records = await stores.mirrors.listByAccount(uid, accountId);
    return deleteMirrors(uid, records, new Map(accounts.map((a) => [a.id, a])));
  }

  /**
   * 有効な同期設定の送信元カレンダーに watch チャネルを張る。
   * 期限が 1 日以内なら張り直す。publicBaseUrl が無ければ何もしない
   */
  async function ensureWatchChannels(
    uid: string,
  ): Promise<{ registered: number; skipped: number; errors: string[] }> {
    const result = { registered: 0, skipped: 0, errors: [] as string[] };
    if (!deps.publicBaseUrl) {
      return result;
    }
    const address = `${deps.publicBaseUrl.replace(/\/$/, "")}/webhooks/calendar`;
    const { groups } = await groupSources(uid);
    const now = deps.now();
    for (const group of groups) {
      const stateId = syncStateId(group.account.id, group.calendarId);
      const state: SyncState = (await stores.syncStates.get(uid, stateId)) ?? {
        id: stateId,
        accountId: group.account.id,
        calendarId: group.calendarId,
        syncToken: null,
        lastFullSyncAt: null,
        lastIncrementalSyncAt: null,
        channelId: null,
        resourceId: null,
        channelToken: null,
        channelExpiresAt: null,
      };
      const validUntil = state.channelExpiresAt?.getTime() ?? 0;
      if (state.channelId && validUntil - now.getTime() > 24 * 60 * 60 * 1000) {
        result.skipped++;
        continue;
      }
      const client = deps.calendarFor(group.account);
      try {
        const channelId = deps.randomId();
        const token = deps.randomId();
        const watch = await client.watchEvents({
          calendarId: group.calendarId,
          channelId,
          address,
          token,
          ttlSeconds: watchTtlSeconds,
        });
        if (state.channelId && state.resourceId) {
          await client
            .stopChannel(state.channelId, state.resourceId)
            .catch(() => undefined);
          await stores.channels.delete(state.channelId);
        }
        await stores.channels.upsert({
          id: channelId,
          uid,
          accountId: group.account.id,
          calendarId: group.calendarId,
          resourceId: watch.resourceId,
          token,
          expiresAt: watch.expiresAt,
        });
        await stores.syncStates.upsert(uid, {
          ...state,
          channelId,
          resourceId: watch.resourceId,
          channelToken: token,
          channelExpiresAt: watch.expiresAt,
        });
        result.registered++;
      } catch (error) {
        result.errors.push(
          `${group.account.email}/${group.calendarId}: ${describeError(error)}`,
        );
      }
    }
    return result;
  }

  /**
   * Google からの変更通知を処理する。チャネル ID とトークンが一致するときだけ差分同期を走らせる。
   * 戻り値の handled が false のときは無視した通知
   */
  async function handleNotification(notification: {
    channelId: string | undefined;
    token: string | undefined;
    resourceState: string | undefined;
  }): Promise<{ handled: boolean; summary?: SyncSummary }> {
    if (!notification.channelId) {
      return { handled: false };
    }
    const channel = await stores.channels.get(notification.channelId);
    if (!channel || channel.token !== notification.token) {
      return { handled: false };
    }
    if (notification.resourceState === "sync") {
      // チャネル登録直後の確認通知
      return { handled: true };
    }
    const { groups, accountsById } = await groupSources(
      channel.uid,
      (rule) =>
        rule.source.accountId === channel.accountId &&
        rule.source.calendarIds.includes(channel.calendarId),
    );
    const total = emptySummary();
    for (const group of groups) {
      if (group.calendarId !== channel.calendarId) {
        continue;
      }
      mergeInto(
        total,
        await syncSourceCalendar(channel.uid, group, accountsById, false),
      );
    }
    return { handled: true, summary: total };
  }

  /**
   * そのアカウントのメインカレンダーにある本アプリのミラー予定を、対応表の有無に関わらずすべて削除する。
   * エミュレータの消失などで対応表が失われたときの復旧用
   */
  async function purgeMirrorsInAccount(
    uid: string,
    accountId: string,
  ): Promise<{ deletedEvents: number; deletedRecords: number }> {
    const account = await stores.accounts.get(uid, accountId);
    if (!account) {
      return { deletedEvents: 0, deletedRecords: 0 };
    }
    const client = deps.calendarFor(account);
    const tagged = await fetchTaggedEvents(client, TARGET_CALENDAR_ID, [
      `${MIRROR_KEYS.app}=1`,
    ]);
    let deletedEvents = 0;
    for (const event of tagged) {
      if (event.id) {
        await client.deleteEvent(TARGET_CALENDAR_ID, event.id);
        deletedEvents++;
      }
    }
    let deletedRecords = 0;
    for (const record of await stores.mirrors.listByAccount(uid, accountId)) {
      if (record.targetAccountId === accountId) {
        await stores.mirrors.delete(uid, record.id);
        deletedRecords++;
      }
    }
    logger.info("アカウントのミラー予定を一括削除しました", {
      uid,
      accountId,
      deletedEvents,
      deletedRecords,
    });
    return { deletedEvents, deletedRecords };
  }

  /** 統合カレンダー表示用に、全連携アカウントのメインカレンダーの予定を集める */
  async function listUnifiedEvents(
    uid: string,
    from: Date,
    to: Date,
  ): Promise<{ events: UnifiedEvent[]; errors: string[] }> {
    const accounts = await stores.accounts.list(uid);
    const events: UnifiedEvent[] = [];
    const errors: string[] = [];
    for (const account of accounts) {
      if (account.status === "reauth_required") {
        errors.push(`${account.email}: 再認証が必要です`);
        continue;
      }
      try {
        const client = deps.calendarFor(account);
        let pageToken: string | undefined;
        do {
          const page = await client.listEvents({
            calendarId: TARGET_CALENDAR_ID,
            timeMin: from.toISOString(),
            timeMax: to.toISOString(),
            ...(pageToken ? { pageToken } : {}),
          });
          for (const event of page.items) {
            if (!event.id || event.status === "cancelled") {
              continue;
            }
            events.push({
              accountId: account.id,
              accountEmail: account.email,
              id: event.id,
              summary: event.summary ?? "（タイトルなし）",
              start: event.start?.dateTime ?? event.start?.date ?? "",
              end: event.end?.dateTime ?? event.end?.date ?? "",
              allDay: isAllDay(event),
              eventType: event.eventType ?? "default",
              isMirror: isMirrorEvent(event),
              mirrorRuleId:
                event.extendedProperties?.private?.[MIRROR_KEYS.ruleId] ?? null,
              hangoutLink: event.hangoutLink ?? null,
            });
          }
          pageToken = page.nextPageToken;
        } while (pageToken);
      } catch (error) {
        if (error instanceof AuthRevokedError) {
          await markAccountReauthRequired(uid, account);
        }
        errors.push(`${account.email}: ${describeError(error)}`);
      }
    }
    events.sort((a, b) => a.start.localeCompare(b.start));
    return { events, errors };
  }

  return {
    syncUser,
    syncRule,
    syncAllUsers,
    deleteMirrorsForRule,
    deleteMirrorsForAccount,
    purgeMirrorsInAccount,
    ensureWatchChannels,
    handleNotification,
    listUnifiedEvents,
  };
}

/** 統合カレンダー表示の 1 件 */
export type UnifiedEvent = {
  accountId: string;
  accountEmail: string;
  id: string;
  summary: string;
  /** dateTime（オフセット付き）または終日の date */
  start: string;
  end: string;
  allDay: boolean;
  eventType: string;
  /** 本アプリが作成したミラー予定か */
  isMirror: boolean;
  mirrorRuleId: string | null;
  hangoutLink: string | null;
};

export type SyncService = ReturnType<typeof createSyncService>;

/** Google API の 400（リクエスト内容の不備） */
function isBadRequest(error: unknown): boolean {
  const e = error as {
    code?: number | string;
    status?: number;
    response?: { status?: number };
  };
  return Number(e.response?.status ?? e.status ?? e.code ?? 0) === 400;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
