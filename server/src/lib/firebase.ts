import {
  applicationDefault,
  getApps,
  initializeApp,
  type App,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App | undefined;

/**
 * Firebase Admin SDK を初期化する（複数回呼んでも 1 回だけ初期化する）。
 * 認証情報は Application Default Credentials を使う。
 * - Cloud Run: サービスアカウントが自動で使われる
 * - ローカル: `gcloud auth application-default login`、または
 *   FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST でエミュレータに接続する
 * 認証情報の取得は最初に使うときまで遅延されるため、ヘルスチェックだけなら認証なしでも起動できる。
 */
export function getFirebaseApp(projectId?: string): App {
  if (app) {
    return app;
  }
  const existing = getApps()[0];
  app =
    existing ??
    initializeApp({
      credential: applicationDefault(),
      ...(projectId ? { projectId } : {}),
    });
  return app;
}

export function firestore(): Firestore {
  return getFirestore(getFirebaseApp());
}

export function firebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}
