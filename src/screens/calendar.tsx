import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Calendar, LocaleConfig, type DateData } from "react-native-calendars";
import { useFocusEffect } from "@react-navigation/native";

import {
  api,
  describeApiError,
  type LinkedAccount,
  type UnifiedEvent,
} from "../lib/api";
import { buildAccountColors } from "../lib/colors";
import {
  addDays,
  eventDateKey,
  formatDateLabel,
  formatTime,
  fromDateString,
  toDateString,
} from "../lib/dates";

// 日本語設定
LocaleConfig.locales["jp"] = {
  monthNames: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ],
  monthNamesShort: [
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ],
  dayNames: [
    "日曜日",
    "月曜日",
    "火曜日",
    "水曜日",
    "木曜日",
    "金曜日",
    "土曜日",
  ],
  dayNamesShort: ["日", "月", "火", "水", "木", "金", "土"],
  today: "今日",
};
LocaleConfig.defaultLocale = "jp";

/** 表示中の月の前後にどれだけ余分に取得するか（日） */
const FETCH_MARGIN_DAYS = 7;

// react-native-calendars は MarkedDates をパッケージのトップから公開していないため、
// この画面で使う分だけ型を定義する
type MarkedDates = {
  [date: string]: {
    dots?: { key: string; color: string }[];
    selected?: boolean;
    selectedColor?: string;
  };
};

/**
 * 統合カレンダー（F6）。全連携アカウントのメインカレンダーの予定を 1 つの月表示に重ね、
 * 選んだ日の予定を下に並べる。表示のみで、作成・編集はしない。
 */
