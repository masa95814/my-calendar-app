import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  signOut as firebaseSignOut,
  onAuthStateChanged,
  signInWithCustomToken,
  type User,
} from "firebase/auth";

import { appEnv } from "../config/env";
import { loginStartUrl } from "../lib/api";
import { notify } from "../lib/dialog";
import { describeAuthError } from "../lib/errorMessages";
import { auth } from "../lib/firebase";

const isWeb = Platform.OS === "web";

/**
 * Web で Google から戻ってきたときの結果（URL のクエリ）を取り出し、URL から消す。
 * Web はポップアップを使わず同じタブで移動するため、結果はページの読み込み時に受け取る。
 */
function consumeWebRedirectResult():
  | { path: string; params: Record<string, string> }
  | undefined {
  if (!isWeb || typeof window === "undefined") {
    return undefined;
  }
  const url = new URL(window.location.href);
  const keys = ["token", "linked", "error"];
  if (!keys.some((key) => url.searchParams.has(key))) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (const key of keys) {
    const value = url.searchParams.get(key);
    if (value !== null) {
      params[key] = value;
    }
  }
  // トークンを URL に残さない（履歴やブックマークに残らないようにする）
  window.history.replaceState(null, "", "/");
  return { path: url.pathname, params };
}

type AuthState = {
  user: User | null;
  /** 端末に保存されたログイン状態の読み込み中 */
  initializing: boolean;
  signingIn: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * ブラウザでバックエンドのログイン開始 URL を開き、戻ってきた URL からトークンを取り出す。
 * 成功時は Firebase のカスタムトークン、失敗時は error コードが付いて戻る（server/README.md 参照）。
 */
export async function openAuthSession(
  startUrl: string,
  returnTo: string,
): Promise<
  | { kind: "cancelled" }
  | { kind: "error"; code: string }
  | { kind: "success"; params: Record<string, string> }
> {
  if (isWeb) {
    // Google のログイン画面はポップアップと元の画面のつながりを切る（COOP）ため、
    // Web ではポップアップを使わず同じタブで移動する。結果は戻ってきたページの読み込み時に受け取る
    window.location.assign(startUrl);
    return new Promise(() => {});
  }
  const result = await WebBrowser.openAuthSessionAsync(startUrl, returnTo);
  if (result.type !== "success") {
    return { kind: "cancelled" };
  }
  const { queryParams } = Linking.parse(result.url);
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(queryParams ?? {})) {
    if (typeof value === "string") {
      params[key] = value;
    }
  }
  if (params.error) {
    return { kind: "error", code: params.error };
  }
  return { kind: "success", params };
}

/** モック表示でのログイン中のユーザー（画面に出す項目だけを持つ） */
const MOCK_USER = { uid: "mock", email: "me@example.com" } as User;

export function AuthProvider({ children }: { children: ReactNode }) {
  // モック表示ではログインを省き、最初からログイン済みとして扱う
  const [user, setUser] = useState<User | null>(appEnv.mock ? MOCK_USER : null);
  const [initializing, setInitializing] = useState(!appEnv.mock);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (appEnv.mock) {
      return;
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setInitializing(false);
    });
  }, []);

  // Web: Google から戻ってきたページの読み込み時に、ログインまたは連携の結果を処理する
  useEffect(() => {
    const result = consumeWebRedirectResult();
    if (!result) {
      return;
    }
    const { path, params } = result;
    if (path.startsWith("/accounts")) {
      if (params.error) {
        notify("連携できませんでした", describeAuthError(params.error));
      } else if (params.linked) {
        notify("連携しました", params.linked);
      }
      return;
    }
    if (params.error) {
      setError(describeAuthError(params.error));
      return;
    }
    if (params.token) {
      setSigningIn(true);
      signInWithCustomToken(auth, params.token)
        .catch((caught: unknown) =>
          setError(
            caught instanceof Error
              ? `ログインに失敗しました: ${caught.message}`
              : "ログインに失敗しました。",
          ),
        )
        .finally(() => setSigningIn(false));
    }
  }, []);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    setError(null);
    try {
      // Expo Go なら exp://.../--/auth、開発ビルドなら mycalendarapp://auth、Web なら http://localhost:8081/auth
      const returnTo = Linking.createURL("auth");
      const result = await openAuthSession(loginStartUrl(returnTo), returnTo);
      if (result.kind === "cancelled") {
        return;
      }
      if (result.kind === "error") {
        setError(describeAuthError(result.code));
        return;
      }
      const token = result.params.token;
      if (!token) {
        setError("ログイン用のトークンを受け取れませんでした。");
        return;
      }
      await signInWithCustomToken(auth, token);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `ログインに失敗しました: ${caught.message}`
          : "ログインに失敗しました。",
      );
    } finally {
      setSigningIn(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    if (appEnv.mock) {
      notify("モック表示ではログアウトできません");
      return;
    }
    await firebaseSignOut(auth);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, initializing, signingIn, error, signIn, signOut }),
    [user, initializing, signingIn, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth は AuthProvider の中で使ってください");
  }
  return context;
}
