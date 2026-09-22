import { createApp, type AppDependencies } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { SyncRule } from "../src/domain/rules.js";
import { createTokenCipher } from "../src/lib/crypto.js";
import type {
  CalendarSummary,
  GoogleIdentity,
  GoogleOAuth,
  GoogleTokens,
} from "../src/lib/google.js";
import type {
  LinkedAccount,
  MirrorRecord,
  OAuthState,
  Stores,
  SyncState,
  WatchChannel,
} from "../src/repositories/index.js";
import type { FirebaseUserService } from "../src/routes/auth.js";
import { createFakeCalendars, type FakeCalendars } from "./fakeCalendar.js";

/** テスト用の最小限の環境変数 */
export const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  OWNER_EMAILS: "Owner@example.com",
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  OAUTH_REDIRECT_URI: "http://localhost:8080/auth/google/callback",
  APP_RETURN_URL_PREFIXES: "mycalendarapp://,exp://",
  OAUTH_STATE_TTL_SECONDS: "600",
};

/** Firebase ID トークン検証の偽物。トークン文字列で利用者を切り替える */
export const fakeVerifyIdToken = async (token: string) => {
  if (token === "owner-token") {
    return { uid: "owner-uid", email: "owner@example.com" };
  }
  if (token === "stranger-token") {
    return { uid: "stranger-uid", email: "stranger@example.com" };
  }
  throw new Error("invalid token");
};

export const ownerHeaders = { Authorization: "Bearer owner-token" };
export const jsonHeaders = {
  ...ownerHeaders,
  "content-type": "application/json",
};

export type MemoryStores = Stores & {
  states: Map<string, OAuthState>;
  accounts: Stores["accounts"] & { data: Map<string, LinkedAccount> };
  rules: Stores["rules"] & { data: Map<string, SyncRule> };
  mirrors: Stores["mirrors"] & { data: Map<string, MirrorRecord> };
  syncStates: Stores["syncStates"] & { data: Map<string, SyncState> };
  channels: Stores["channels"] & { data: Map<string, WatchChannel> };
  logins: { uid: string; email: string; at: Date }[];
};

