// The status bar styles: the same numbers drawn different ways, picked like a color theme. Pure, so
// tests and the style picker's live preview run without `vscode`.
import { fmtClock, fmtCountdown, fmtTokens, smoothBar, t, textBar } from './format';
import type { Lang } from './format';

export type Level = 'normal' | 'warning' | 'error';

/** One status bar item. Most styles have one; `split` has one per number. */
export interface Segment { text: string; level: Level; /** Which number, for the item's name: `5h`, `7d`, `ctx`. */ part?: string }

export interface UsageWindow { pct: number; resetsAt: number; hitsAt: number | null; atRisk: boolean }
/** What the styles draw: the host's answers, already reduced to what is current. */
export interface Usage {
  five: UsageWindow | null;
  seven: UsageWindow | null;
  /** The latest session of this workspace, when it is current. */
  ctx: { tokens: number; threshold: number } | null;
  /** Unix time Claude Code lets you work again, while blocked. */
  blockedUntil: number | null;
}

export const STYLE_IDS = ['classic', 'countdown', 'forecast', 'smooth', 'split', 'compact', 'bars', 'traffic', 'resetclock', 'battery', 'peak', 'context', 'minimal'] as const;
export type StyleId = (typeof STYLE_IDS)[number];
export type StyleChoice = StyleId | 'custom';

/** Quota share from which a number turns yellow / red. */
export const WARN_PCT = 70;
export const ERROR_PCT = 90;

const windowLevel = (w: UsageWindow | null): Level => (!w ? 'normal' : w.pct >= ERROR_PCT ? 'error' : w.pct >= WARN_PCT || w.atRisk ? 'warning' : 'normal');
const ctxOver = (u: Usage) => !!u.ctx && u.ctx.tokens > u.ctx.threshold;
const worst = (...ls: Level[]): Level => (ls.includes('error') ? 'error' : ls.includes('warning') ? 'warning' : 'normal');

/** The colour of the whole item: the worst of both windows, a large context, or blocked. */
export function usageLevel(u: Usage): Level {
  return u.blockedUntil != null ? 'error' : worst(windowLevel(u.five), windowLevel(u.seven), ctxOver(u) ? 'warning' : 'normal');
}

const pct = (w: UsageWindow) => `${w.pct}%`;
const light = (w: UsageWindow) => (w.pct >= ERROR_PCT ? '🔴' : w.pct >= WARN_PCT ? '🟡' : '🟢');
const ctxPct = (c: NonNullable<Usage['ctx']>) => Math.round((c.tokens / c.threshold) * 100);

/** The values a custom template may use, as `{name}`. A missing number is `–`. */
export const TEMPLATE_VARS = ['5h', '7d', '5hLeft', '7dLeft', '5hReset', '7dReset', '5hResetAt', '7dResetAt', '5hHits', 'ctx', 'ctxPct', 'bar5h', 'bar7d', 'barCtx', 'smooth5h', 'smooth7d', 'light5h', 'light7d', 'peak', 'blocked'] as const;

export function usageVars(u: Usage, nowSecs: number): Record<(typeof TEMPLATE_VARS)[number], string> {
  const w = (x: UsageWindow | null, f: (x: UsageWindow) => string) => (x ? f(x) : '–');
  const peak = peakWindow(u);
  return {
    '5h': w(u.five, pct), '7d': w(u.seven, pct),
    '5hLeft': w(u.five, (x) => `${100 - x.pct}%`), '7dLeft': w(u.seven, (x) => `${100 - x.pct}%`),
    '5hReset': w(u.five, (x) => fmtCountdown(x.resetsAt, nowSecs)), '7dReset': w(u.seven, (x) => fmtCountdown(x.resetsAt, nowSecs)),
    '5hResetAt': w(u.five, (x) => fmtClock(x.resetsAt)), '7dResetAt': w(u.seven, (x) => fmtClock(x.resetsAt)),
    '5hHits': u.five?.atRisk && u.five.hitsAt != null ? fmtClock(u.five.hitsAt) : '–',
    ctx: u.ctx ? fmtTokens(u.ctx.tokens) : '–', ctxPct: u.ctx ? `${ctxPct(u.ctx)}%` : '–',
    bar5h: w(u.five, (x) => textBar(x.pct)), bar7d: w(u.seven, (x) => textBar(x.pct)), barCtx: u.ctx ? textBar(ctxPct(u.ctx), 8) : '–',
    smooth5h: w(u.five, (x) => smoothBar(x.pct)), smooth7d: w(u.seven, (x) => smoothBar(x.pct)),
    light5h: w(u.five, light), light7d: w(u.seven, light),
    peak: peak ? `${peak[0]} ${pct(peak[1])}` : '–',
    blocked: u.blockedUntil != null ? fmtClock(u.blockedUntil) : '',
  };
}

/** `{name}` replaced by its value; unknown names are left as they are. `$(icon)` passes through to VS Code. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

/** The window closer to its limit (5h on a tie). */
function peakWindow(u: Usage): ['5h' | '7d', UsageWindow] | null {
  if (u.five && (!u.seven || u.five.pct >= u.seven.pct)) return ['5h', u.five];
  return u.seven ? ['7d', u.seven] : null;
}

