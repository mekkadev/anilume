export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (value: number) => value.toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`;
}

export function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function episodesLabel(count: number) {
  return `${count} ${plural(count, "серия", "серии", "серий")}`;
}

export function relativeTime(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 90) return "только что";
  if (diff < 3600) {
    const minutes = Math.round(diff / 60);
    return `${minutes} ${plural(minutes, "минуту", "минуты", "минут")} назад`;
  }
  if (diff < 86400) {
    const hours = Math.round(diff / 3600);
    return `${hours} ${plural(hours, "час", "часа", "часов")} назад`;
  }
  const days = Math.round(diff / 86400);
  if (days < 30) return `${days} ${plural(days, "день", "дня", "дней")} назад`;

  return new Date(unixSeconds * 1000).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

export function qualityLabel(quality: number) {
  if (quality >= 2160) return "4K";
  if (quality >= 1440) return "2K";
  return `${quality}p`;
}

export function fileSize(bytes: number): string {
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function truncate(text: string, limit: number) {
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

export function extractToken(pasted: string) {
  const text = pasted.trim();
  if (text.length === 0) return "";

  const fromHeader = text.match(
    /authorization["'\s:]*\s*(?:bearer\s+)?([A-Za-z0-9._~+/=-]{20,})/i,
  );
  if (fromHeader) return fromHeader[1]!;

  const bare = text.replace(/^bearer\s+/i, "").trim();
  const single = bare.match(/^([A-Za-z0-9._~+/=-]{20,})$/);
  if (single) return single[1]!;

  const anyJwt = text.match(/\beyJ[A-Za-z0-9._~+/=-]{20,}/);
  return anyJwt ? anyJwt[0] : bare;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}