/** Firestore の代わりになるメモリ実装 */
export function createMemoryStores(): MemoryStores {
  const states = new Map<string, OAuthState>();
  const accountsData = new Map<string, LinkedAccount>();
  const rulesData = new Map<string, SyncRule>();
  const mirrorsData = new Map<string, MirrorRecord>();
  const syncStatesData = new Map<string, SyncState>();
  const channelsData = new Map<string, WatchChannel>();
  const logins: MemoryStores["logins"] = [];
  const key = (uid: string, id: string) => `${uid}/${id}`;
  const ofUser = <T>(map: Map<string, T>, uid: string): T[] =>
    [...map.entries()]
      .filter(([k]) => k.startsWith(`${uid}/`))
      .map(([, v]) => v);
  const rulesOf = (uid: string) =>
    ofUser(rulesData, uid).sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );

  return {
    states,
    logins,
    rules: {
      data: rulesData,
      async list(uid) {
        return rulesOf(uid);
      },
      async get(uid, id) {
        return rulesData.get(key(uid, id));
      },
      async findBySourceTarget(uid, sourceAccountId, targetAccountId) {
        return rulesOf(uid).find(
          (r) =>
            r.source.accountId === sourceAccountId &&
            r.target.accountId === targetAccountId,
        );
      },
      async create(uid, rule) {
        rulesData.set(key(uid, rule.id), rule);
      },
      async update(uid, rule) {
        rulesData.set(key(uid, rule.id), rule);
      },
      async delete(uid, id) {
        rulesData.delete(key(uid, id));
      },
      async disableForAccount(uid, accountId) {
        let count = 0;
        for (const rule of rulesOf(uid)) {
          if (
            rule.source.accountId === accountId ||
            rule.target.accountId === accountId
          ) {
            rulesData.set(key(uid, rule.id), { ...rule, enabled: false });
            count++;
          }
        }
        return count;
      },
    },
    oauthStates: {
      async create(state) {
        states.set(state.state, state);
      },
      async consume(state) {
        const saved = states.get(state);
        states.delete(state);
        return saved;
      },
    },
    accounts: {
      data: accountsData,
      async list(uid) {
        return ofUser(accountsData, uid).sort(
          (a, b) => a.linkedAt.getTime() - b.linkedAt.getTime(),
        );
      },
      async get(uid, id) {
        return accountsData.get(key(uid, id));
      },
      async upsert(uid, account) {
        accountsData.set(key(uid, account.id), account);
      },
      async delete(uid, id) {
        accountsData.delete(key(uid, id));
      },
    },
    users: {
      async recordLogin(uid, email, at) {
        logins.push({ uid, email, at });
      },
      async listUids() {
        const uids = new Set<string>();
        for (const k of [...accountsData.keys(), ...rulesData.keys()]) {
          uids.add(k.split("/")[0] ?? "");
        }
        for (const l of logins) {
          uids.add(l.uid);
        }
        return [...uids].filter(Boolean);
      },
    },
    syncStates: {
      data: syncStatesData,
      async get(uid, id) {
        return syncStatesData.get(key(uid, id));
      },
      async list(uid) {
        return ofUser(syncStatesData, uid);
      },
      async upsert(uid, state) {
        syncStatesData.set(key(uid, state.id), state);
      },
      async delete(uid, id) {
        syncStatesData.delete(key(uid, id));
      },
    },
    mirrors: {
      data: mirrorsData,
      async get(uid, id) {
        return mirrorsData.get(key(uid, id));
      },
      async upsert(uid, record) {
        mirrorsData.set(key(uid, record.id), record);
      },
      async delete(uid, id) {
        mirrorsData.delete(key(uid, id));
      },
      async listByRule(uid, ruleId) {
        return ofUser(mirrorsData, uid).filter((m) => m.ruleId === ruleId);
      },
      async listBySourceCalendar(uid, sourceAccountId, sourceCalendarId) {
        return ofUser(mirrorsData, uid).filter(
          (m) =>
            m.sourceAccountId === sourceAccountId &&
            m.sourceCalendarId === sourceCalendarId,
        );
      },
      async listByAccount(uid, accountId) {
        return ofUser(mirrorsData, uid).filter(
          (m) =>
            m.sourceAccountId === accountId || m.targetAccountId === accountId,
        );
      },
    },
    channels: {
      data: channelsData,
      async get(channelId) {
        return channelsData.get(channelId);
      },
      async upsert(channel) {
        channelsData.set(channel.id, channel);
      },
      async delete(channelId) {
        channelsData.delete(channelId);
      },
    },
  };
}

export type FakeGoogle = GoogleOAuth & {
  /** 認可コード → 返すトークン */
  codes: Map<string, GoogleTokens>;
  /** ID トークン → 本人情報 */
  identities: Map<string, GoogleIdentity>;
  calendars: CalendarSummary[];
  revoked: string[];
  authorizeCalls: Parameters<GoogleOAuth["authorizeUrl"]>[0][];
};

/** Google OAuth / Calendar API の偽物 */
export function createFakeGoogle(): FakeGoogle {
  const fake: FakeGoogle = {
    codes: new Map(),
    identities: new Map(),
    calendars: [
      {
        id: "primary-id",
        summary: "owner@example.com",
        primary: true,
        accessRole: "owner",
        timeZone: "Asia/Tokyo",
      },
    ],
    revoked: [],
    authorizeCalls: [],
    authorizeUrl(params) {
      fake.authorizeCalls.push(params);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("state", params.state);
      url.searchParams.set("scope", params.scopes.join(" "));
      url.searchParams.set(
        "access_type",
        params.offline ? "offline" : "online",
      );
      return url.toString();
    },
    async exchangeCode(code) {
      const tokens = fake.codes.get(code);
      if (!tokens) {
        throw new Error(`unknown code: ${code}`);
      }
      return tokens;
    },
    async verifyIdToken(idToken) {
      const identity = fake.identities.get(idToken);
      if (!identity) {
        throw new Error(`unknown id token: ${idToken}`);
      }
      return identity;
    },
    async listCalendars() {
      return fake.calendars;
    },
    async revokeToken(token) {
      fake.revoked.push(token);
    },
  };
  return fake;
}

