import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

import type { SyncRule } from "../domain/rules.js";
import type { CalendarSummary } from "../lib/google.js";
import type {
  AccountStatus,
  AccountType,
  LinkedAccount,
  OAuthPurpose,
  OAuthState,
  Stores,
} from "./index.js";

// Firestore の構造は docs/requirements-and-design.md の 6.3 を参照
//   oauthStates/{state}
//   users/{uid}
//   users/{uid}/accounts/{accountId}
//   users/{uid}/rules/{ruleId}

export function createFirestoreStores(db: Firestore): Stores {
  const statesCollection = db.collection("oauthStates");
  const userDoc = (uid: string) => db.collection("users").doc(uid);
  const accountsCollection = (uid: string) =>
    userDoc(uid).collection("accounts");
  const rulesCollection = (uid: string) => userDoc(uid).collection("rules");

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
