// The status bar item: 5-hour and weekly quota, and the context of this workspace's latest session.
import * as vscode from 'vscode';
import { fmtClock, fmtCountdown, fmtTokens, t, textBar } from './format';
import type { Lang } from './format';
import type { RpcClient } from './rpc';
import { styleSegments, usageLevel } from './styles';
import type { Level, Segment, StyleChoice, Usage, UsageWindow } from './styles';

export interface Window { used_percentage: number; resets_at: number }
export interface Forecast { hits_at: number | null; at_risk: boolean }
export interface LimitState {
  five_hour: Window | null;
  seven_day: Window | null;
  stale: boolean;
  blocked: { limit_type: string; resets_at: number } | null;
  forecast_five_hour?: Forecast | null;
  forecast_seven_day?: Forecast | null;
}
export interface ProjectNow { latest: { session_id: string; ts: string; context: number } | null; context_threshold: number }

/** `items` are the status bar items left to right; `text` is all of them, for logs and tests. */
export interface StatusView { text: string; items: Segment[]; tooltip: string; level: Level }

/** What differs between the products that show this item (Bumeter, Claude Code Usage). Texts are already in the user's language. */
export interface StatusOptions {
  id: string;
  name: string;
  /** Command run on click. */
  click: string;
  /** Item text when there are no numbers yet. */
  fallback: string;
  /** Tooltip line when there are no 5h/7d numbers. */
  noLimits: string;
  /** Links at the bottom of the tooltip. */
  links: { label: string; command: string }[];
  /** How the numbers are drawn; `classic` when left out. */
  style?: StyleChoice;
  /** The template of the `custom` style. */
  template?: string;
}

/** A session counts as current when its last call is this recent. */
export const ACTIVE_SECS = 30 * 60;

/** The numbers the styles draw: 5h/7d rounded, and the context only while its session is current. */
export function usageOf(limits: LimitState | null, now: ProjectNow | null, project: string | null, nowSecs: number): Usage {
  const win = (w: Window | null | undefined, f: Forecast | null | undefined): UsageWindow | null =>
    w ? { pct: Math.round(w.used_percentage), resetsAt: w.resets_at, hitsAt: f?.hits_at ?? null, atRisk: !!f?.at_risk } : null;
  const latest = now?.latest;
  const age = latest ? nowSecs - Date.parse(latest.ts) / 1000 : -1;
  return {
    five: win(limits?.five_hour, limits?.forecast_five_hour),
    seven: win(limits?.seven_day, limits?.forecast_seven_day),
    ctx: latest && project && age >= 0 && age <= ACTIVE_SECS ? { tokens: latest.context, threshold: now?.context_threshold ?? Infinity } : null,
    blockedUntil: limits?.blocked && limits.blocked.resets_at > nowSecs ? limits.blocked.resets_at : null,
  };
}

/** What the item shows, from the host's answers. Pure, for tests. */
export function renderStatus(limits: LimitState | null, now: ProjectNow | null, project: string | null, lang: Lang, nowSecs: number, o: StatusOptions): StatusView {
  const u = usageOf(limits, now, project, nowSecs);
  const lines: string[] = [];
  const win = (name: string, w: UsageWindow | null) => {
    if (!w) return;
    lines.push(`**${name}** \`${textBar(w.pct)}\` ${w.pct}% · ${t(lang, 'resetsAt', { time: fmtClock(w.resetsAt), left: fmtCountdown(w.resetsAt, nowSecs) })}`);
    if (w.atRisk && w.hitsAt != null) lines.push(`$(warning) ${t(lang, 'hitsAt', { time: fmtClock(w.hitsAt) })}`);
  };
  win(t(lang, 'fiveHour'), u.five);
  win(t(lang, 'sevenDay'), u.seven);
  if (u.blockedUntil != null) lines.unshift(`$(error) ${t(lang, 'blocked', { time: fmtClock(u.blockedUntil) })}`);
  if (limits?.stale) lines.push(`_${t(lang, 'stale')}_`);
  if (!u.five && !u.seven) lines.push(o.noLimits);
  if (u.ctx && project) {
    const over = u.ctx.tokens > u.ctx.threshold;
    lines.push(`${t(lang, 'ctx', { project, ctx: fmtTokens(u.ctx.tokens) })}${over ? ` — ${t(lang, 'ctxOver', { limit: fmtTokens(u.ctx.threshold) })}` : ''}`);
  }
  lines.push('', o.links.map((l) => `[${l.label}](command:${l.command})`).join(' · '));

  const level = usageLevel(u);
  let items = styleSegments(o.style ?? 'classic', u, nowSecs, lang, o.template);
  if (!items.length) items = [{ text: `$(flame) ${o.fallback}`, level }];
  return { text: items.map((i) => i.text).join('  '), items, tooltip: lines.join('\n\n'), level };
}

