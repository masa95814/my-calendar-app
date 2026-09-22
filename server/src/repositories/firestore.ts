import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

import type { OutputKind, SyncRule } from "../domain/rules.js";
import type { CalendarSummary } from "../lib/google.js";
import type {
  AccountStatus,
  AccountType,
  LinkedAccount,
  MirrorRecord,
  OAuthPurpose,
  OAuthState,
  Stores,
  SyncState,
  WatchChannel,
} from "./index.js";

// Firestore の構造は docs/requirements-and-design.md の 6.3 を参照
//   oauthStates/{state}
//   channels/{channelId}
//   users/{uid}
//   users/{uid}/accounts/{accountId}
//   users/{uid}/rules/{ruleId}
//   users/{uid}/syncStates/{accountId~calendarId}
//   users/{uid}/mirrors/{ruleId~calendarId~eventId}

export function createFirestoreStores(db: Firestore): Stores {
  const statesCollection = db.collection("oauthStates");
  const channelsCollection = db.collection("channels");
  const usersCollection = db.collection("users");
  const userDoc = (uid: string) => usersCollection.doc(uid);
  const accountsCollection = (uid: string) =>
    userDoc(uid).collection("accounts");
  const rulesCollection = (uid: string) => userDoc(uid).collection("rules");
  const syncStatesCollection = (uid: string) =>
    userDoc(uid).collection("syncStates");
  const mirrorsCollection = (uid: string) => userDoc(uid).collection("mirrors");

  return {
    oauthStates: {
      async create(state) {
        await statesCollection.doc(state.state).set({
          purpose: state.purpose,
          uid: state.uid ?? null,
          returnTo: state.returnTo,
          createdAt: Timestamp.fromDate(state.createdAt),
          expiresAt: Timestamp.fromDate(state.expiresAt),
        });
      },
      async consume(state) {
        const ref = statesCollection.doc(state);
        // 取得と削除をトランザクションで行い、同じ state を 2 回使えないようにする
        return db.runTransaction(async (tx) => {
          const snapshot = await tx.get(ref);
          if (!snapshot.exists) {
            return undefined;
          }
          tx.delete(ref);
          const data = snapshot.data() ?? {};
          const saved: OAuthState = {
            state,
            purpose: data.purpose as OAuthPurpose,
            returnTo: String(data.returnTo ?? ""),
            createdAt: toDate(data.createdAt),
            expiresAt: toDate(data.expiresAt),
          };
          if (typeof data.uid === "string") {
            saved.uid = data.uid;
          }
          return saved;
        });
      },
    },

    accounts: {
      async list(uid) {
        const snapshot = await accountsCollection(uid)
          .orderBy("linkedAt")
          .get();
        return snapshot.docs.map((doc) => fromAccountDoc(doc.id, doc.data()));
      },
      async get(uid, accountId) {
        const snapshot = await accountsCollection(uid).doc(accountId).get();
        const data = snapshot.data();
        return snapshot.exists && data
          ? fromAccountDoc(snapshot.id, data)
          : undefined;
      },
      async upsert(uid, account) {
        await accountsCollection(uid)
          .doc(account.id)
          .set(toAccountDoc(account));
      },
      async delete(uid, accountId) {
        await accountsCollection(uid).doc(accountId).delete();
      },
    },

    users: {
      async recordLogin(uid, email, at) {
        const ref = userDoc(uid);
        const snapshot = await ref.get();
        await ref.set(
          {
            email,
            lastLoginAt: Timestamp.fromDate(at),
            ...(snapshot.exists ? {} : { createdAt: Timestamp.fromDate(at) }),
          },
          { merge: true },
        );
      },
      async listUids() {
        const snapshot = await usersCollection.select().get();
        return snapshot.docs.map((doc) => doc.id);
      },
    },

    syncStates: {
      async get(uid, id) {
        const snapshot = await syncStatesCollection(uid).doc(id).get();
        const data = snapshot.data();
        return snapshot.exists && data
          ? fromSyncStateDoc(snapshot.id, data)
          : undefined;
      },
      async list(uid) {
        const snapshot = await syncStatesCollection(uid).get();
        return snapshot.docs.map((doc) => fromSyncStateDoc(doc.id, doc.data()));
      },
      async upsert(uid, state) {
        await syncStatesCollection(uid)
          .doc(state.id)
          .set({
            accountId: state.accountId,
            calendarId: state.calendarId,
            syncToken: state.syncToken,
            lastFullSyncAt: toTimestampOrNull(state.lastFullSyncAt),
            lastIncrementalSyncAt: toTimestampOrNull(
              state.lastIncrementalSyncAt,
            ),
            channelId: state.channelId,
            resourceId: state.resourceId,
            channelToken: state.channelToken,
            channelExpiresAt: toTimestampOrNull(state.channelExpiresAt),
          });
      },
      async delete(uid, id) {
        await syncStatesCollection(uid).doc(id).delete();
      },
    },

    mirrors: {
      async get(uid, id) {
        const snapshot = await mirrorsCollection(uid).doc(id).get();
        const data = snapshot.data();
        return snapshot.exists && data
          ? fromMirrorDoc(snapshot.id, data)
          : undefined;
      },
      async upsert(uid, record) {
        await mirrorsCollection(uid)
          .doc(record.id)
          .set({
            ruleId: record.ruleId,
            sourceAccountId: record.sourceAccountId,
            sourceCalendarId: record.sourceCalendarId,
            sourceEventId: record.sourceEventId,
            targetAccountId: record.targetAccountId,
            targetCalendarId: record.targetCalendarId,
            targetEventId: record.targetEventId,
            kind: record.kind,
            fingerprint: record.fingerprint,
            updatedAt: Timestamp.fromDate(record.updatedAt),
          });
      },
      async delete(uid, id) {
        await mirrorsCollection(uid).doc(id).delete();
      },
      async listByRule(uid, ruleId) {
        const snapshot = await mirrorsCollection(uid)
          .where("ruleId", "==", ruleId)
          .get();
        return snapshot.docs.map((doc) => fromMirrorDoc(doc.id, doc.data()));
      },
      async listBySourceCalendar(uid, sourceAccountId, sourceCalendarId) {
        const snapshot = await mirrorsCollection(uid)
          .where("sourceAccountId", "==", sourceAccountId)
          .where("sourceCalendarId", "==", sourceCalendarId)
          .get();
        return snapshot.docs.map((doc) => fromMirrorDoc(doc.id, doc.data()));
      },
      async listByAccount(uid, accountId) {
        const [asSource, asTarget] = await Promise.all([
          mirrorsCollection(uid)
            .where("sourceAccountId", "==", accountId)
            .get(),
          mirrorsCollection(uid)
            .where("targetAccountId", "==", accountId)
            .get(),
        ]);
        const byId = new Map<string, MirrorRecord>();
        for (const doc of [...asSource.docs, ...asTarget.docs]) {
          byId.set(doc.id, fromMirrorDoc(doc.id, doc.data()));
        }
        return [...byId.values()];
      },
    },

    channels: {
      async get(channelId) {
        const snapshot = await channelsCollection.doc(channelId).get();
        const data = snapshot.data();
        if (!snapshot.exists || !data) {
          return undefined;
        }
        return {
          id: snapshot.id,
          uid: String(data.uid ?? ""),
          accountId: String(data.accountId ?? ""),
          calendarId: String(data.calendarId ?? ""),
          resourceId: String(data.resourceId ?? ""),
          token: String(data.token ?? ""),
          expiresAt: toDate(data.expiresAt),
        };
      },
      async upsert(channel) {
        await channelsCollection.doc(channel.id).set({
          uid: channel.uid,
          accountId: channel.accountId,
          calendarId: channel.calendarId,
          resourceId: channel.resourceId,
          token: channel.token,
          expiresAt: Timestamp.fromDate(channel.expiresAt),
        });
      },
      async delete(channelId) {
        await channelsCollection.doc(channelId).delete();
      },
    },

    rules: {
      async list(uid) {
        const snapshot = await rulesCollection(uid).orderBy("createdAt").get();
        return snapshot.docs.map((doc) => fromRuleDoc(doc.id, doc.data()));
      },
      async get(uid, ruleId) {
        const snapshot = await rulesCollection(uid).doc(ruleId).get();
        const data = snapshot.data();
        return snapshot.exists && data
          ? fromRuleDoc(snapshot.id, data)
          : undefined;
      },
      async findBySourceTarget(uid, sourceAccountId, targetAccountId) {
        const snapshot = await rulesCollection(uid)
          .where("source.accountId", "==", sourceAccountId)
          .where("target.accountId", "==", targetAccountId)
          .limit(1)
          .get();
        const doc = snapshot.docs[0];
        return doc ? fromRuleDoc(doc.id, doc.data()) : undefined;
      },
      async create(uid, rule) {
        await rulesCollection(uid).doc(rule.id).set(toRuleDoc(rule));
      },
      async update(uid, rule) {
        await rulesCollection(uid).doc(rule.id).set(toRuleDoc(rule));
      },
      async delete(uid, ruleId) {
        await rulesCollection(uid).doc(ruleId).delete();
      },
      async disableForAccount(uid, accountId) {
        const [asSource, asTarget] = await Promise.all([
          rulesCollection(uid).where("source.accountId", "==", accountId).get(),
          rulesCollection(uid).where("target.accountId", "==", accountId).get(),
        ]);
        const refs = new Map(
          [...asSource.docs, ...asTarget.docs].map((doc) => [doc.id, doc.ref]),
        );
        if (refs.size === 0) {
          return 0;
        }
        const batch = db.batch();
        for (const ref of refs.values()) {
          batch.update(ref, { enabled: false, updatedAt: Timestamp.now() });
        }
        await batch.commit();
        return refs.size;
      },
    },
  };
}

