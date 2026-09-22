import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  signOut as firebaseSignOut,
  onAuthStateChanged,
  signInWithCustomToken,
  type User,
} from "firebase/auth";

import { loginStartUrl } from "../lib/api";
import { describeAuthError } from "../lib/errorMessages";
import { auth } from "../lib/firebase";

// Web では、リダイレクト先で開いたページがポップアップを閉じて結果を返すために必要
WebBrowser.maybeCompleteAuthSession();

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setInitializing(false);
    });
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
