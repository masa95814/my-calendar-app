import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { loadConfig, loadDotEnv } from "./config.js";
import { firebaseAuth, getFirebaseApp } from "./lib/firebase.js";
import { logger } from "./lib/logger.js";

loadDotEnv();
const config = loadConfig();

getFirebaseApp(config.GOOGLE_CLOUD_PROJECT);

const app = createApp({
  config,
  verifyIdToken: async (token) => {
    const decoded = await firebaseAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  },
});

serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  logger.info("サーバーを起動しました", {
    port: info.port,
    env: config.NODE_ENV,
    ownerCount: config.OWNER_EMAILS.length,
  });
});
