const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

export function toChineseOrdinal(n: number): string {
  if (n <= 0) return String(n);
  if (n === 10) return "十";
  if (n < 10) return DIGITS[n];
  if (n < 20) return `十${DIGITS[n - 10]}`;
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${DIGITS[tens]}十${ones ? DIGITS[ones] : ""}`;
  }
  return String(n);
}

export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[1]}年${m[2]}月${m[3]}日`;
}

export function compactDate(iso: string): string {
  return iso.replaceAll("-", "");
}

export function createId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function defaultTitle(templateType: "weekly" | "biweekly"): string {
  return templateType === "biweekly" ? "双周工作总结" : "周工作总结";
}
