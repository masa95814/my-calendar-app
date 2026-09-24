import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Linking from "expo-linking";

import { openAuthSession } from "../auth/AuthProvider";
import { TextField } from "../components/form";
import { accountName } from "../lib/accounts";
import { api, describeApiError, type LinkedAccount } from "../lib/api";
import { confirmAction, notify } from "../lib/dialog";
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
        notify("連携できませんでした", describeAuthError(result.code));
      } else if (result.kind === "success") {
        await load();
        notify("連携しました", result.params.linked ?? "");
      }
    } catch (caught) {
      notify("連携できませんでした", describeApiError(caught));
    } finally {
      setLinking(false);
    }
  };

  const confirmUnlink = async (account: LinkedAccount) => {
    const ok = await confirmAction({
      title: "連携を解除しますか？",
      message: `${account.email} のカレンダーへのアクセス権を取り消します。このアカウントに作成したミラー予定も削除し、関わる同期設定は無効になります。`,
      confirmLabel: "解除する",
    });
    if (!ok) {
      return;
    }
    try {
      await api.unlinkAccount(account.id);
      await load();
    } catch (caught) {
      notify("解除できませんでした", describeApiError(caught));
    }
  };

  const rename = async (account: LinkedAccount, label: string) => {
    try {
      const { account: saved } = await api.updateAccount(account.id, {
        label: label.trim() || null,
      });
      setAccounts((prev) => prev.map((a) => (a.id === saved.id ? saved : a)));
      return true;
    } catch (caught) {
      notify("名前を変更できませんでした", describeApiError(caught));
      return false;
    }
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
          <AccountRow
            account={item}
            onRename={(label) => rename(item, label)}
            onUnlink={() => confirmUnlink(item)}
          />
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
  onRename,
  onUnlink,
}: {
  account: LinkedAccount;
  onRename: (label: string) => Promise<boolean>;
  onUnlink: () => void;
}) {
  const isWorkspace = account.type === "workspace";
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(account.label ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const ok = await onRename(text);
    setSaving(false);
    if (ok) {
      setEditing(false);
    }
  };

  return (
    <View style={styles.row}>
      <View style={styles.rowMain}>
        {editing ? (
          <View style={styles.renameRow}>
            <TextField
              value={text}
              onChangeText={setText}
              placeholder={accountName({ ...account, label: undefined })}
              maxLength={30}
              autoFocus
              onSubmitEditing={save}
              style={styles.renameInput}
            />
            <Pressable onPress={save} disabled={saving} hitSlop={8}>
              <Text style={styles.renameAction}>
                {saving ? "保存中" : "保存"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setText(account.label ?? "");
                setEditing(false);
              }}
              hitSlop={8}
            >
              <Text style={styles.renameCancel}>やめる</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.nameRow}>
            <Text style={styles.name}>{accountName(account)}</Text>
            <Pressable
              onPress={() => {
                setText(account.label ?? "");
                setEditing(true);
              }}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.renameAction}>名前を変更</Text>
            </Pressable>
          </View>
        )}
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
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2D4150",
  },
  renameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  renameInput: {
    flex: 1,
  },
  renameAction: {
    color: "#007AFF",
    fontSize: 13,
    fontWeight: "600",
  },
  renameCancel: {
    color: "#666666",
    fontSize: 13,
  },
  email: {
    marginTop: 2,
    fontSize: 13,
    color: "#666666",
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
