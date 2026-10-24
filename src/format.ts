// Pure formatting and the wording shared by every Bumeter extension. Each product keeps its own
// strings next to it and builds its `t` with `localize`.

export type Lang = 'vi' | 'en';

export const langOf = (vscodeLanguage: string): Lang => (vscodeLanguage.toLowerCase().startsWith('vi') ? 'vi' : 'en');

/** 950, 12K, 3.4M — the app's style. */
export function fmtTokens(n: number): string {
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.floor(n / 1_000)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "1h30", "45m", "3d4h" until a unix time (seconds). */
export function fmtCountdown(untilSecs: number, nowSecs: number): string {
  const s = Math.max(0, Math.round(untilSecs - nowSecs));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}m`;
}

/** Local HH:MM of a unix time (seconds). */
export function fmtClock(secs: number): string {
  const d = new Date(secs * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** A text bar for tooltips: ▰▰▰▱▱▱▱▱▱▱ */
export function textBar(pct: number, width = 10): string {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '▰'.repeat(full) + '▱'.repeat(width - full);
}

/** A finer bar for the status bar, in eighths of a cell: ██████▍░░░ */
export function smoothBar(pct: number, width = 6): string {
  const eighths = Math.max(0, Math.min(width * 8, Math.round((pct / 100) * width * 8)));
  const full = Math.floor(eighths / 8);
  const part = eighths % 8 ? '▏▎▍▌▋▊▉'[(eighths % 8) - 1] : '';
  return ('█'.repeat(full) + part).padEnd(width, '░');
}

const STRINGS = {
  vi: {
    fiveHour: '5 giờ', sevenDay: '7 ngày', resetsAt: 'reset {time} · còn {left}', hitsAt: 'theo tốc độ này chạm 100% lúc {time}',
    blocked: 'Đang bị chặn đến {time}', stale: 'Số hạn mức đã cũ (Claude Code chưa gửi số mới).',
    ctx: 'Phiên mới nhất của {project}: context {ctx}', ctxOver: 'vượt ngưỡng {limit}, nên /compact.',
    sbHits: '→ 100% lúc {time}', sbSafe: '✓ đủ đến reset', sbLeft: '{five} · {seven} còn', sbReset: 'reset {time}',
    scanning: 'Bumeter: đang đọc log…', noBum: 'Bumeter: không tìm thấy lệnh `bum`', error: 'Bumeter: lỗi', refresh: 'Làm mới',
  },
  en: {
    fiveHour: '5-hour', sevenDay: 'Weekly', resetsAt: 'resets {time} · in {left}', hitsAt: 'at this pace it hits 100% at {time}',
    blocked: 'Blocked until {time}', stale: 'Quota numbers are stale (Claude Code has not sent new ones).',
    ctx: 'Latest session of {project}: context {ctx}', ctxOver: 'over the {limit} threshold, consider /compact.',
    sbHits: '→ 100% at {time}', sbSafe: '✓ lasts to reset', sbLeft: '{five} · {seven} left', sbReset: 'resets {time}',
    scanning: 'Bumeter: reading logs…', noBum: 'Bumeter: `bum` command not found', error: 'Bumeter: error', refresh: 'Refresh',
  },
} as const;

export type Strings<K extends string> = Record<Lang, Record<K, string>>;

/** A `t(lang, key, params)` over a table of strings; `{name}` in a string is replaced by `params.name`. */
export function localize<K extends string>(table: Strings<K>) {
  return (lang: Lang, key: K, params: Record<string, string | number> = {}): string =>
    table[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

export type Key = keyof typeof STRINGS.en;

/** The shared strings. */
export const t = localize<Key>(STRINGS);
