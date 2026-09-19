export function formatClock(date) {
  return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(date) {
  const d = new Date(date);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a, b) => a.toDateString() === b.toDateString();

  if (isSameDay(d, today)) return "Today";
  if (isSameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export function formatListTime(date) {
  const d = new Date(date);
  const today = new Date();
  const diffDays = Math.floor((today - d) / (1000 * 60 * 60 * 24));

  if (d.toDateString() === today.toDateString()) return formatClock(date);
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatLastSeen(date, isOnline) {
  if (isOnline) return "online";
  if (!date) return "";
  const d = new Date(date);
  const diffMin = Math.floor((Date.now() - d) / 60000);
  if (diffMin < 1) return "last seen just now";
  if (diffMin < 60) return `last seen ${diffMin}m ago`;
  if (diffMin < 60 * 24) return `last seen ${Math.floor(diffMin / 60)}h ago`;
  return `last seen ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
