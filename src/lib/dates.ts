// 日付の表示・変換。端末のローカルタイムゾーンで扱う

/** Date をローカル日付の 'YYYY-MM-DD' にする（toISOString は UTC 基準なので使わない） */
export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 'YYYY-MM-DD' をローカル 0 時の Date にする */
export function fromDateString(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** 予定の start / end（dateTime か date）が属するローカル日付 */
export function eventDateKey(value: string, allDay: boolean): string {
  if (allDay) {
    return value.slice(0, 10);
  }
  return toDateString(new Date(value));
}

/** 'HH:mm' */
export function formatTime(dateTime: string): string {
  const date = new Date(dateTime);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/** 'M/D HH:mm' */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${formatTime(value)}`;
}

/** 'YYYY-MM-DD' から '9月23日（火）' のような表示 */
export function formatDateLabel(dateString: string): string {
  const date = fromDateString(dateString);
  const weekday = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日（${weekday}）`;
}
