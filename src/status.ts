// The status bar item: 5-hour and weekly quota, and the context of this workspace's latest session.
import * as vscode from 'vscode';
import { fmtClock, fmtCountdown, fmtTokens, t, textBar } from './format';
import type { Key, Lang } from './format';
import type { RpcClient } from './rpc';

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

export type Level = 'normal' | 'warning' | 'error';
export interface StatusView { text: string; tooltip: string; level: Level }

/** What differs between the products that show this item (Bumeter, Claude Code Usage). */
export interface StatusOptions {
  id: string;
  name: string;
  /** Command run on click. */
  click: string;
  /** Item text when there are no numbers yet. */
  fallback: string;
  /** Tooltip line when there are no 5h/7d numbers. */
  noLimits: Key;
  /** Links at the bottom of the tooltip. */
  links: { key: Key; command: string }[];
}

export const BUMETER_STATUS: StatusOptions = {
  id: 'bumeter.status',
  name: 'Bumeter',
  click: 'bumeter.openOverview',
  fallback: 'Bumeter',
  noLimits: 'noLimits',
  links: [{ key: 'openOverview', command: 'bumeter.openOverview' }, { key: 'refresh', command: 'bumeter.refresh' }],
};

/** A session counts as current when its last call is this recent. */
export const ACTIVE_SECS = 30 * 60;
/** Quota share from which the item turns yellow / red. */
export const WARN_PCT = 70;
export const ERROR_PCT = 90;

/** What the item shows, from the host's answers. Pure, for tests. */
export function renderStatus(limits: LimitState | null, now: ProjectNow | null, project: string | null, lang: Lang, nowSecs: number, o: StatusOptions = BUMETER_STATUS): StatusView {
  const parts: string[] = [];
  const lines: string[] = [];
  let level: Level = 'normal';
  const raise = (l: Level) => { if (l === 'error' || (l === 'warning' && level === 'normal')) level = l; };

  const win = (short: string, name: string, w: Window | null, f: Forecast | null | undefined) => {
    if (!w) return;
    const pct = Math.round(w.used_percentage);
    parts.push(`${short} ${pct}%`);
    if (pct >= ERROR_PCT) raise('error');
    else if (pct >= WARN_PCT || f?.at_risk) raise('warning');
    lines.push(`**${name}** \`${textBar(pct)}\` ${pct}% · ${t(lang, 'resetsAt', { time: fmtClock(w.resets_at), left: fmtCountdown(w.resets_at, nowSecs) })}`);
    if (f?.at_risk && f.hits_at != null) lines.push(`$(warning) ${t(lang, 'hitsAt', { time: fmtClock(f.hits_at) })}`);
  };
  if (limits) {
    win('5h', t(lang, 'fiveHour'), limits.five_hour, limits.forecast_five_hour);
    win('7d', t(lang, 'sevenDay'), limits.seven_day, limits.forecast_seven_day);
    if (limits.blocked && limits.blocked.resets_at > nowSecs) {
      raise('error');
      lines.unshift(`$(error) ${t(lang, 'blocked', { time: fmtClock(limits.blocked.resets_at) })}`);
    }
    if (limits.stale) lines.push(`_${t(lang, 'stale')}_`);
  }
  if (!parts.length) lines.push(t(lang, o.noLimits));

  const latest = now?.latest;
  if (latest && project) {
    const age = nowSecs - Date.parse(latest.ts) / 1000;
    if (age >= 0 && age <= ACTIVE_SECS) {
      const over = latest.context > (now?.context_threshold ?? Infinity);
      parts.push(`ctx ${fmtTokens(latest.context)}${over ? ' $(warning)' : ''}`);
      if (over) raise('warning');
      lines.push(`${t(lang, 'ctx', { project, ctx: fmtTokens(latest.context) })}${over ? ` — ${t(lang, 'ctxOver', { limit: fmtTokens(now!.context_threshold) })}` : ''}`);
    }
  }

  const text = `$(flame) ${parts.length ? parts.join(' · ') : o.fallback}`;
  lines.push('', o.links.map((l) => `[${t(lang, l.key)}](command:${l.command})`).join(' · '));
  return { text, tooltip: lines.join('\n\n'), level };
}

/** Polls the host and keeps the item up to date. */
export class StatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private hidden = false;

  /** `o` is read on every refresh, so a product may change its links or hint as its state changes. */
  constructor(private readonly rpc: RpcClient, private readonly project: string | null, private readonly lang: Lang, private readonly o: StatusOptions = BUMETER_STATUS, pollMs = 30_000) {
    this.item = vscode.window.createStatusBarItem(o.id, vscode.StatusBarAlignment.Right, 100);
    this.item.name = o.name;
    this.item.command = o.click;
    this.show({ text: `$(sync~spin) ${t(lang, 'scanning').replace('Bumeter: ', '')}`, tooltip: t(lang, 'scanning'), level: 'normal' });
    this.timer = setInterval(() => void this.refresh(), pollMs);
  }

  /** Hide the item while another product shows the same numbers (Claude Code Usage next to Bumeter). */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    if (hidden) this.item.hide();
    else this.item.show();
  }

  scanning(): void {
    this.show({ text: '$(sync~spin) Bumeter', tooltip: t(this.lang, 'scanning'), level: 'normal' });
  }

  async refresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const [limits, now] = await Promise.all([
        this.rpc.call<LimitState>('limit_state'),
        this.project ? this.rpc.call<ProjectNow>('project_now', { project: this.project }).catch(() => null) : Promise.resolve(null),
      ]);
      this.show(renderStatus(limits, now, this.project, this.lang, Date.now() / 1000, this.o));
    } catch (e) {
      this.show({ text: '$(flame) $(error)', tooltip: `${t(this.lang, 'error')}: ${(e as Error).message}`, level: 'error' });
    } finally {
      this.busy = false;
    }
  }

  private show(v: StatusView): void {
    this.item.text = v.text;
    const md = new vscode.MarkdownString(v.tooltip, true);
    md.isTrusted = { enabledCommands: this.o.links.map((l) => l.command) };
    this.item.tooltip = md;
    this.item.backgroundColor = v.level === 'error' ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : v.level === 'warning' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    if (!this.hidden) this.item.show();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