/** The item(s) for a style, or `[]` when there is nothing to show yet. Without 5h/7d numbers every style draws like `classic`. */
export function styleSegments(style: StyleChoice, u: Usage, nowSecs: number, lang: Lang, template = ''): Segment[] {
  const level = usageLevel(u);
  const { five, seven } = u;
  const one = (text: string, l: Level = level): Segment[] => [{ text, level: l }];
  const join = (...parts: (string | null)[]) => parts.filter((p): p is string => !!p).join(' · ');
  const label = (name: string, w: UsageWindow | null, f: (w: UsageWindow) => string) => (w ? `${name} ${f(w)}` : null);
  const blocked = u.blockedUntil != null ? `$(error) ${fmtClock(u.blockedUntil)}` : null;
  const withBlocked = (s: Segment[]) => (blocked ? [{ ...s[0], text: `${s[0].text} ${blocked}` }, ...s.slice(1)] : s);

  if (!five && !seven || (style !== 'custom' && !STYLE_IDS.includes(style))) style = 'classic';
  switch (style) {
    case 'classic': {
      const ctx = u.ctx ? `ctx ${fmtTokens(u.ctx.tokens)}${ctxOver(u) ? ' $(warning)' : ''}` : null;
      const text = join(label('5h', five, pct), label('7d', seven, pct), ctx);
      return text ? one(`$(flame) ${text}`) : [];
    }
    case 'countdown':
      return withBlocked(one(`$(flame) ${join(label('5h', five, (w) => `${pct(w)} ↻${fmtCountdown(w.resetsAt, nowSecs)}`), label('7d', seven, (w) => `${pct(w)} ↻${fmtCountdown(w.resetsAt, nowSecs)}`))}`));
    case 'forecast': {
      if (u.blockedUntil != null) return one(`$(error) ${t(lang, 'blocked', { time: fmtClock(u.blockedUntil) })}`);
      const [name, w] = five ? ['5h', five] : ['7d', seven!];
      const ahead = w.atRisk && w.hitsAt != null ? t(lang, 'sbHits', { time: fmtClock(w.hitsAt) }) : t(lang, 'sbSafe');
      return one(`$(flame) ${name} ${pct(w)} ${ahead}`);
    }
    case 'smooth':
      return withBlocked(one(join(label('5h', five, (w) => `${smoothBar(w.pct)} ${pct(w)}`), label('7d', seven, (w) => smoothBar(w.pct)))));
    case 'split': {
      const s: Segment[] = [];
      if (five) s.push({ text: `$(flame) ${pct(five)}`, level: u.blockedUntil != null ? 'error' : windowLevel(five), part: '5h' });
      if (seven) s.push({ text: `$(calendar) ${pct(seven)}`, level: windowLevel(seven), part: '7d' });
      if (u.ctx) s.push({ text: `$(layers) ${fmtTokens(u.ctx.tokens)}`, level: ctxOver(u) ? 'warning' : 'normal', part: 'ctx' });
      return withBlocked(s);
    }
    case 'compact':
      return withBlocked(one(`$(flame) ${[five, seven].filter((w): w is UsageWindow => !!w).map(pct).join(' · ')}`));
    case 'bars':
      return withBlocked(one([label('5h', five, (w) => textBar(w.pct)), label('7d', seven, (w) => textBar(w.pct))].filter(Boolean).join('  ')));
    case 'traffic':
      return withBlocked(one([label('5h', five, pct), label('7d', seven, pct)].map((p, i) => p && `${light((i ? seven : five)!)} ${p}`).filter(Boolean).join('  '), 'normal'));
    case 'resetclock': {
      const [name, w] = five ? ['5h', five] : ['7d', seven!];
      return withBlocked(one(`$(flame) ${name} ${pct(w)} · ${t(lang, 'sbReset', { time: fmtClock(w.resetsAt) })}`));
    }
    case 'battery': {
      const left = (w: UsageWindow | null) => (w ? `${100 - w.pct}%` : '–');
      const low = Math.min(five ? 100 - five.pct : 100, seven ? 100 - seven.pct : 100) <= 20;
      return withBlocked(one(`${low ? '🪫' : '🔋'} ${t(lang, 'sbLeft', { five: left(five), seven: left(seven) })}`, 'normal'));
    }
    case 'peak': {
      const [name, w] = peakWindow(u)!;
      return withBlocked(one(`$(flame) ${name} ${pct(w)}`));
    }
    case 'context': {
      const ctx = u.ctx ? `$(layers) ${fmtTokens(u.ctx.tokens)} ${textBar(ctxPct(u.ctx), 8)}` : null;
      return withBlocked(one(join(ctx, label('5h', five, pct) ?? label('7d', seven, pct))));
    }
    case 'minimal':
      return withBlocked(one(`$(flame) ${(five ?? seven)!.pct}`));
    case 'custom': {
      const text = fillTemplate(template.trim(), usageVars(u, nowSecs)).trim();
      return text ? one(text) : styleSegments('classic', u, nowSecs, lang);
    }
  }
}
