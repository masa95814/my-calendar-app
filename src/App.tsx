import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { AuthProvider } from "./auth/AuthProvider";
import { appEnv } from "./config/env";
import RootNavigator from "./navigation/RootNavigator";

/** アプリのルート。ログイン状態の管理と画面遷移を組み立てる */
export default function App() {
  return (
    <SafeAreaProvider>
      {appEnv.mock ? <MockBanner /> : null}
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

/** モック表示であることを常に出す（本物の設定と取り違えないように） */
function MockBanner() {
  return (
    <SafeAreaView edges={["top"]} style={styles.banner}>
      <View>
        <Text style={styles.bannerText}>
          モック表示（見本のデータ）です。本物のカレンダーや同期設定にはつながっていません
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#FBBC04",
  },
  bannerText: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "600",
    color: "#3C2A00",
  },
});
