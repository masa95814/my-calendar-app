import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import {
  api,
  describeApiError,
  type LinkedAccount,
  type SyncRule,
} from "../lib/api";
import {
  groupRulesByPair,
  ruleToInput,
  summarizeRule,
  type AccountPair,
} from "../lib/rules";
import type { RulesStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RulesStackParamList, "RulesList">;

export default function RulesListScreen({ navigation }: Props) {
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [rules, setRules] = useState<SyncRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      Alert.alert("変更できませんでした", describeApiError(caught));
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const { pairs, orphans } = groupRulesByPair(rules, accounts);

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
          アカウントの組み合わせごとに、方向別の同期設定を持てます。「A → B」は
          A の予定を B のカレンダーに反映します。
        </Text>
      )}

      {pairs.map((pair) => (
        <PairCard
          key={pair.key}
          pair={pair}
          onEdit={(ruleId) => navigation.navigate("RuleEditor", { ruleId })}
          onCreate={(sourceAccountId, targetAccountId) =>
            navigation.navigate("RuleEditor", {
              sourceAccountId,
              targetAccountId,
            })
          }
          onToggle={toggleEnabled}
        />
      ))}

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
        </View>
      ) : null}
    </ScrollView>
  );
}

function PairCard({
  pair,
  onEdit,
  onCreate,
  onToggle,
}: {
  pair: AccountPair;
  onEdit: (ruleId: string) => void;
  onCreate: (sourceAccountId: string, targetAccountId: string) => void;
  onToggle: (rule: SyncRule, enabled: boolean) => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>
        {shortName(pair.a)} と {shortName(pair.b)}
      </Text>
      <DirectionRow
        from={pair.a}
        to={pair.b}
        rule={pair.ab}
        onEdit={onEdit}
        onCreate={onCreate}
        onToggle={onToggle}
      />
      <View style={styles.separator} />
      <DirectionRow
        from={pair.b}
        to={pair.a}
        rule={pair.ba}
        onEdit={onEdit}
        onCreate={onCreate}
        onToggle={onToggle}
      />
    </View>
  );
}

function DirectionRow({
  from,
  to,
  rule,
  onEdit,
  onCreate,
  onToggle,
}: {
  from: LinkedAccount;
  to: LinkedAccount;
  rule: SyncRule | undefined;
  onEdit: (ruleId: string) => void;
  onCreate: (sourceAccountId: string, targetAccountId: string) => void;
  onToggle: (rule: SyncRule, enabled: boolean) => void;
}) {
  const direction = `${shortName(from)} → ${shortName(to)}`;
  if (!rule) {
    return (
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle}>{direction}</Text>
          <Text style={styles.rowMeta}>未設定</Text>
        </View>
        <Pressable
          onPress={() => onCreate(from.id, to.id)}
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
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle}>{direction}</Text>
        <Text style={styles.rowMeta}>{summarizeRule(rule)}</Text>
        {rule.lastError ? (
          <Text style={styles.rowError}>エラー: {rule.lastError}</Text>
        ) : null}
      </View>
      <Switch
        value={rule.enabled}
        onValueChange={(value) => onToggle(rule, value)}
      />
    </Pressable>
  );
}

/** メールアドレスのローカル部（@ の前）か、Workspace ならドメインを短く表示する */
function shortName(account: LinkedAccount): string {
  return account.hd ?? account.email.split("@")[0] ?? account.email;
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
});
