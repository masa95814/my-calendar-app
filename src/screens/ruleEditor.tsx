import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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
  ColorChoice,
  Field,
  MultiChoice,
  PrimaryButton,
  Section,
  SwitchRow,
  TextField,
} from "../components/form";
import { accountName } from "../lib/accounts";
import {
  api,
  ApiError,
  describeApiError,
  type LinkedAccount,
  type RuleInput,
  type SyncRule,
} from "../lib/api";
import { confirmAction, notify } from "../lib/dialog";
import {
  ALL_DAY_LABELS,
  AUTO_DECLINE_LABELS,
  defaultKindFor,
  defaultRuleInput,
  defaultRuleName,
  EVENT_COLORS,
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

/** スマホなど狭い画面では、同期設定の編集を 1 画面として開く */
export default function RuleEditorScreen({ navigation, route }: Props) {
  const { ruleId, sourceAccountId, targetAccountId } = route.params;
  useEffect(() => {
    navigation.setOptions({
      title: ruleId ? "同期設定を編集" : "同期設定を追加",
    });
  }, [navigation, ruleId]);
  return (
    <RuleEditor
      {...(ruleId ? { ruleId } : {})}
      {...(sourceAccountId ? { sourceAccountId } : {})}
      {...(targetAccountId ? { targetAccountId } : {})}
      onDone={() => navigation.goBack()}
    />
  );
}

export type RuleEditorProps = {
  /** 既存の同期設定を編集する。未指定なら新規作成 */
  ruleId?: string;
  /** 新規作成のときに最初から選んでおく送信元・同期先 */
  sourceAccountId?: string;
  targetAccountId?: string;
  /** 保存・削除が終わったとき */
  onDone: (result: "saved" | "deleted") => void;
  /**
   * 一覧の横に埋め込むとき（広い画面）。保存後も閉じずに「保存しました」を出し、
   * 送信元・同期先は一覧で選ぶので変更できないようにする
   */
  embedded?: boolean;
};

/** 同期設定の編集フォーム（画面としても、一覧の横の埋め込みとしても使う） */
export function RuleEditor({
  ruleId,
  sourceAccountId,
  targetAccountId,
  onDone,
  embedded = false,
}: RuleEditorProps) {
  const isNew = !ruleId;

  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [existing, setExisting] = useState<SyncRule | undefined>();
  const [input, setInput] = useState<RuleInput | undefined>();
  // キーワードは入力中はそのままの文字列で持ち、保存時に配列にする
  const [excludeText, setExcludeText] = useState("");
  const [includeText, setIncludeText] = useState("");
  const [alwaysText, setAlwaysText] = useState("");
  const [capText, setCapText] = useState("");
  const [alsoReverse, setAlsoReverse] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<Date | null>(null);

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
        setAlwaysText(initial.filters.alwaysIncludeKeywords.join(", "));
        setCapText(initial.output.maxDurationKeywords.join(", "));
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
    name:
      input.name?.trim() ||
      (source && target ? defaultRuleName(source, target) : undefined),
    filters: {
      ...input.filters,
      excludeKeywords: parseKeywords(excludeText),
      includeKeywords: parseKeywords(includeText),
      alwaysIncludeKeywords: parseKeywords(alwaysText),
    },
    output: {
      ...input.output,
      title: input.output.title.trim() || OUTPUT_KIND_LABELS[input.output.kind],
      maxDurationKeywords: parseKeywords(capText),
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
            notify(
              "逆方向の設定は作成できませんでした",
              describeApiError(caught),
            );
          }
        }
      }
      setSavedAt(new Date());
      onDone("saved");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 400) {
        const errors: Record<string, string> = {};
        for (const detail of caught.details) {
          errors[detail.path ?? mapCodeToPath(detail.code)] = detail.message;
        }
        setFieldErrors(errors);
        notify("入力内容を確認してください", describeApiError(caught));
      } else if (caught instanceof ApiError && caught.status === 409) {
        notify(
          "すでに同じ組み合わせの設定があります",
          "同じ送信元と同期先の同期設定は 1 件までです。一覧から既存の設定を編集してください。",
        );
      } else {
        notify("保存できませんでした", describeApiError(caught));
      }
    } finally {
      setSaving(false);
    }
  };

  async function confirmDelete(id: string) {
    const ok = await confirmAction({
      title: "この同期設定を削除しますか？",
      message: "この操作は取り消せません。",
      confirmLabel: "削除する",
    });
    if (!ok) {
      return;
    }
    try {
      await api.deleteRule(id);
      onDone("deleted");
    } catch (caught) {
      notify("削除できませんでした", describeApiError(caught));
    }
  }

  const accountOptions = accounts.map((a) => ({
    value: a.id,
    label: `${accountName(a)}（${a.email}）`,
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
        <DirectionHeader
          source={source}
          target={target}
          enabled={input.enabled}
          isNew={isNew}
        />
        <Section title="基本">
          <Field
            label="名前"
            help="空欄なら「送信元 → 同期先」のアカウント名になります"
          >
            <TextField
              value={input.name ?? ""}
              onChangeText={(name) => update({ name })}
              placeholder={
                source && target ? defaultRuleName(source, target) : "任意"
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
          {/* 埋め込みのときは一覧で選んだ送信元に固定する */}
          {embedded ? null : (
            <Field label="アカウント" error={fieldErrors["source.accountId"]}>
              <Choice
                options={accountOptions}
                value={input.source.accountId}
                onChange={selectSource}
              />
            </Field>
          )}
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
          {embedded ? null : (
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
          )}
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
            help="カンマ区切り。タイトルにいずれかを含む予定は同期しません（説明文は見ません）"
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
          <Field
            label="例外で同期するキーワード"
            help="カンマ区切り。タイトルにいずれかを含む予定は、参加者数・会議リンク・包含キーワードの条件に合わなくても同期します（除外キーワードは優先します）"
          >
            <TextField
              value={alwaysText}
              onChangeText={setAlwaysText}
              placeholder="例: 面談"
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
          <Field
            label="長さの上限"
            help="元の予定がこれより長いときは、開始からこの長さまでを埋めます（例: 1 時間で入っているが実際は 30 分で終わる定例）。終日の予定には効きません"
          >
            <Choice
              options={[
                { value: 0, label: "上限なし" },
                { value: 30, label: "30 分" },
                { value: 45, label: "45 分" },
                { value: 60, label: "1 時間" },
              ]}
              value={input.output.maxDurationMinutes ?? 0}
              onChange={(n) =>
                updateOutput({ maxDurationMinutes: n === 0 ? null : n })
              }
            />
          </Field>
          {input.output.maxDurationMinutes !== null ? (
            <Field
              label="上限をかける予定"
              help="カンマ区切り。タイトルにいずれかを含む予定だけに上限を使います。空欄ならすべての予定に使います"
            >
              <TextField
                value={capText}
                onChangeText={setCapText}
                placeholder="例: 定例（空欄ならすべて）"
                autoCapitalize="none"
              />
            </Field>
          ) : null}
          <Field
            label="予定の色"
            help="同期先の Google カレンダーでミラー予定を表示する色です"
          >
            <ColorChoice
              options={EVENT_COLORS}
              value={input.output.colorId}
              onChange={(colorId) => updateOutput({ colorId })}
              defaultLabel="カレンダーの既定の色"
            />
          </Field>
          <Field label="公開設定">
            <Choice
              options={(["public", "private", "default"] as const).map((v) => ({
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
              label={`${defaultRuleName(target, source)} も同時に作成`}
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
          {embedded && savedAt && !saving ? (
            <Text style={styles.saved}>保存しました</Text>
          ) : null}
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

/** 「どこからどこへ」の同期設定かを、いちばん上に大きく出す */
function DirectionHeader({
  source,
  target,
  enabled,
  isNew,
}: {
  source: LinkedAccount | undefined;
  target: LinkedAccount | undefined;
  enabled: boolean;
  isNew: boolean;
}) {
  const color = isNew ? "#1A73E8" : enabled ? "#34A853" : "#9AA0A6";
  return (
    <View style={styles.direction}>
      <AccountBox label="この予定を" account={source} />
      <View style={styles.arrow}>
        <View style={[styles.arrowLine, { backgroundColor: color }]} />
        <Text style={[styles.arrowHead, { color }]}>▶</Text>
        <Text style={styles.arrowState}>
          {isNew ? "新規" : enabled ? "同期中" : "停止中"}
        </Text>
      </View>
      <AccountBox label="ここに反映" account={target} />
    </View>
  );
}

function AccountBox({
  label,
  account,
}: {
  label: string;
  account: LinkedAccount | undefined;
}) {
  return (
    <View style={styles.accountBox}>
      <Text style={styles.accountLabel}>{label}</Text>
      <Text style={styles.accountName} numberOfLines={1}>
        {account ? accountName(account) : "未選択"}
      </Text>
      {account ? (
        <Text style={styles.accountEmail} numberOfLines={1}>
          {account.email}
        </Text>
      ) : null}
    </View>
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
  saved: {
    marginTop: 8,
    textAlign: "center",
    color: "#34A853",
    fontSize: 13,
    fontWeight: "600",
  },
  direction: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    gap: 8,
  },
  accountBox: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E0E0E0",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  accountLabel: {
    fontSize: 11,
    color: "#888888",
  },
  accountName: {
    marginTop: 2,
    fontSize: 16,
    fontWeight: "700",
    color: "#2D4150",
  },
  accountEmail: {
    marginTop: 2,
    fontSize: 11,
    color: "#888888",
  },
  arrow: {
    width: 64,
    alignItems: "center",
  },
  arrowLine: {
    alignSelf: "stretch",
    height: 3,
    borderRadius: 2,
  },
  arrowHead: {
    position: "absolute",
    right: -4,
    top: -8,
    fontSize: 14,
  },
  arrowState: {
    marginTop: 6,
    fontSize: 11,
    color: "#666666",
  },
});
