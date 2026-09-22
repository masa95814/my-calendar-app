import {
  Timestamp,
  type DocumentData,
  type Firestore,
} from "firebase-admin/firestore";

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

export function createFirestoreStores(db: Firestore): Stores {
  const statesCollection = db.collection("oauthStates");
  const userDoc = (uid: string) => db.collection("users").doc(uid);
  const accountsCollection = (uid: string) =>
    userDoc(uid).collection("accounts");

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
