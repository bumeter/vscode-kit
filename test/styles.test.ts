import { describe, expect, it } from 'vitest';
import { smoothBar } from '../src/format';
import { fillTemplate, STYLE_IDS, styleSegments, usageVars } from '../src/styles';
import type { Usage } from '../src/styles';
import { renderStatus, StatusBar } from '../src/status';
import type { StatusOptions } from '../src/status';
import { statusItems } from './vscode';

const NOW = Date.parse('2026-10-24T10:00:00Z') / 1000;
const clock = (secs: number) => { const d = new Date(secs * 1000); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const usage = (five: number, seven: number, extra: Partial<Usage> = {}): Usage => ({
  five: { pct: five, resetsAt: NOW + 4_800, hitsAt: null, atRisk: false },
  seven: { pct: seven, resetsAt: NOW + 86_400 * 3 + 14_400, hitsAt: null, atRisk: false },
  ctx: { tokens: 312_000, threshold: 400_000 },
  blockedUntil: null,
  ...extra,
});
const text = (style: Parameters<typeof styleSegments>[0], u: Usage, template?: string) =>
  styleSegments(style, u, NOW, 'en', template).map((s) => s.text).join(' | ');

describe('styles', () => {
  const u = usage(62, 41);

  it('draw the same numbers each their own way', () => {
    expect(text('classic', u)).toBe('$(flame) 5h 62% · 7d 41% · ctx 312K');
    expect(text('countdown', u)).toBe('$(flame) 5h 62% ↻1h20 · 7d 41% ↻3d4h');
    expect(text('forecast', u)).toBe('$(flame) 5h 62% ✓ lasts to reset');
    expect(text('smooth', u)).toBe('5h ███▊░░ 62% · 7d ██▌░░░');
    expect(text('split', u)).toBe('$(flame) 62% | $(calendar) 41% | $(layers) 312K');
    expect(text('compact', u)).toBe('$(flame) 62% · 41%');
    expect(text('bars', u)).toBe('5h ▰▰▰▰▰▰▱▱▱▱  7d ▰▰▰▰▱▱▱▱▱▱');
    expect(text('traffic', u)).toBe('🟢 5h 62%  🟢 7d 41%');
    expect(text('resetclock', u)).toBe(`$(flame) 5h 62% · resets ${clock(NOW + 4_800)}`);
    expect(text('battery', u)).toBe('🔋 38% · 59% left');
    expect(text('peak', u)).toBe('$(flame) 5h 62%');
    expect(text('context', u)).toBe('$(layers) 312K ▰▰▰▰▰▰▱▱ · 5h 62%');
    expect(text('minimal', u)).toBe('$(flame) 62');
  });

  it('every style has a test above', () => {
    expect(STYLE_IDS).toHaveLength(13);
  });

  it('forecast names the time it runs out; peak picks the fuller window', () => {
    const risky = usage(78, 85, { five: { pct: 78, resetsAt: NOW + 3_000, hitsAt: NOW + 1_800, atRisk: true } });
    expect(text('forecast', risky)).toBe(`$(flame) 5h 78% → 100% at ${clock(NOW + 1_800)}`);
    expect(text('peak', risky)).toBe('$(flame) 7d 85%');
    expect(styleSegments('forecast', risky, NOW, 'vi')[0].text).toContain('→ 100% lúc');
  });

  it('colour: one level for the item, one per item in split; traffic and battery keep the plain background', () => {
    const hot = usage(94, 41, { ctx: { tokens: 450_000, threshold: 400_000 } });
    expect(styleSegments('classic', hot, NOW, 'en')[0].level).toBe('error');
    expect(styleSegments('split', hot, NOW, 'en').map((s) => s.level)).toEqual(['error', 'normal', 'warning']);
    expect(styleSegments('split', hot, NOW, 'en').map((s) => s.part)).toEqual(['5h', '7d', 'ctx']);
    expect(styleSegments('traffic', hot, NOW, 'en')[0]).toEqual({ text: '🔴 5h 94%  🟢 7d 41%', level: 'normal' });
    expect(text('battery', usage(85, 41))).toBe('🪫 15% · 59% left');
  });

  it('blocked: the time it lifts, red', () => {
    const b = usage(100, 83, { blockedUntil: NOW + 600 });
    expect(text('compact', b)).toBe(`$(flame) 100% · 83% $(error) ${clock(NOW + 600)}`);
    expect(text('forecast', b)).toBe(`$(error) Blocked until ${clock(NOW + 600)}`);
    expect(styleSegments('traffic', b, NOW, 'en')[0].level).toBe('normal');
    expect(styleSegments('minimal', b, NOW, 'en')[0].level).toBe('error');
  });

  it('missing numbers: one window, no context, nothing at all, an unknown style', () => {
    const only7 = usage(0, 41, { five: null, ctx: null });
    expect(text('compact', only7)).toBe('$(flame) 41%');
    expect(text('forecast', only7)).toBe('$(flame) 7d 41% ✓ lasts to reset');
    expect(text('context', only7)).toBe('7d 41%');
    expect(text('split', only7)).toBe('$(calendar) 41%');
    const ctxOnly: Usage = { five: null, seven: null, ctx: { tokens: 90_000, threshold: 400_000 }, blockedUntil: null };
    expect(text('bars', ctxOnly)).toBe('$(flame) ctx 90K');
    expect(styleSegments('minimal', { ...ctxOnly, ctx: null }, NOW, 'en')).toEqual([]);
    expect(text('nope' as never, u)).toBe('$(flame) 5h 62% · 7d 41% · ctx 312K');
  });
});

describe('custom template', () => {
  it('fills the values and keeps icons', () => {
    expect(text('custom', usage(62, 41), '$(flame) {5h} | {7d} | ctx {ctxPct} {5hReset}')).toBe('$(flame) 62% | 41% | ctx 78% 1h20');
    expect(text('custom', usage(62, 41, { seven: null }), '{7d} {smooth5h} {light5h} {bogus}')).toBe('– ███▊░░ 🟢 {bogus}');
  });
  it('an empty template draws classic', () => {
    expect(text('custom', usage(62, 41), '  ')).toBe('$(flame) 5h 62% · 7d 41% · ctx 312K');
  });
  it('every variable has a value', () => {
    const vars = usageVars(usage(62, 41), NOW);
    expect(Object.entries(vars).filter(([k, v]) => !v && k !== 'blocked')).toEqual([]);
    expect(fillTemplate('{peak} {5hHits}', vars)).toBe('5h 62% –');
  });
});

describe('smoothBar', () => {
  it('eighths of a cell', () => {
    expect([smoothBar(0), smoothBar(50), smoothBar(100), smoothBar(150)]).toEqual(['░░░░░░', '███░░░', '██████', '██████']);
    expect(smoothBar(62)).toBe('███▊░░');
  });
});

describe('StatusBar with styles', () => {
  const opts: StatusOptions = { id: 'x.status', name: 'X', click: 'x.click', fallback: 'X', noLimits: '', links: [] };
  const limits = { five_hour: { used_percentage: 62, resets_at: NOW + 4_800 }, seven_day: { used_percentage: 41, resets_at: NOW + 86_400 }, stale: false, blocked: null };

  it('renderStatus follows the chosen style', () => {
    expect(renderStatus(limits, null, null, 'en', NOW, { ...opts, style: 'compact' }).text).toBe('$(flame) 62% · 41%');
    expect(renderStatus(limits, null, null, 'en', NOW, { ...opts, style: 'split' }).items).toHaveLength(2);
  });

  it('adds and removes items as the style changes, and redraws without asking again', async () => {
    let calls = 0;
    const rpc = { call: async (m: string) => { calls++; return m === 'limit_state' ? limits : null; } };
    const o: StatusOptions = { ...opts };
    const before = statusItems.length;
    const bar = new StatusBar(rpc as never, null, 'en', o, 1e9);
    await bar.refresh();
    expect(statusItems.length - before).toBe(1);
    o.style = 'split';
    bar.redraw();
    expect(statusItems.length - before).toBe(2);
    expect(statusItems.slice(before).map((i) => i.text)).toEqual(['$(flame) 62%', '$(calendar) 41%']);
    expect(calls).toBe(1);
    o.style = 'bars';
    bar.redraw();
    expect(statusItems[before].text).toBe('5h ▰▰▰▰▰▰▱▱▱▱  7d ▰▰▰▰▱▱▱▱▱▱');
    bar.dispose();
  });
});
