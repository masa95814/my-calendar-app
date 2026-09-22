import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import * as firebaseAuth from "firebase/auth";
import {
  connectAuthEmulator,
  getAuth,
  initializeAuth,
  type Auth,
} from "firebase/auth";

import { appEnv } from "../config/env";

// getReactNativePersistence は React Native 向けビルドにだけ含まれ、型定義からは見えないため、ここで型を補う
const { getReactNativePersistence } = firebaseAuth as unknown as {
  getReactNativePersistence: (
    storage: typeof AsyncStorage,
  ) => firebaseAuth.Persistence;
};

function createAuth(): Auth {
  const app = getApps().length > 0 ? getApp() : initializeApp(appEnv.firebase);

  let auth: Auth;
  if (Platform.OS === "web") {
    auth = getAuth(app);
  } else {
    try {
      // ログイン状態を端末に保存し、アプリを再起動してもログインを維持する
      auth = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } catch {
      // Fast Refresh などで 2 回目に呼ばれた場合は初期化済みのものを使う
      auth = getAuth(app);
    }
  }

  if (appEnv.firebaseAuthEmulatorHost) {
    connectAuthEmulator(auth, `http://${appEnv.firebaseAuthEmulatorHost}`, {
      disableWarnings: true,
    });
  }
  return auth;
}

/** アプリ全体で共有する Firebase Auth インスタンス */
export const auth = createAuth();
