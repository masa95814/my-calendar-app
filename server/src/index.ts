import { serve } from "@hono/node-server";
import { OAuth2Client } from "google-auth-library";

import { createApp } from "./app.js";
import { loadConfig, loadDotEnv } from "./config.js";
import { createCalendarClientFactory } from "./lib/calendar.js";
import { createTokenCipher } from "./lib/crypto.js";
import { firebaseAuth, firestore, getFirebaseApp } from "./lib/firebase.js";
import { createGoogleOAuth } from "./lib/google.js";
import { logger } from "./lib/logger.js";
import { createFirestoreStores } from "./repositories/firestore.js";
import type { FirebaseUserService } from "./routes/auth.js";

loadDotEnv();
const config = loadConfig();

getFirebaseApp(config.GOOGLE_CLOUD_PROJECT);

const cipher = createTokenCipher(config.TOKEN_ENCRYPTION_KEY);
if (!config.TOKEN_ENCRYPTION_KEY) {
  logger.warn(
    "TOKEN_ENCRYPTION_KEY が未設定のため、リフレッシュトークンを暗号化せずに保存します（開発用）",
  );
}

const firebase: FirebaseUserService = {
  async ensureUser(uid, email) {
    const auth = firebaseAuth();
    try {
      await auth.getUser(uid);
    } catch {
      await auth.createUser({ uid, email, emailVerified: true });
    }
  },
  createCustomToken: (uid) => firebaseAuth().createCustomToken(uid),
};

const calendarClientFactory = createCalendarClientFactory({
  clientId: config.GOOGLE_OAUTH_CLIENT_ID,
  clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
});

// 予算アラートの Pub/Sub push に付く ID トークンを検証する（送信元のサービスアカウントと宛先 URL を確認）
const pushTokenVerifier = new OAuth2Client();
const budgetAudience = config.PUBLIC_BASE_URL
  ? `${config.PUBLIC_BASE_URL}/webhooks/budget`
  : undefined;

const app = createApp({
  config,
  cipher,
  google: createGoogleOAuth({
    clientId: config.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: config.OAUTH_REDIRECT_URI,
  }),
  stores: createFirestoreStores(firestore()),
  firebase,
  calendarFor: (account) =>
    calendarClientFactory(cipher.decrypt(account.refreshTokenEnc)),
  verifyIdToken: async (token) => {
    const decoded = await firebaseAuth().verifyIdToken(token);
    // カスタムトークンでログインしたユーザーの ID トークンには email が無いことがあるため、ユーザー情報から補う
    const email =
      decoded.email ?? (await firebaseAuth().getUser(decoded.uid)).email;
    return { uid: decoded.uid, email };
  },
  ...(config.BUDGET_PUSH_SA_EMAIL && budgetAudience
    ? {
        verifyPushToken: async (idToken: string) => {
          try {
            const ticket = await pushTokenVerifier.verifyIdToken({
              idToken,
              audience: budgetAudience,
            });
            const payload = ticket.getPayload();
            return payload?.email_verified &&
              payload.email === config.BUDGET_PUSH_SA_EMAIL
              ? payload.email
              : undefined;
          } catch {
            return undefined;
          }
        },
      }
    : {}),
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info("サーバーを起動しました", {
    port: info.port,
    env: config.NODE_ENV,
    ownerCount: config.OWNER_EMAILS.length,
    redirectUri: config.OAUTH_REDIRECT_URI,
    watch: config.PUBLIC_BASE_URL ? "enabled" : "disabled (polling only)",
    tasksAuth: config.TASKS_SECRET ? "secret" : "open (development)",
  });
});
