import React, { useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import {
  Agenda,
  AgendaEntry,
  AgendaSchedule,
  Calendar,
  CalendarList,
  DateData,
  LocaleConfig,
} from "react-native-calendars";

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

// カレンダーの左右マージン（横スクロールの CalendarList の幅計算にも使う）
const CALENDAR_HORIZONTAL_MARGIN = 20;

// 端末のローカル日付を 'YYYY-MM-DD' 形式にする
// ※ Date#toISOString() は UTC 基準のため、日本時間の 0〜9 時は前日になってしまう
const toDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// 型定義
interface MarkedDates {
  [date: string]: {
    selected?: boolean;
    marked?: boolean;
    selectedColor?: string;
    selectedTextColor?: string;
    dotColor?: string;
    dots?: Array<{ key: string; color: string }>;
    disabled?: boolean;
    disableTouchEvent?: boolean;
    customStyles?: {
      container?: any;
      text?: any;
    };
  };
}

interface Event {
  date: string;
  title: string;
  type: "meeting" | "deadline" | "holiday" | "personal";
}

interface AgendaItem extends AgendaEntry {
  name: string;
  time: string;
  duration: string;
  location?: string;
  type: "meeting" | "task" | "event" | "reminder";
}

interface PeriodMarking {
  [date: string]: {
    color?: string;
    textColor?: string;
    startingDay?: boolean;
    endingDay?: boolean;
    marked?: boolean;
    dotColor?: string;
  };
}

type CalendarType = "basic" | "agenda" | "period";

// 基本カレンダーコンポーネント
const BasicCalendarView = () => {
  const [selected, setSelected] = useState<string>("");
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // サンプルイベントデータ
  const events: Event[] = [
    { date: "2024-01-15", title: "重要な会議", type: "meeting" },
    { date: "2024-01-20", title: "プロジェクト締切", type: "deadline" },
    { date: "2024-01-25", title: "休暇", type: "holiday" },
    { date: "2024-01-28", title: "誕生日", type: "personal" },
  ];

  const eventColors = {
    meeting: "#4ECDC4",
    deadline: "#FF6B6B",
    holiday: "#95E1D3",
    personal: "#F38181",
  };

  const getMarkedDates = (): MarkedDates => {
    const marked: MarkedDates = {};

    events.forEach((event) => {
      marked[event.date] = {
        marked: true,
        dotColor: eventColors[event.type],
      };
    });

    if (selected) {
      marked[selected] = {
        ...marked[selected],
        selected: true,
        selectedColor: "#007AFF",
        selectedTextColor: "#FFFFFF",
      };
    }

    const today = toDateString(new Date());
    marked[today] = {
      ...marked[today],
      customStyles: {
        text: {
          color: "#007AFF",
          fontWeight: "bold",
        },
      },
    };

    return marked;
  };

  const onDayPress = (day: DateData) => {
    setSelected(day.dateString);

    const dayEvents = events.filter((e) => e.date === day.dateString);
    if (dayEvents.length > 0) {
      const eventTitles = dayEvents.map((e) => e.title).join("\n");
      Alert.alert(`${day.dateString}のイベント`, eventTitles, [{ text: "OK" }]);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Calendar
        current={toDateString(currentMonth)}
        onDayPress={onDayPress}
        onMonthChange={(month) => setCurrentMonth(new Date(month.timestamp))}
        markedDates={getMarkedDates()}
        theme={{
          calendarBackground: "#FFFFFF",
          textSectionTitleColor: "#666666",
          selectedDayTextColor: "#FFFFFF",
          todayTextColor: "#007AFF",
          dayTextColor: "#2D4150",
          textDisabledColor: "#D9E1E8",
          arrowColor: "#007AFF",
          monthTextColor: "#007AFF",
          textMonthFontSize: 18,
          textMonthFontWeight: "bold",
          textDayFontSize: 16,
        }}
        style={styles.calendar}
      />

      {selected ? (
        <View style={styles.selectedInfo}>
          <Text style={styles.selectedDate}>選択された日付: {selected}</Text>
        </View>
      ) : null}

      <View style={styles.legend}>
        <Text style={styles.legendTitle}>イベントカテゴリー</Text>
        <View style={styles.legendItems}>
          <View style={styles.legendItem}>
            <View
              style={[styles.dot, { backgroundColor: eventColors.meeting }]}
            />
            <Text style={styles.legendText}>会議</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.dot, { backgroundColor: eventColors.deadline }]}
            />
            <Text style={styles.legendText}>締切</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.dot, { backgroundColor: eventColors.holiday }]}
            />
            <Text style={styles.legendText}>休暇</Text>
          </View>
          <View style={styles.legendItem}>
            <View
              style={[styles.dot, { backgroundColor: eventColors.personal }]}
            />
            <Text style={styles.legendText}>個人</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
};