function toRuleDoc(rule: SyncRule): DocumentData {
  return {
    name: rule.name,
    enabled: rule.enabled,
    source: rule.source,
    target: rule.target,
    windowDays: rule.windowDays,
    filters: rule.filters,
    output: rule.output,
    createdAt: Timestamp.fromDate(rule.createdAt),
    updatedAt: Timestamp.fromDate(rule.updatedAt),
    lastSyncAt: rule.lastSyncAt ? Timestamp.fromDate(rule.lastSyncAt) : null,
    lastError: rule.lastError,
  };
}

function fromRuleDoc(id: string, data: DocumentData): SyncRule {
  return {
    id,
    name: String(data.name ?? ""),
    enabled: Boolean(data.enabled),
    source: data.source as SyncRule["source"],
    target: data.target as SyncRule["target"],
    windowDays: Number(data.windowDays ?? 60),
    filters: data.filters as SyncRule["filters"],
    output: data.output as SyncRule["output"],
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    lastSyncAt: data.lastSyncAt ? toDate(data.lastSyncAt) : null,
    lastError: typeof data.lastError === "string" ? data.lastError : null,
  };
}

function toDate(value: unknown): Date {
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (value instanceof Date) {
    return value;
  }
  return new Date(String(value));
}

function toDateOrNull(value: unknown): Date | null {
  return value === null || value === undefined ? null : toDate(value);
}

