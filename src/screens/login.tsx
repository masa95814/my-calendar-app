import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { appEnv } from "../config/env";

export default function LoginScreen() {
  const { signIn, signingIn, error } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>カレンダー連携</Text>
      <Text style={styles.description}>
        複数の Google
        アカウントの予定を、他のアカウントに「不在」や「予定あり」として自動で反映します。
      </Text>

      <Pressable
        style={({ pressed }) => [
          styles.button,
          (pressed || signingIn) && styles.buttonPressed,
        ]}
        onPress={signIn}
        disabled={signingIn}
        accessibilityRole="button"
      >
        {signingIn ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.buttonText}>Google でログイン</Text>
        )}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.hint}>接続先: {appEnv.apiBaseUrl}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 32,
    backgroundColor: "#F8F9FA",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#2D4150",
    textAlign: "center",
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: "#666666",
    textAlign: "center",
    marginBottom: 32,
  },
  button: {
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  error: {
    marginTop: 16,
    color: "#D0342C",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  hint: {
    marginTop: 40,
    color: "#999999",
    fontSize: 12,
    textAlign: "center",
  },
});
