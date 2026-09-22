import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";

import { useAuth } from "../auth/AuthProvider";
import { PrimaryButton, Section } from "../components/form";
import { appEnv } from "../config/env";
import {
  api,
  describeApiError,
  describeSyncSummary,
  type StatusResponse,
} from "../lib/api";
import { formatDateTime } from "../lib/dates";
import { confirmAction, notify } from "../lib/dialog";

/** 設定（F7 の状態表示、手動同期、ログアウト、復旧操作） */
export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await api.status());
      setError(null);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { summary } = await api.syncAll();
      notify("同期が完了しました", describeSyncSummary(summary));
      await load();
    } catch (caught) {
      notify("同期できませんでした", describeApiError(caught));
    } finally {
      setSyncing(false);
    }
  };

  const confirmPurge = async (accountId: string, email: string) => {
    const ok = await confirmAction({
      title: "ミラー予定を一括削除しますか？",
      message: `${email} のメインカレンダーにある、このアプリが作成したすべての予定を削除します。対応表が失われた場合の復旧用です。`,
      confirmLabel: "削除する",
    });
    if (!ok) {
      return;
    }
    try {
      const result = await api.purgeMirrors(accountId);
      notify(
        "削除しました",
        `予定 ${result.deletedEvents} 件、対応表 ${result.deletedRecords} 件`,
      );
    } catch (caught) {
      notify("削除できませんでした", describeApiError(caught));
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const accountEmail = (id: string) =>
    status?.accounts.find((a) => a.id === id)?.email ?? id;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load();
          }}
        />
      }
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Section title="同期">
        <View style={styles.row}>
          <PrimaryButton
            title={syncing ? "同期中..." : "今すぐ同期（全設定）"}
            onPress={syncNow}
            disabled={syncing}
          />
          <Text style={styles.help}>
            通常は 10
            分ごとに自動で同期されます。すぐに反映したいときに使ってください。
          </Text>
        </View>
      </Section>

      <Section title="同期設定の状態">
        {status?.rules.length ? (
          status.rules.map((rule) => (
            <View key={rule.id} style={styles.row}>
              <Text style={styles.rowTitle}>
                {rule.name}
                {rule.enabled ? "" : "（無効）"}
              </Text>
              <Text style={styles.rowMeta}>
                最終同期: {formatDateTime(rule.lastSyncAt)}
              </Text>
              {rule.lastError ? (
                <Text style={styles.rowError}>エラー: {rule.lastError}</Text>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.empty}>同期設定はまだありません</Text>
        )}
      </Section>

      <Section title="送信元カレンダーの同期状態">
        {status?.syncStates.length ? (
          status.syncStates.map((state) => (
            <View
              key={`${state.accountId}:${state.calendarId}`}
              style={styles.row}
            >
              <Text style={styles.rowTitle}>
                {accountEmail(state.accountId)}
              </Text>
              <Text style={styles.rowMeta}>
                全件: {formatDateTime(state.lastFullSyncAt)} / 差分:{" "}
                {formatDateTime(state.lastIncrementalSyncAt)}
              </Text>
              <Text style={styles.rowMeta}>
                変更通知:{" "}
                {state.watchActive ? "有効" : "無効（ポーリングのみ）"}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.empty}>まだ同期していません</Text>
        )}
      </Section>

      <Section title="連携アカウント">
        {status?.accounts.map((account) => (
          <View key={account.id} style={styles.row}>
            <Text style={styles.rowTitle}>{account.email}</Text>
            <Text style={styles.rowMeta}>
              {account.type === "workspace" ? "Workspace" : "個人"}・カレンダー{" "}
              {account.calendarCount} 件
              {account.status === "reauth_required" ? "・再認証が必要" : ""}
            </Text>
            <Pressable
              onPress={() => confirmPurge(account.id, account.email)}
              accessibilityRole="button"
            >
              <Text style={styles.link}>
                このアカウントのミラー予定を一括削除（復旧用）
              </Text>
            </Pressable>
          </View>
        ))}
      </Section>

      <Section title="アプリ">
        <View style={styles.row}>
          <Text style={styles.rowMeta}>
            ログイン中: {user?.email ?? user?.uid}
          </Text>
          <Text style={styles.rowMeta}>接続先: {appEnv.apiBaseUrl}</Text>
        </View>
        <View style={styles.row}>
          <PrimaryButton title="ログアウト" onPress={signOut} destructive />
        </View>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    color: "#D0342C",
    marginBottom: 12,
  },
  row: {
    paddingVertical: 10,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2D4150",
  },
  rowMeta: {
    marginTop: 4,
    fontSize: 12,
    color: "#666666",
  },
  rowError: {
    marginTop: 4,
    fontSize: 12,
    color: "#D0342C",
  },
  help: {
    marginTop: 8,
    fontSize: 12,
    color: "#888888",
    lineHeight: 16,
  },
  empty: {
    fontSize: 13,
    color: "#999999",
    paddingVertical: 10,
  },
  link: {
    marginTop: 6,
    fontSize: 12,
    color: "#D0342C",
  },
});