export default function CalendarScreen() {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selected, setSelected] = useState(() => toDateString(new Date()));
  const [accounts, setAccounts] = useState<LinkedAccount[]>([]);
  const [events, setEvents] = useState<UnifiedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const from = addDays(month, -FETCH_MARGIN_DAYS);
      const to = addDays(
        new Date(month.getFullYear(), month.getMonth() + 1, 1),
        FETCH_MARGIN_DAYS,
      );
      const [a, e] = await Promise.all([
        api.listAccounts(),
        api.listEvents(from, to),
      ]);
      setAccounts(a.accounts);
      setEvents(e.events);
      setWarnings(e.errors);
      setError(null);
    } catch (caught) {
      setError(describeApiError(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [month]);

  // タブに戻ったときと、表示月が変わったときに再取得する
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const colors = useMemo(
    () => buildAccountColors(accounts.map((a) => a.id)),
    [accounts],
  );

  /** 日付 → その日の予定（終日で複数日にまたがる予定は各日に載せる） */
  const eventsByDate = useMemo(() => {
    const map = new Map<string, UnifiedEvent[]>();
    const push = (key: string, event: UnifiedEvent) => {
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    };
    for (const event of events) {
      if (event.allDay) {
        // 終日の end は翌日（排他的）
        let cursor = fromDateString(event.start.slice(0, 10));
        const end = fromDateString(event.end.slice(0, 10));
        let guard = 0;
        while (cursor.getTime() < end.getTime() && guard++ < 62) {
          push(toDateString(cursor), event);
          cursor = addDays(cursor, 1);
        }
      } else {
        push(eventDateKey(event.start, false), event);
      }
    }
    for (const list of map.values()) {
      list.sort((x, y) => {
        if (x.allDay !== y.allDay) {
          return x.allDay ? -1 : 1;
        }
        return x.start.localeCompare(y.start);
      });
    }
    return map;
  }, [events]);

  const markedDates = useMemo(() => {
    const marked: MarkedDates = {};
    for (const [date, list] of eventsByDate) {
      const seen = new Set<string>();
      const dots: { key: string; color: string }[] = [];
      for (const event of list) {
        if (!seen.has(event.accountId)) {
          seen.add(event.accountId);
          dots.push({
            key: event.accountId,
            color: colors.get(event.accountId) ?? "#999999",
          });
        }
      }
      marked[date] = { dots };
    }
    marked[selected] = {
      ...(marked[selected] ?? {}),
      selected: true,
      selectedColor: "#007AFF",
    };
    return marked;
  }, [eventsByDate, colors, selected]);

  const dayEvents = eventsByDate.get(selected) ?? [];
  const accountLabel = (event: UnifiedEvent) =>
    accounts.find((a) => a.id === event.accountId)?.hd ??
    event.accountEmail.split("@")[0] ??
    event.accountEmail;

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
      <Calendar
        current={toDateString(month)}
        markingType="multi-dot"
        markedDates={markedDates}
        onDayPress={(day: DateData) => setSelected(day.dateString)}
        onMonthChange={(m: DateData) =>
          setMonth(new Date(m.year, m.month - 1, 1))
        }
        enableSwipeMonths
        theme={{
          calendarBackground: "#FFFFFF",
          textSectionTitleColor: "#666666",
          todayTextColor: "#007AFF",
          dayTextColor: "#2D4150",
          textDisabledColor: "#D9E1E8",
          arrowColor: "#007AFF",
          monthTextColor: "#2D4150",
          textMonthFontWeight: "600",
        }}
        style={styles.calendar}
      />

      {accounts.length > 0 ? (
        <View style={styles.legend}>
          {accounts.map((account) => (
            <View key={account.id} style={styles.legendItem}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: colors.get(account.id) ?? "#999999" },
                ]}
              />
              <Text style={styles.legendText} numberOfLines={1}>
                {account.hd ?? account.email}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {warnings.map((warning) => (
        <Text key={warning} style={styles.warning}>
          {warning}
        </Text>
      ))}

      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{formatDateLabel(selected)}</Text>
        {loading ? <ActivityIndicator /> : null}
      </View>

      {accounts.length === 0 && !loading ? (
        <Text style={styles.empty}>
          「アカウント」タブから Google
          アカウントを連携すると、ここに予定が表示されます。
        </Text>
      ) : dayEvents.length === 0 && !loading ? (
        <Text style={styles.empty}>予定はありません</Text>
      ) : (
        dayEvents.map((event) => (
          <EventRow
            key={`${event.accountId}:${event.id}`}
            event={event}
            color={colors.get(event.accountId) ?? "#999999"}
            accountLabel={accountLabel(event)}
          />
        ))
      )}
    </ScrollView>
  );
}

function EventRow({
  event,
  color,
  accountLabel,
}: {
  event: UnifiedEvent;
  color: string;
  accountLabel: string;
}) {
  const time = event.allDay
    ? "終日"
    : `${formatTime(event.start)}〜${formatTime(event.end)}`;
  return (
    <View
      style={[
        styles.eventRow,
        { borderLeftColor: color },
        event.isMirror && styles.eventRowMirror,
      ]}
    >
      <Text style={styles.eventTime}>{time}</Text>
      <View style={styles.eventMain}>
        <Text
          style={[styles.eventTitle, event.isMirror && styles.eventTitleMirror]}
          numberOfLines={2}
        >
          {event.summary}
        </Text>
        <View style={styles.eventMeta}>
          <Text style={[styles.eventAccount, { color }]}>{accountLabel}</Text>
          {event.isMirror ? (
            <Text style={styles.mirrorBadge}>ミラー</Text>
          ) : null}
          {event.eventType === "outOfOffice" ? (
            <Text style={styles.oooBadge}>不在</Text>
          ) : null}
          {event.hangoutLink ? (
            <Text style={styles.meetBadge}>Meet</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  calendar: {
    borderRadius: 10,
    paddingBottom: 8,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    maxWidth: "48%",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },
  legendText: {
    fontSize: 12,
    color: "#666666",
  },
  error: {
    marginTop: 12,
    color: "#D0342C",
    fontSize: 14,
  },
  warning: {
    marginTop: 8,
    color: "#E65100",
    fontSize: 12,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 8,
  },
  dayTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#2D4150",
  },
  empty: {
    color: "#999999",
    fontSize: 14,
    paddingVertical: 16,
    textAlign: "center",
  },
  eventRow: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderLeftWidth: 4,
    padding: 12,
    marginBottom: 8,
  },
  eventRowMirror: {
    opacity: 0.7,
    backgroundColor: "#F3F4F6",
  },
  eventTime: {
    width: 92,
    fontSize: 12,
    color: "#666666",
    paddingTop: 2,
  },
  eventMain: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2D4150",
  },
  eventTitleMirror: {
    fontWeight: "400",
  },
  eventMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
    alignItems: "center",
  },
  eventAccount: {
    fontSize: 12,
    fontWeight: "600",
  },
  mirrorBadge: {
    fontSize: 11,
    color: "#666666",
    backgroundColor: "#E5E7EB",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
  oooBadge: {
    fontSize: 11,
    color: "#7C3AED",
    backgroundColor: "#EDE9FE",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
  meetBadge: {
    fontSize: 11,
    color: "#047857",
    backgroundColor: "#D1FAE5",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    overflow: "hidden",
  },
});
