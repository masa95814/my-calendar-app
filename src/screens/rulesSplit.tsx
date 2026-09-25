import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { accountName } from "../lib/accounts";
import type { LinkedAccount, SyncRule } from "../lib/api";
import {
  OUTPUT_KIND_LABELS,
  targetsForSource,
  type TargetEntry,
} from "../lib/rules";
import { RuleEditor } from "./ruleEditor";

// 広い画面（Web 版のパソコンなど）向けの同期設定の画面。
// 左に同期元、中央に同期先を並べて線でつなぎ（Lynx の連携設定画面を参考）、右で選んだ組み合わせを編集する。

/** 行の高さと間隔。線の位置を計算するため固定にする */
const ROW = 64;
const GAP = 10;
const LINK_WIDTH = 56;
const GREEN = "#34A853";
const GRAY = "#BDC1C6";

const centerOf = (index: number) => index * (ROW + GAP) + ROW / 2;

export function RulesSplitView({
  accounts,
  rules,
  source,
  onSelectSource,
  onChanged,
  footer,
}: {
  accounts: LinkedAccount[];
  rules: SyncRule[];
  source: LinkedAccount;
  onSelectSource: (accountId: string) => void;
  /** 保存・削除のあとに一覧を取り直す */
  onChanged: () => void;
  /** 一覧の下に出すもの（連携解除されたアカウントの設定、今すぐ同期など） */
  footer?: ReactNode;
}) {
  const targets = targetsForSource(source, rules, accounts);
  const [targetId, setTargetId] = useState<string | null>(null);
  // 選んだ同期先が無ければ（初回・同期元の切り替え後）、設定のある先か先頭を選ぶ
  const selected =
    targets.find((t) => t.target.id === targetId) ??
    targets.find((t) => t.rule) ??
    targets[0];

  const selectSource = (accountId: string) => {
    setTargetId(null);
    onSelectSource(accountId);
  };

  const sourceIndex = accounts.findIndex((a) => a.id === source.id);
  const height = Math.max(accounts.length, targets.length) * (ROW + GAP) - GAP;

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.listPane}
        contentContainerStyle={styles.listContent}
      >
        <Text style={styles.intro}>
          左で同期元を選ぶと、その予定を反映している同期先と線でつながります。同期先を選ぶと、右で設定できます。
        </Text>
        <View style={styles.columns}>
          <Text style={[styles.columnLabel, styles.sourceColumn]}>
            同期元（この予定を）
          </Text>
          <View style={{ width: LINK_WIDTH }} />
          <Text style={[styles.columnLabel, styles.targetColumn]}>
            同期先（ここに反映）
          </Text>
        </View>
        <View style={styles.columns}>
          <View style={styles.sourceColumn}>
            {accounts.map((account) => {
              const active = rules.filter(
                (r) => r.source.accountId === account.id && r.enabled,
              ).length;
              const isSelected = account.id === source.id;
              return (
                <Pressable
                  key={account.id}
                  style={[styles.box, isSelected && styles.sourceSelected]}
                  onPress={() => selectSource(account.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <View style={[styles.dot, active > 0 && styles.dotActive]} />
                  <View style={styles.boxMain}>
                    <Text
                      style={[styles.boxTitle, isSelected && styles.textOnBlue]}
                      numberOfLines={1}
                    >
                      {accountName(account)}
                    </Text>
                    <Text
                      style={[styles.boxMeta, isSelected && styles.textOnBlue]}
                      numberOfLines={1}
                    >
                      {active > 0 ? `${active} 件に反映中` : "反映なし"}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          <Links sourceIndex={sourceIndex} targets={targets} height={height} />

          <View style={styles.targetColumn}>
            {targets.map((entry) => (
              <TargetBox
                key={entry.target.id}
                entry={entry}
                selected={entry.target.id === selected?.target.id}
                onPress={() => setTargetId(entry.target.id)}
              />
            ))}
          </View>
        </View>
        {footer}
      </ScrollView>

      <View style={styles.editorPane}>
        {selected ? (
          <RuleEditor
            // 組み合わせや同期設定が変わったら作り直す（新規作成の保存後は編集に切り替わる）
            key={`${source.id}>${selected.target.id}:${selected.rule?.id ?? "new"}`}
            embedded
            {...(selected.rule
              ? { ruleId: selected.rule.id }
              : {
                  sourceAccountId: source.id,
                  targetAccountId: selected.target.id,
                })}
            onDone={onChanged}
          />
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>
              同期先を選ぶと、ここで設定できます
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

/** 同期元と同期先をつなぐ線。有効なら緑、無効なら灰色、未設定なら線なし */
function Links({
  sourceIndex,
  targets,
  height,
}: {
  sourceIndex: number;
  targets: TargetEntry[];
  height: number;
}) {
  const from = centerOf(sourceIndex);
  const mid = LINK_WIDTH / 2;
  const linked = targets
    .map((entry, index) => ({ entry, to: centerOf(index) }))
    .filter(({ entry }) => entry.rule)
    // 緑の線が灰色の線の上に来るように、無効を先に描く
    .sort(
      (a, b) =>
        Number(a.entry.rule?.enabled ?? false) -
        Number(b.entry.rule?.enabled ?? false),
    );
  const anyEnabled = linked.some(({ entry }) => entry.rule?.enabled);
  return (
    <View style={{ width: LINK_WIDTH, height }}>
      {linked.length > 0 ? (
        <View
          style={[
            styles.line,
            {
              left: 0,
              top: from - 1,
              width: mid + 1,
              height: 2,
              backgroundColor: anyEnabled ? GREEN : GRAY,
            },
          ]}
        />
      ) : null}
      {linked.map(({ entry, to }) => {
        const color = entry.rule?.enabled ? GREEN : GRAY;
        return (
          <View key={entry.target.id}>
            <View
              style={[
                styles.line,
                {
                  left: mid - 1,
                  top: Math.min(from, to) - 1,
                  width: 2,
                  height: Math.abs(to - from) + 2,
                  backgroundColor: color,
                },
              ]}
            />
            <View
              style={[
                styles.line,
                {
                  left: mid - 1,
                  top: to - 1,
                  width: LINK_WIDTH - mid + 1,
                  height: 2,
                  backgroundColor: color,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

function TargetBox({
  entry,
  selected,
  onPress,
}: {
  entry: TargetEntry;
  selected: boolean;
  onPress: () => void;
}) {
  const { target, rule, reverse } = entry;
  const state = !rule
    ? "未設定（押して追加）"
    : rule.enabled
      ? `同期中・${OUTPUT_KIND_LABELS[rule.output.kind]}`
      : "停止中";
  return (
    <Pressable
      style={[
        styles.box,
        !rule && styles.targetUnset,
        selected && styles.targetSelected,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <View
        style={[
          styles.dot,
          rule && (rule.enabled ? styles.dotActive : styles.dotStopped),
        ]}
      />
      <View style={styles.boxMain}>
        <Text
          style={[styles.boxTitle, !rule && styles.textUnset]}
          numberOfLines={1}
        >
          {accountName(target)}
        </Text>
        <Text style={styles.boxMeta} numberOfLines={1}>
          {state}
          {rule?.lastError ? "・エラーあり" : ""}
        </Text>
        <Text style={styles.boxReverse} numberOfLines={1}>
          逆方向: {reverse ? (reverse.enabled ? "ON" : "OFF") : "未設定"}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: "#F8F9FA",
  },
  listPane: {
    flexGrow: 0,
    flexShrink: 0,
    width: 560,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#E0E0E0",
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  intro: {
    fontSize: 13,
    color: "#666666",
    lineHeight: 18,
    marginBottom: 16,
  },
  columns: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  columnLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#888888",
    marginBottom: 8,
  },
  sourceColumn: {
    width: 220,
  },
  targetColumn: {
    width: 240,
  },
  box: {
    height: ROW,
    marginBottom: GAP,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E0E0E0",
  },
  sourceSelected: {
    backgroundColor: "#1A73E8",
    borderColor: "#1A73E8",
  },
  targetSelected: {
    borderColor: "#1A73E8",
    borderWidth: 2,
  },
  targetUnset: {
    backgroundColor: "#F1F3F4",
    borderStyle: "dashed",
  },
  boxMain: {
    flex: 1,
  },
  boxTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2D4150",
  },
  boxMeta: {
    marginTop: 2,
    fontSize: 12,
    color: "#666666",
  },
  boxReverse: {
    marginTop: 1,
    fontSize: 11,
    color: "#999999",
  },
  textOnBlue: {
    color: "#FFFFFF",
  },
  textUnset: {
    color: "#999999",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#DADCE0",
  },
  dotActive: {
    backgroundColor: GREEN,
  },
  dotStopped: {
    backgroundColor: "#9AA0A6",
  },
  line: {
    position: "absolute",
    borderRadius: 1,
  },
  editorPane: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    color: "#888888",
    fontSize: 14,
  },
});
