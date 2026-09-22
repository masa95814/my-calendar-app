import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import {
  Choice,
  Field,
  MultiChoice,
  PrimaryButton,
  Section,
  SwitchRow,
  TextField,
} from "../components/form";
import {
  api,
  ApiError,
  describeApiError,
  type LinkedAccount,
  type RuleInput,
  type SyncRule,
} from "../lib/api";
import {
  ALL_DAY_LABELS,
  AUTO_DECLINE_LABELS,
  defaultKindFor,
  defaultRuleInput,
  OUTPUT_KIND_LABELS,
  parseKeywords,
  primaryCalendarIds,
  reverseRuleInput,
  ruleToInput,
  VISIBILITY_LABELS,
  WINDOW_DAYS_OPTIONS,
} from "../lib/rules";
import type { RulesStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RulesStackParamList, "RuleEditor">;

export default function RuleEditorScreen({ navigation, route }: Props) {
  const { ruleId, sourceAccountId, targetAccountId } = route.params;
  const isNew = !ruleId;

  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [existing, setExisting] = useState<SyncRule | undefined>();
  const [input, setInput] = useState<RuleInput | undefined>();
  // キーワードは入力中はそのままの文字列で持ち、保存時に配列にする
  const [excludeText, setExcludeText] = useState("");
  const [includeText, setIncludeText] = useState("");
  const [alsoReverse, setAlsoReverse] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    navigation.setOptions({
      title: isNew ? "同期設定を追加" : "同期設定を編集",
    });
  }, [navigation, isNew]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [a, r] = await Promise.all([api.listAccounts(), api.listRules()]);
        if (cancelled) {
          return;
        }
        setAccounts(a.accounts);
        const rule = ruleId ? r.rules.find((x) => x.id === ruleId) : undefined;
        if (ruleId && !rule) {
          setLoadError("この同期設定は見つかりませんでした。");
          return;
        }
        const initial = rule
          ? ruleToInput(rule)
          : defaultRuleInput(
              a.accounts.find((x) => x.id === sourceAccountId),
              a.accounts.find((x) => x.id === targetAccountId),
            );
        setExisting(rule);
        setInput(initial);
        setExcludeText(initial.filters.excludeKeywords.join(", "));
        setIncludeText(initial.filters.includeKeywords.join(", "));
      } catch (caught) {
        if (!cancelled) {
          setLoadError(describeApiError(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ruleId, sourceAccountId, targetAccountId]);

  const source = useMemo(
    () => accounts.find((a) => a.id === input?.source.accountId),
    [accounts, input?.source.accountId],
  );
  const target = useMemo(
    () => accounts.find((a) => a.id === input?.target.accountId),
    [accounts, input?.target.accountId],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!input) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>
          {loadError ?? "読み込めませんでした。"}
        </Text>
        {existing || ruleId ? (
          <View style={styles.centerAction}>
            <PrimaryButton
              title="この同期設定を削除"
              destructive
              onPress={() => ruleId && confirmDelete(ruleId)}
            />
          </View>
        ) : null}
      </View>
    );
  }

  const update = (patch: Partial<RuleInput>) =>
    setInput((prev) => (prev ? { ...prev, ...patch } : prev));
  const updateFilters = (patch: Partial<RuleInput["filters"]>) =>
    setInput((prev) =>
      prev ? { ...prev, filters: { ...prev.filters, ...patch } } : prev,
    );
  const updateOutput = (patch: Partial<RuleInput["output"]>) =>
    setInput((prev) =>
      prev ? { ...prev, output: { ...prev.output, ...patch } } : prev,
    );

  const selectSource = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    update({
      source: {
        accountId,
        calendarIds: account ? primaryCalendarIds(account) : [],
      },
    });
  };

  const selectTarget = (accountId: string) => {
    const account = accounts.find((a) => a.id === accountId);
    const kind = defaultKindFor(account);
    // 個人宛てに変えたら「不在」は選べないので「予定あり」に落とす
    setInput((prev) => {
      if (!prev) {
        return prev;
      }
      const titleWasDefault =
        prev.output.title === OUTPUT_KIND_LABELS[prev.output.kind];
      const nextKind =
        account?.type === "personal" ? "busy" : prev.output.kind || kind;
      return {
        ...prev,
        target: { accountId },
        output: {
          ...prev.output,
          kind: nextKind,
          title: titleWasDefault
            ? OUTPUT_KIND_LABELS[nextKind]
            : prev.output.title,
        },
      };
    });
  };

  const buildPayload = (): RuleInput => ({
    ...input,
    name: input.name?.trim() ? input.name.trim() : undefined,
    filters: {
      ...input.filters,
      excludeKeywords: parseKeywords(excludeText),
      includeKeywords: parseKeywords(includeText),
    },
    output: {
      ...input.output,
      title: input.output.title.trim() || OUTPUT_KIND_LABELS[input.output.kind],
    },
  });

  const validateLocally = (payload: RuleInput): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!payload.source.accountId) {
      errors["source.accountId"] = "送信元のアカウントを選んでください";
    }
    if (!payload.target.accountId) {
      errors["target.accountId"] = "同期先のアカウントを選んでください";
    }
    if (
      payload.source.accountId &&
      payload.source.accountId === payload.target.accountId
    ) {
      errors["target.accountId"] = "送信元と同じアカウントは選べません";
    }
    if (payload.source.calendarIds.length === 0) {
      errors["source.calendarIds"] = "カレンダーを 1 つ以上選んでください";
    }
    return errors;
  };

  const save = async () => {
    const payload = buildPayload();
    const localErrors = validateLocally(payload);
    setFieldErrors(localErrors);
    if (Object.keys(localErrors).length > 0) {
      return;
    }
    setSaving(true);
    try {
      if (existing) {
        await api.updateRule(existing.id, payload);
      } else {
        await api.createRule(payload);
        if (alsoReverse) {
          try {
            await api.createRule(reverseRuleInput(payload, accounts));
          } catch (caught) {
            Alert.alert(
              "逆方向の設定は作成できませんでした",
              describeApiError(caught),
            );
          }
        }
      }
      navigation.goBack();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 400) {
        const errors: Record<string, string> = {};
        for (const detail of caught.details) {
          errors[detail.path ?? mapCodeToPath(detail.code)] = detail.message;
        }
        setFieldErrors(errors);
        Alert.alert("入力内容を確認してください", describeApiError(caught));
      } else if (caught instanceof ApiError && caught.status === 409) {
        Alert.alert(
          "すでに同じ組み合わせの設定があります",
          "同じ送信元と同期先の同期設定は 1 件までです。一覧から既存の設定を編集してください。",
        );
      } else {
        Alert.alert("保存できませんでした", describeApiError(caught));
      }
    } finally {
      setSaving(false);
    }
  };

  function confirmDelete(id: string) {
    Alert.alert("この同期設定を削除しますか？", "この操作は取り消せません。", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除する",
        style: "destructive",
        onPress: async () => {
          try {
            await api.deleteRule(id);
            navigation.goBack();
          } catch (caught) {
            Alert.alert("削除できませんでした", describeApiError(caught));
          }
        },
      },
    ]);
  }

  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label:
      a.type === "workspace" ? `${a.email}（Workspace）` : `${a.email}（個人）`,
  }));
  const calendarOptions = (source?.calendars ?? []).map((c) => ({
    value: c.id,
    label: c.primary ? `${c.summary}（メイン）` : c.summary,
  }));
  const targetIsPersonal = target?.type === "personal";
  const isOutOfOffice = input.output.kind === "outOfOffice";

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Section title="基本">
          <Field
            label="名前"
            help="空欄なら「送信元 → 同期先」のメールアドレスになります"
          >
            <TextField
              value={input.name ?? ""}
              onChangeText={(name) => update({ name })}
              placeholder={
                source && target ? `${source.email} → ${target.email}` : "任意"
              }
            />
          </Field>
          <SwitchRow
            label="有効"
            value={input.enabled}
            onValueChange={(enabled) => update({ enabled })}
          />
        </Section>

        <Section title="送信元（この予定を元に）">
          <Field label="アカウント" error={fieldErrors["source.accountId"]}>
            <Choice
              options={accountOptions}
              value={input.source.accountId}
              onChange={selectSource}
            />
          </Field>
          {source ? (
            <Field
              label="対象カレンダー"
              help="メインカレンダーに加えて、サブカレンダーも対象にできます"
              error={fieldErrors["source.calendarIds"]}
            >
              <MultiChoice
                options={calendarOptions}
                values={input.source.calendarIds}
                onChange={(calendarIds) =>
                  update({ source: { ...input.source, calendarIds } })
                }
              />
            </Field>
          ) : null}
        </Section>

        <Section title="同期先（このカレンダーに作成）">
          <Field
            label="アカウント"
            help="同期先はメインカレンダーに固定です（「不在」はメインカレンダーにしか作れません）"
            error={fieldErrors["target.accountId"]}
          >
            <Choice
              options={accountOptions.map((o) => ({
                ...o,
                disabled: o.value === input.source.accountId,
              }))}
              value={input.target.accountId}
              onChange={selectTarget}
            />
          </Field>
          <Field label="同期範囲" help="今日から何日先までの予定を同期するか">
            <Choice
              options={WINDOW_DAYS_OPTIONS.map((d) => ({
                value: d,
                label: `${d} 日先まで`,
              }))}
              value={input.windowDays}
              onChange={(windowDays) => update({ windowDays })}
            />
          </Field>
        </Section>

        <Section title="フィルタ条件（どの予定を同期するか）">
          <Field label="参加者数">
            <Choice
              options={[
                { value: 0, label: "条件なし" },
                { value: 2, label: "2 人以上（複数人の予定のみ）" },
                { value: 3, label: "3 人以上" },
              ]}
              value={input.filters.minAttendees ?? 0}
              onChange={(n) =>
                updateFilters({ minAttendees: n === 0 ? null : n })
              }
            />
          </Field>
          <SwitchRow
            label="会議リンクがある予定のみ"
            help="Google Meet などのリンク付きの予定だけを同期します"
            value={input.filters.requireMeetLink}
            onValueChange={(requireMeetLink) =>
              updateFilters({ requireMeetLink })
            }
          />
          <Field
            label="除外キーワード"
            help="カンマ区切り。タイトルや説明にいずれかを含む予定は同期しません"
          >
            <TextField
              value={excludeText}
              onChangeText={setExcludeText}
              placeholder="例: 仮, 移動, ランチ"
              autoCapitalize="none"
            />
          </Field>
          <Field
            label="包含キーワード"
            help="指定すると、いずれかを含む予定だけを同期します"
          >
            <TextField
              value={includeText}
              onChangeText={setIncludeText}
              placeholder="空欄なら条件なし"
              autoCapitalize="none"
            />
          </Field>
          <SwitchRow
            label="終日の予定を除外"
            value={input.filters.excludeAllDay}
            onValueChange={(excludeAllDay) => updateFilters({ excludeAllDay })}
          />
          <SwitchRow
            label="「予定なし」扱いの予定を除外"
            help="時間を空けない設定（transparent）の予定"
            value={input.filters.excludeTransparent}
            onValueChange={(excludeTransparent) =>
              updateFilters({ excludeTransparent })
            }
          />
          <SwitchRow
            label="自分が辞退した予定を除外"
            value={input.filters.excludeDeclined}
            onValueChange={(excludeDeclined) =>
              updateFilters({ excludeDeclined })
            }
          />
          <SwitchRow
            label="未回答・仮承諾の予定を含める"
            value={input.filters.includeTentative}
            onValueChange={(includeTentative) =>
              updateFilters({ includeTentative })
            }
          />
        </Section>

        <Section title="出力設定（同期先にどう見せるか）">
          <Field
            label="種別"
            help={
              targetIsPersonal
                ? "個人の Google アカウントには「不在」を作成できません"
                : "「不在」は重なる会議の招待を自動で辞退できます"
            }
            error={fieldErrors["output.kind"]}
          >
            <Choice
              options={[
                {
                  value: "outOfOffice" as const,
                  label: OUTPUT_KIND_LABELS.outOfOffice,
                  disabled: targetIsPersonal,
                },
                { value: "busy" as const, label: OUTPUT_KIND_LABELS.busy },
              ]}
              value={input.output.kind}
              onChange={(kind) => {
                const titleWasDefault =
                  input.output.title === OUTPUT_KIND_LABELS[input.output.kind];
                updateOutput({
                  kind,
                  title: titleWasDefault
                    ? OUTPUT_KIND_LABELS[kind]
                    : input.output.title,
                });
              }}
            />
          </Field>
          <Field
            label="タイトル"
            help="{title} で元予定のタイトル、{account} で送信元のメールアドレスを差し込めます"
            error={fieldErrors["output.title"]}
          >
            <TextField
              value={input.output.title}
              onChangeText={(title) => updateOutput({ title })}
            />
          </Field>
          <SwitchRow
            label="説明文を写す"
            value={input.output.copyDescription}
            onValueChange={(copyDescription) =>
              updateOutput({ copyDescription })
            }
          />
          <SwitchRow
            label="場所・会議リンクを写す"
            value={input.output.copyLocation}
            onValueChange={(copyLocation) => updateOutput({ copyLocation })}
          />
          <Field label="公開設定">
            <Choice
              options={(["private", "default"] as const).map((v) => ({
                value: v,
                label: VISIBILITY_LABELS[v],
              }))}
              value={input.output.visibility}
              onChange={(visibility) => updateOutput({ visibility })}
            />
          </Field>
          <Field
            label="終日の元予定の扱い"
            help="「不在」は終日にできないため、時間指定に変換するか同期しないかを選びます"
          >
            <Choice
              options={(["fullDay", "skip"] as const).map((v) => ({
                value: v,
                label: ALL_DAY_LABELS[v],
              }))}
              value={input.output.allDaySourceHandling}
              onChange={(allDaySourceHandling) =>
                updateOutput({ allDaySourceHandling })
              }
            />
          </Field>
          {isOutOfOffice ? (
            <>
              <Field label="自動辞退">
                <Choice
                  options={(
                    [
                      "declineOnlyNewConflictingInvitations",
                      "declineAllConflictingInvitations",
                      "declineNone",
                    ] as const
                  ).map((v) => ({ value: v, label: AUTO_DECLINE_LABELS[v] }))}
                  value={input.output.autoDeclineMode}
                  onChange={(autoDeclineMode) =>
                    updateOutput({ autoDeclineMode })
                  }
                />
              </Field>
              {input.output.autoDeclineMode !== "declineNone" ? (
                <Field label="辞退メッセージ">
                  <TextField
                    value={input.output.declineMessage}
                    onChangeText={(declineMessage) =>
                      updateOutput({ declineMessage })
                    }
                    multiline
                  />
                </Field>
              ) : null}
            </>
          ) : null}
        </Section>

        {isNew && source && target ? (
          <Section title="逆方向">
            <SwitchRow
              label={`${target.email} → ${source.email} も同時に作成`}
              help="同じフィルタと出力設定をコピーした別の同期設定を作ります。作成後は個別に編集できます"
              value={alsoReverse}
              onValueChange={setAlsoReverse}
            />
          </Section>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton
            title={saving ? "保存中..." : "保存"}
            onPress={save}
            disabled={saving}
          />
          {existing ? (
            <View style={styles.deleteButton}>
              <PrimaryButton
                title="この同期設定を削除"
                destructive
                onPress={() => confirmDelete(existing.id)}
              />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** バックエンドの整合性エラーのコードを、フォームの項目に対応づける */
function mapCodeToPath(code: string): string {
  switch (code) {
    case "source_account_not_found":
      return "source.accountId";
    case "target_account_not_found":
    case "same_account":
      return "target.accountId";
    case "unknown_source_calendar":
      return "source.calendarIds";
    case "out_of_office_not_available_for_personal":
      return "output.kind";
    default:
      return code;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  centerAction: {
    marginTop: 20,
    alignSelf: "stretch",
  },
  error: {
    color: "#D0342C",
    fontSize: 14,
    textAlign: "center",
  },
  actions: {
    marginTop: 8,
  },
  deleteButton: {
    marginTop: 12,
  },
});
