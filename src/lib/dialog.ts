import { Alert, Platform } from "react-native";

// ダイアログの共通関数。React Native の Alert.alert は Web（react-native-web）では何も表示しないため、
// Web ではブラウザ標準の alert / confirm を使う。

/** 結果やエラーを知らせる */
export function notify(title: string, message?: string): void {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/** 取り消せない操作の確認。OK なら true */
export function confirmAction(options: {
  title: string;
  message: string;
  confirmLabel: string;
}): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(
      window.confirm(`${options.title}\n\n${options.message}`),
    );
  }
  return new Promise((resolve) => {
    Alert.alert(
      options.title,
      options.message,
      [
        { text: "キャンセル", style: "cancel", onPress: () => resolve(false) },
        {
          text: options.confirmLabel,
          style: "destructive",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