export type FakeFirebase = FirebaseUserService & {
  users: Map<string, string>;
};

export function createFakeFirebase(): FakeFirebase {
  const users = new Map<string, string>();
  return {
    users,
    async ensureUser(uid, email) {
      if (!users.has(uid)) {
        users.set(uid, email);
      }
    },
    async createCustomToken(uid) {
      return `custom-token-for-${uid}`;
    },
  };
}

export type TestHarness = {
  app: ReturnType<typeof createApp>;
  stores: MemoryStores;
  google: FakeGoogle;
  firebase: FakeFirebase;
  calendars: FakeCalendars;
  cipher: ReturnType<typeof createTokenCipher>;
  clock: { now: Date };
};

/** すべての依存を偽物にしたアプリを組み立てる */
export function buildTestApp(
  overrides: Partial<AppDependencies> & { env?: NodeJS.ProcessEnv } = {},
): TestHarness {
  const stores = createMemoryStores();
  const google = createFakeGoogle();
  const firebase = createFakeFirebase();
  const cipher = createTokenCipher();
  const clock = { now: new Date("2026-09-23T00:00:00Z") };
  const calendars = createFakeCalendars(() => clock.now);
  let stateCounter = 0;
  let idCounter = 0;

  const { env, ...depOverrides } = overrides;
  const app = createApp({
    config: loadConfig({ ...baseEnv, ...env }),
    verifyIdToken: fakeVerifyIdToken,
    google,
    stores,
    firebase,
    cipher,
    calendarFor: (account) => calendars.clientFor(account.id),
    now: () => clock.now,
    randomState: () => `state-${++stateCounter}`,
    randomId: () => `id-${++idCounter}`,
    ...depOverrides,
  });

  return { app, stores, google, firebase, calendars, cipher, clock };
}

/** テスト用の連携アカウント */
export function makeAccount(
  h: TestHarness,
  overrides: Partial<LinkedAccount> & { id: string; email: string },
): LinkedAccount {
  return {
    hd: undefined,
    type: "personal",
    refreshTokenEnc: h.cipher.encrypt(`rt-${overrides.id}`),
    scopes: [],
    status: "ok",
    calendars: [
      {
        id: "primary",
        summary: overrides.email,
        primary: true,
        accessRole: "owner",
        timeZone: "Asia/Tokyo",
      },
    ],
    linkedAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

/** Workspace の A と B、個人の P を連携済みにする */
export async function seedAccounts(h: TestHarness) {
  await h.stores.accounts.upsert(
    "owner-uid",
    makeAccount(h, {
      id: "acc-a",
      email: "a@company-a.example",
      hd: "company-a.example",
      type: "workspace",
      calendars: [
        {
          id: "primary",
          summary: "a",
          primary: true,
          accessRole: "owner",
          timeZone: "Asia/Tokyo",
        },
        {
          id: "team-cal",
          summary: "チーム",
          primary: false,
          accessRole: "writer",
        },
      ],
    }),
  );
  await h.stores.accounts.upsert(
    "owner-uid",
    makeAccount(h, {
      id: "acc-b",
      email: "b@company-b.example",
      hd: "company-b.example",
      type: "workspace",
    }),
  );
  await h.stores.accounts.upsert(
    "owner-uid",
    makeAccount(h, { id: "acc-p", email: "me@gmail.com", type: "personal" }),
  );
}