function toTimestampOrNull(value: Date | null): Timestamp | null {
  return value ? Timestamp.fromDate(value) : null;
}

function fromSyncStateDoc(id: string, data: DocumentData): SyncState {
  return {
    id,
    accountId: String(data.accountId ?? ""),
    calendarId: String(data.calendarId ?? ""),
    syncToken: typeof data.syncToken === "string" ? data.syncToken : null,
    lastFullSyncAt: toDateOrNull(data.lastFullSyncAt),
    lastIncrementalSyncAt: toDateOrNull(data.lastIncrementalSyncAt),
    channelId: typeof data.channelId === "string" ? data.channelId : null,
    resourceId: typeof data.resourceId === "string" ? data.resourceId : null,
    channelToken:
      typeof data.channelToken === "string" ? data.channelToken : null,
    channelExpiresAt: toDateOrNull(data.channelExpiresAt),
  };
}

function fromMirrorDoc(id: string, data: DocumentData): MirrorRecord {
  return {
    id,
    ruleId: String(data.ruleId ?? ""),
    sourceAccountId: String(data.sourceAccountId ?? ""),
    sourceCalendarId: String(data.sourceCalendarId ?? ""),
    sourceEventId: String(data.sourceEventId ?? ""),
    targetAccountId: String(data.targetAccountId ?? ""),
    targetCalendarId: String(data.targetCalendarId ?? "primary"),
    targetEventId: String(data.targetEventId ?? ""),
    kind: (data.kind as OutputKind) ?? "busy",
    fingerprint: String(data.fingerprint ?? ""),
    updatedAt: toDate(data.updatedAt),
  };
}

function toAccountDoc(account: LinkedAccount): DocumentData {
  return {
    email: account.email,
    hd: account.hd ?? null,
    type: account.type,
    refreshTokenEnc: account.refreshTokenEnc,
    scopes: account.scopes,
    status: account.status,
    calendars: account.calendars,
    linkedAt: Timestamp.fromDate(account.linkedAt),
    updatedAt: Timestamp.fromDate(account.updatedAt),
  };
}

function fromAccountDoc(id: string, data: DocumentData): LinkedAccount {
  const account: LinkedAccount = {
    id,
    email: String(data.email ?? ""),
    type: (data.type as AccountType) ?? "personal",
    refreshTokenEnc: String(data.refreshTokenEnc ?? ""),
    scopes: Array.isArray(data.scopes) ? (data.scopes as string[]) : [],
    status: (data.status as AccountStatus) ?? "ok",
    calendars: Array.isArray(data.calendars)
      ? (data.calendars as CalendarSummary[])
      : [],
    linkedAt: toDate(data.linkedAt),
    updatedAt: toDate(data.updatedAt),
  };
  if (typeof data.hd === "string") {
    account.hd = data.hd;
  }
  return account;
}
