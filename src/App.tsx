import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "./auth/AuthProvider";
import RootNavigator from "./navigation/RootNavigator";

/** アプリのルート。ログイン状態の管理と画面遷移を組み立てる */
export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
