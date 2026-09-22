import { serve } from "@hono/node-server";

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
