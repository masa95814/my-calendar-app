import { createApp, type AppDependencies } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createTokenCipher } from "../src/lib/crypto.js";
import type {
  CalendarSummary,
  GoogleIdentity,
  GoogleOAuth,
  GoogleTokens,
} from "../src/lib/google.js";
import type {
  LinkedAccount,
  OAuthState,
  Stores,
} from "../src/repositories/index.js";
import type { FirebaseUserService } from "../src/routes/auth.js";

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

export type MemoryStores = Stores & {
  states: Map<string, OAuthState>;
  accounts: Stores["accounts"] & { data: Map<string, LinkedAccount> };
  logins: { uid: string; email: string; at: Date }[];
};

/** Firestore の代わりになるメモリ実装 */
export function createMemoryStores(): MemoryStores {
  const states = new Map<string, OAuthState>();
  const accountsData = new Map<string, LinkedAccount>();
  const logins: MemoryStores["logins"] = [];
  const key = (uid: string, id: string) => `${uid}/${id}`;

  return {
    states,
    logins,
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
        return [...accountsData.entries()]
          .filter(([k]) => k.startsWith(`${uid}/`))
          .map(([, v]) => v)
          .sort((a, b) => a.linkedAt.getTime() - b.linkedAt.getTime());
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
  let stateCounter = 0;

  const { env, ...depOverrides } = overrides;
  const app = createApp({
    config: loadConfig({ ...baseEnv, ...env }),
    verifyIdToken: fakeVerifyIdToken,
    google,
    stores,
    firebase,
    cipher,
    now: () => clock.now,
    randomState: () => `state-${++stateCounter}`,
    ...depOverrides,
  });

  return { app, stores, google, firebase, cipher, clock };
}
