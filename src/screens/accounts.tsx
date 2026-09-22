import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Linking from "expo-linking";

import { openAuthSession } from "../auth/AuthProvider";
import { api, describeApiError, type LinkedAccount } from "../lib/api";
import { describeAuthError } from "../lib/errorMessages";

export default function AccountsScreen() {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { accounts: list } = await api.listAccounts();
      setAccounts(list);
      setError(null);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addAccount = async () => {
    setLinking(true);
    try {
      const returnTo = Linking.createURL("accounts");
      const { url } = await api.startLink(returnTo);
      const result = await openAuthSession(url, returnTo);
      if (result.kind === "error") {
        Alert.alert("連携できませんでした", describeAuthError(result.code));
      } else if (result.kind === "success") {
        await load();
        Alert.alert("連携しました", result.params.linked ?? "");
      }
    } catch (caught) {
      Alert.alert("連携できませんでした", describeApiError(caught));
    } finally {
      setLinking(false);
    }
  };

  const confirmUnlink = (account: LinkedAccount) => {
    Alert.alert(
      "連携を解除しますか？",
      `${account.email} のカレンダーへのアクセス権を取り消します。`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "解除する",
          style: "destructive",
          onPress: async () => {
            try {
              await api.unlinkAccount(account.id);
              await load();
            } catch (caught) {
              Alert.alert("解除できませんでした", describeApiError(caught));
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={accounts}
        keyExtractor={(account) => account.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.sectionTitle}>連携アカウント</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            まだアカウントが連携されていません。下のボタンから Google
            アカウントを追加してください。
          </Text>
        }
        renderItem={({ item }) => (
          <AccountRow account={item} onUnlink={() => confirmUnlink(item)} />
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                (pressed || linking) && styles.buttonPressed,
              ]}
              onPress={addAccount}
              disabled={linking}
              accessibilityRole="button"
            >
              {linking ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  Google アカウントを追加
                </Text>
              )}
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

function AccountRow({
  account,
  onUnlink,
}: {
  account: LinkedAccount;
  onUnlink: () => void;
}) {
  const isWorkspace = account.type === "workspace";
  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        <Text style={styles.email}>{account.email}</Text>
        <View style={styles.badges}>
          <Text
            style={[
              styles.badge,
              isWorkspace ? styles.badgeWorkspace : styles.badgePersonal,
            ]}
          >
            {isWorkspace ? `Workspace（${account.hd ?? ""}）` : "個人"}
          </Text>
          {account.status === "reauth_required" ? (
            <Text style={[styles.badge, styles.badgeWarning]}>
              再認証が必要
            </Text>
          ) : null}
        </View>
        <Text style={styles.meta}>
          カレンダー {account.calendars.length} 件
          {isWorkspace ? "・不在を作成できます" : "・予定ありのみ"}
        </Text>
      </View>
      <Pressable onPress={onUnlink} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.unlink}>解除</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333333",
  },
  error: {
    marginTop: 8,
    color: "#D0342C",
    fontSize: 14,
  },
  empty: {
    color: "#666666",
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    padding: 16,
    marginBottom: 10,
  },
  rowMain: {
    flex: 1,
  },
  email: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2D4150",
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
  },
  badge: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: "hidden",
  },
  badgeWorkspace: {
    backgroundColor: "#E3F2FD",
    color: "#007AFF",
  },
  badgePersonal: {
    backgroundColor: "#EFEFEF",
    color: "#666666",
  },
  badgeWarning: {
    backgroundColor: "#FFF3E0",
    color: "#E65100",
  },
  meta: {
    marginTop: 6,
    fontSize: 12,
    color: "#666666",
  },
  unlink: {
    color: "#D0342C",
    fontSize: 14,
    fontWeight: "600",
    paddingLeft: 12,
  },
  footer: {
    marginTop: 12,
    alignItems: "center",
  },
  primaryButton: {
    alignSelf: "stretch",
    backgroundColor: "#007AFF",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonPressed: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
});