// アジェンダビューコンポーネント
const AgendaView = () => {
  const [items, setItems] = useState<AgendaSchedule>({});
  const [refreshing, setRefreshing] = useState(false);

  const loadItems = (day: DateData) => {
    const newItems: AgendaSchedule = { ...items };

    setTimeout(() => {
      for (let i = -15; i < 85; i++) {
        const time = day.timestamp + i * 24 * 60 * 60 * 1000;
        const strTime = new Date(time).toISOString().split("T")[0];

        if (!newItems[strTime]) {
          newItems[strTime] = [];
          const numItems = Math.floor(Math.random() * 3 + 1);
          for (let j = 0; j < numItems; j++) {
            newItems[strTime].push({
              name: getRandomEvent(j),
              time: getRandomTime(j),
              duration: getRandomDuration(),
              location: getRandomLocation(),
              type: getRandomType(),
              height: 80,
              day: strTime,
            } as AgendaItem);
          }
        }
      }
      setItems(newItems);
      setRefreshing(false);
    }, 1000);
  };

  const getRandomEvent = (index: number) => {
    const events = [
      "開発チームミーティング",
      "クライアント打ち合わせ",
      "コードレビュー",
    ];
    return events[index % events.length];
  };

  const getRandomTime = (index: number) => {
    const times = ["09:00", "10:30", "14:00"];
    return times[index % times.length];
  };

  const getRandomDuration = () => "1時間";
  const getRandomLocation = () => "会議室A";
  const getRandomType = (): AgendaItem["type"] => "meeting";

  // Agenda の renderItem は AgendaEntry を受け取る型なので、ここで AgendaItem に絞り込む
  const renderItem = (reservation: AgendaEntry) => {
    const item = reservation as AgendaItem;
    return (
      <TouchableOpacity
        style={[styles.item, { borderLeftColor: "#4ECDC4" }]}
        onPress={() => Alert.alert(item.name, `時間: ${item.time}`)}
      >
        <View style={styles.itemContent}>
          <Text style={styles.itemTitle}>{item.name}</Text>
          <View style={styles.itemDetails}>
            <Text style={styles.itemTime}>{item.time}</Text>
            <Text style={styles.itemDuration}>{item.duration}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyDate = () => (
    <View style={styles.emptyDate}>
      <Text style={styles.emptyDateText}>予定がありません</Text>
    </View>
  );

  return (
    <Agenda
      items={items}
      loadItemsForMonth={loadItems}
      selected={toDateString(new Date())}
      renderItem={renderItem}
      renderEmptyDate={renderEmptyDate}
      rowHasChanged={(r1, r2) => r1.name !== r2.name}
      showClosingKnob={true}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        setItems({});
        // ライブラリが渡す DateData と同じ形（timestamp は UTC 0時）で今日を渡す
        const now = new Date();
        loadItems({
          dateString: toDateString(now),
          day: now.getDate(),
          month: now.getMonth() + 1,
          year: now.getFullYear(),
          timestamp: Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
        });
      }}
      theme={{
        agendaDayTextColor: "#007AFF",
        agendaDayNumColor: "#007AFF",
        agendaTodayColor: "#007AFF",
        agendaKnobColor: "#007AFF",
      }}
      style={styles.agenda}
    />
  );
};