/** Polls the host and keeps the item(s) up to date. */
export class StatusBar implements vscode.Disposable {
  /** One item per segment; the first keeps the product's id, so a user's "hide" sticks across styles. */
  private items: vscode.StatusBarItem[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private hidden = false;
  private last: { limits: LimitState; now: ProjectNow | null } | undefined;

  /** `o` is read on every refresh, so a product may change its links, hint or style as its state changes. */
  constructor(private readonly rpc: RpcClient, private readonly project: string | null, private readonly lang: Lang, private readonly o: StatusOptions, pollMs = 30_000) {
    this.show({ text: '', items: [{ text: `$(sync~spin) ${t(lang, 'scanning').replace('Bumeter: ', '')}`, level: 'normal' }], tooltip: t(lang, 'scanning'), level: 'normal' });
    this.timer = setInterval(() => void this.refresh(), pollMs);
  }

  /** Hide the item while another product shows the same numbers (Claude Code Usage next to Bumeter). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const i of this.items) {
      if (hidden) i.hide();
      else i.show();
    }
  }

  scanning(): void {
    this.show({ text: '', items: [{ text: '$(sync~spin) Bumeter', level: 'normal' }], tooltip: t(this.lang, 'scanning'), level: 'normal' });
  }

  /** Draw the last numbers again, without asking the host: for a style preview. */
  redraw(): void {
    if (this.last) this.show(renderStatus(this.last.limits, this.last.now, this.project, this.lang, Date.now() / 1000, this.o));
  }

  async refresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const [limits, now] = await Promise.all([
        this.rpc.call<LimitState>('limit_state'),
        this.project ? this.rpc.call<ProjectNow>('project_now', { project: this.project }).catch(() => null) : Promise.resolve(null),
      ]);
      this.last = { limits, now };
      this.redraw();
    } catch (e) {
      this.show({ text: '', items: [{ text: '$(flame) $(error)', level: 'error' }], tooltip: `${t(this.lang, 'error')}: ${(e as Error).message}`, level: 'error' });
    } finally {
      this.busy = false;
    }
  }

  private show(v: StatusView): void {
    while (this.items.length > v.items.length) this.items.pop()!.dispose();
    const md = new vscode.MarkdownString(v.tooltip, true);
    md.isTrusted = { enabledCommands: this.o.links.map((l) => l.command) };
    v.items.forEach((seg, i) => {
      if (!this.items[i]) {
        const item = vscode.window.createStatusBarItem(i ? `${this.o.id}.${i}` : this.o.id, vscode.StatusBarAlignment.Right, 100 - i / 100);
        item.command = this.o.click;
        this.items.push(item);
      }
      const item = this.items[i];
      item.name = seg.part ? `${this.o.name} (${seg.part})` : this.o.name;
      item.text = seg.text;
      item.tooltip = md;
      item.backgroundColor = seg.level === 'error' ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : seg.level === 'warning' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      if (!this.hidden) item.show();
    });
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    for (const i of this.items) i.dispose();
    this.items = [];
  }
}
