import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { PrimaryButton } from "../components/form";
import { accountName } from "../lib/accounts";
import {
  api,
  describeApiError,
  describeSyncSummary,
  type LinkedAccount,
  type SyncRule,
} from "../lib/api";
import { formatDateTime } from "../lib/dates";
import { notify } from "../lib/dialog";
import {
  defaultRuleName,
  orphanRules,
  ruleToInput,
  summarizeRule,
  targetsForSource,
  type TargetEntry,
} from "../lib/rules";
import type { RulesStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RulesStackParamList, "RulesList">;

export default function RulesListScreen({ navigation }: Props) {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [rules, setRules] = useState<SyncRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);

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

  const load = useCallback(async () => {
    try {
      const [a, r] = await Promise.all([api.listAccounts(), api.listRules()]);
      setAccounts(a.accounts);
      setRules(r.rules);
      setError(null);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 編集画面から戻ったときにも再取得する
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggleEnabled = async (rule: SyncRule, enabled: boolean) => {
    // 先に画面へ反映し、失敗したら戻す
    setRules((prev) =>
      prev.map((r) => (r.id === rule.id ? { ...r, enabled } : r)),
    );
    try {
      const { rule: saved } = await api.updateRule(rule.id, {
        ...ruleToInput(rule),
        enabled,
      });
      setRules((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
    } catch (caught) {
      setRules((prev) => prev.map((r) => (r.id === rule.id ? rule : r)));
      notify("変更できませんでした", describeApiError(caught));
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const orphans = orphanRules(rules, accounts);
  // 選んだ同期元が無ければ（初回・連携解除後）、同期設定のあるアカウントか先頭を選ぶ
  const source =
    accounts.find((a) => a.id === sourceId) ??
    accounts.find((a) => rules.some((r) => r.source.accountId === a.id)) ??
    accounts[0];
  const targets = source ? targetsForSource(source, rules, accounts) : [];

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

      {accounts.length < 2 ? (
        <Text style={styles.empty}>
          同期には 2 つ以上の Google
          アカウントの連携が必要です。「アカウント」タブから追加してください。
        </Text>
      ) : (
        <Text style={styles.intro}>
          同期元を選ぶと、その予定をどのアカウントに反映しているかが見られます。
        </Text>
      )}

      {accounts.length >= 2 && source ? (
        <>
          <Text style={styles.label}>同期元</Text>
          <View style={styles.chips}>
            {accounts.map((account) => {
              const active = rules.filter(
                (r) => r.source.accountId === account.id && r.enabled,
              ).length;
              const selected = account.id === source.id;
              return (
                <Pressable
                  key={account.id}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setSourceId(account.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <View style={[styles.dot, active > 0 && styles.dotActive]} />
                  <Text
                    style={[
                      styles.chipText,
                      selected && styles.chipTextSelected,
                    ]}
                  >
                    {accountName(account)}
                  </Text>
                  {active > 0 ? (
                    <Text
                      style={[
                        styles.chipCount,
                        selected && styles.chipTextSelected,
                      ]}
                    >
                      {active}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>
            {accountName(source)} の予定を反映する先
          </Text>
          <View style={styles.card}>
            {targets.map((entry, index) => (
              <View key={entry.target.id}>
                {index > 0 ? <View style={styles.separator} /> : null}
                <TargetRow
                  source={source}
                  entry={entry}
                  onEdit={(ruleId) =>
                    navigation.navigate("RuleEditor", { ruleId })
                  }
                  onCreate={(targetAccountId) =>
                    navigation.navigate("RuleEditor", {
                      sourceAccountId: source.id,
                      targetAccountId,
                    })
                  }
                  onToggle={toggleEnabled}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}

      {orphans.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>連携が解除されたアカウントの設定</Text>
          {orphans.map((rule) => (
            <Pressable
              key={rule.id}
              style={styles.row}
              onPress={() =>
                navigation.navigate("RuleEditor", { ruleId: rule.id })
              }
            >
              <View style={styles.rowMain}>
                <Text style={styles.rowTitle}>{rule.name}</Text>
                <Text style={styles.rowMeta}>
                  アカウント未連携のため無効。開いて削除できます
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}

      {accounts.length >= 2 ? (
        <View style={styles.footer}>
          <PrimaryButton
            title="同期設定を追加"
            onPress={() => navigation.navigate("RuleEditor", {})}
          />
          {rules.length > 0 ? (
            <Pressable
              style={styles.syncNow}
              onPress={syncNow}
              disabled={syncing}
              accessibilityRole="button"
            >
              <Text style={styles.syncNowText}>
                {syncing ? "同期中..." : "今すぐ同期（全設定）"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function TargetRow({
  source,
  entry,
  onEdit,
  onCreate,
  onToggle,
}: {
  source: LinkedAccount;
  entry: TargetEntry;
  onEdit: (ruleId: string) => void;
  onCreate: (targetAccountId: string) => void;
  onToggle: (rule: SyncRule, enabled: boolean) => void;
}) {
  const { target, rule, reverse } = entry;
  // 逆方向の設定があるかを小さく出す（同期元を切り替えなくても分かるように）
  const reverseText = reverse
    ? `逆方向（${accountName(target)} → ${accountName(source)}）: ${reverse.enabled ? "ON" : "OFF"}`
    : `逆方向（${accountName(target)} → ${accountName(source)}）: 未設定`;
  if (!rule) {
    return (
      <View style={styles.row}>
        <View style={[styles.dot, styles.rowDot]} />
        <View style={styles.rowMain}>
          <Text style={[styles.rowTitle, styles.rowTitleUnset]}>
            {accountName(target)}
          </Text>
          <Text style={styles.rowMeta}>未設定</Text>
          <Text style={styles.rowReverse}>{reverseText}</Text>
        </View>
        <Pressable
          onPress={() => onCreate(target.id)}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.link}>追加</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      style={styles.row}
      onPress={() => onEdit(rule.id)}
      accessibilityRole="button"
    >
      <View
        style={[styles.dot, styles.rowDot, rule.enabled && styles.dotActive]}
      />
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{accountName(target)}</Text>
        {rule.name && rule.name !== defaultRuleName(source, target) ? (
          <Text style={styles.rowName}>{rule.name}</Text>
        ) : null}
        <Text style={styles.rowMeta}>{summarizeRule(rule)}</Text>
        <Text style={styles.rowMeta}>
          最終同期: {formatDateTime(rule.lastSyncAt)}
        </Text>
        {rule.lastError ? (
          <Text style={styles.rowError}>エラー: {rule.lastError}</Text>
        ) : null}
        <Text style={styles.rowReverse}>{reverseText}</Text>
      </View>
      <Switch
        value={rule.enabled}
        onValueChange={(value) => onToggle(rule, value)}
      />
    </Pressable>
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
  intro: {
    fontSize: 13,
    color: "#666666",
    lineHeight: 18,
    marginBottom: 16,
  },
  empty: {
    fontSize: 14,
    color: "#666666",
    lineHeight: 20,
    paddingVertical: 16,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888888",
    marginBottom: 8,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  chipSelected: {
    backgroundColor: "#1A73E8",
    borderColor: "#1A73E8",
  },
  chipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2D4150",
  },
  chipTextSelected: {
    color: "#FFFFFF",
  },
  chipCount: {
    fontSize: 12,
    color: "#666666",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#C4C4C4",
  },
  dotActive: {
    backgroundColor: "#34A853",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888888",
    paddingVertical: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  rowMain: {
    flex: 1,
    paddingRight: 12,
  },
  rowDot: {
    marginRight: 12,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2D4150",
  },
  rowTitleUnset: {
    color: "#999999",
  },
  rowName: {
    marginTop: 2,
    fontSize: 13,
    color: "#2D4150",
  },
  rowReverse: {
    marginTop: 4,
    fontSize: 11,
    color: "#999999",
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
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E0E0E0",
  },
  link: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "600",
  },
  footer: {
    marginTop: 8,
  },
  syncNow: {
    marginTop: 12,
    alignItems: "center",
    paddingVertical: 10,
  },
  syncNowText: {
    color: "#007AFF",
    fontSize: 14,
    fontWeight: "600",
  },
});