// 期間選択コンポーネント
const PeriodView = () => {
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [markedDates, setMarkedDates] = useState<PeriodMarking>({});
  // 横スクロールの CalendarList は calendarWidth（デフォルトは画面幅）単位でページングされるため、
  // 左右マージン分を引いた幅を渡さないと 2 ページ目以降がずれていく
  const { width: windowWidth } = useWindowDimensions();
  const calendarWidth = windowWidth - CALENDAR_HORIZONTAL_MARGIN * 2;

  const markPeriod = (start: string, end: string) => {
    const marked: PeriodMarking = {};
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();

    for (let time = startTime; time <= endTime; time += 24 * 60 * 60 * 1000) {
      const date = new Date(time).toISOString().split("T")[0];
      marked[date] = {
        color: "#E3F2FD",
        textColor: "#007AFF",
        startingDay: date === start,
        endingDay: date === end,
      };
    }

    return marked;
  };

  const onDayPress = (day: DateData) => {
    if (!startDate || (startDate && endDate)) {
      setStartDate(day.dateString);
      setEndDate("");
      setMarkedDates({
        [day.dateString]: {
          color: "#007AFF",
          textColor: "#FFFFFF",
          startingDay: true,
          endingDay: true,
        },
      });
    } else if (startDate && !endDate) {
      const start = new Date(startDate).getTime();
      const end = new Date(day.dateString).getTime();

      if (end < start) {
        const newMarked = markPeriod(day.dateString, startDate);
        setStartDate(day.dateString);
        setEndDate(startDate);
        setMarkedDates(newMarked);
      } else {
        const newMarked = markPeriod(startDate, day.dateString);
        setEndDate(day.dateString);
        setMarkedDates(newMarked);
      }
    }
  };

  return (
    <ScrollView style={styles.container}>
      <CalendarList
        horizontal={true}
        pagingEnabled={true}
        calendarWidth={calendarWidth}
        onDayPress={onDayPress}
        markingType={"period"}
        markedDates={markedDates}
        theme={{
          calendarBackground: "#FFFFFF",
          textSectionTitleColor: "#666666",
          todayTextColor: "#007AFF",
          dayTextColor: "#2D4150",
        }}
        style={styles.calendar}
      />

      <View style={styles.selectionInfo}>
        {startDate && <Text style={styles.date}>開始日: {startDate}</Text>}
        {endDate && <Text style={styles.date}>終了日: {endDate}</Text>}
      </View>
    </ScrollView>
  );
};

// メインのカレンダーコンポーネント
const CalendarComponent = () => {
  const [selectedType, setSelectedType] = useState<CalendarType>("basic");

  const renderCalendar = () => {
    switch (selectedType) {
      case "basic":
        return <BasicCalendarView />;
      case "agenda":
        return <AgendaView />;
      case "period":
        return <PeriodView />;
    }
  };

  // SafeAreaView は app.tsx 側で当てているので、ここでは通常の View にする
  return (
    <View style={styles.root}>
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, selectedType === "basic" && styles.activeTab]}
          onPress={() => setSelectedType("basic")}
        >
          <Text
            style={[
              styles.tabText,
              selectedType === "basic" && styles.activeTabText,
            ]}
          >
            基本
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, selectedType === "agenda" && styles.activeTab]}
          onPress={() => setSelectedType("agenda")}
        >
          <Text
            style={[
              styles.tabText,
              selectedType === "agenda" && styles.activeTabText,
            ]}
          >
            アジェンダ
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, selectedType === "period" && styles.activeTab]}
          onPress={() => setSelectedType("period")}
        >
          <Text
            style={[
              styles.tabText,
              selectedType === "period" && styles.activeTabText,
            ]}
          >
            期間選択
          </Text>
        </TouchableOpacity>
      </View>

      {selectedType === "agenda" ? (
        <View style={{ flex: 1 }}>{renderCalendar()}</View>
      ) : (
        renderCalendar()
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 5,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    marginHorizontal: 5,
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: "#007AFF",
  },
  tabText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#666",
  },
  activeTabText: {
    color: "#FFFFFF",
  },
  calendar: {
    marginHorizontal: CALENDAR_HORIZONTAL_MARGIN,
    marginTop: 20,
    borderRadius: 10,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  agenda: {
    flex: 1,
  },
  selectedInfo: {
    marginHorizontal: 20,
    marginTop: 20,
    padding: 15,
    backgroundColor: "#E3F2FD",
    borderRadius: 8,
  },
  selectedDate: {
    fontSize: 16,
    textAlign: "center",
    color: "#007AFF",
    fontWeight: "500",
  },
  selectionInfo: {
    marginHorizontal: 20,
    marginTop: 20,
    padding: 20,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
  },
  date: {
    fontSize: 16,
    color: "#007AFF",
    marginBottom: 5,
  },
  legend: {
    marginHorizontal: 20,
    marginTop: 25,
    padding: 20,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
  },
  legendTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 15,
    color: "#333",
  },
  legendItems: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    width: "48%",
    marginBottom: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  legendText: {
    fontSize: 14,
    color: "#666",
  },
  item: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 15,
    marginRight: 10,
    marginTop: 10,
    borderLeftWidth: 4,
  },
  itemContent: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 5,
  },
  itemDetails: {
    flexDirection: "row",
    gap: 10,
  },
  itemTime: {
    fontSize: 14,
    color: "#007AFF",
  },
  itemDuration: {
    fontSize: 14,
    color: "#666",
  },
  emptyDate: {
    height: 80,
    paddingTop: 30,
  },
  emptyDateText: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
  },
});

export default CalendarComponent;
