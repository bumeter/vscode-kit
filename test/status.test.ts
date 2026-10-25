import { describe, expect, it } from 'vitest';
import { renderStatus } from '../src/status';
import type { LimitState, ProjectNow, StatusOptions } from '../src/status';

const OPTS: StatusOptions = {
  id: 'bumeter.status', name: 'Bumeter', click: 'bumeter.openOverview', fallback: 'Bumeter',
  noLimits: 'No 5h/7d numbers yet: use `bum statusline`.',
  links: [{ label: 'Open Overview', command: 'bumeter.openOverview' }, { label: 'Refresh', command: 'bumeter.refresh' }],
};

const NOW = Date.parse('2026-10-24T10:00:00Z') / 1000;
const limits = (five: number, seven: number, extra: Partial<LimitState> = {}): LimitState => ({
  five_hour: { used_percentage: five, resets_at: NOW + 5_400 }, seven_day: { used_percentage: seven, resets_at: NOW + 86_400 * 3 }, stale: false, blocked: null, ...extra,
});
const now = (context: number, minutesAgo: number): ProjectNow => ({ latest: { session_id: 's', ts: new Date((NOW - minutesAgo * 60) * 1000).toISOString(), context }, context_threshold: 300_000 });

describe('renderStatus', () => {
  it('shows both windows and the current session context', () => {
    const v = renderStatus(limits(62, 41), now(180_000, 5), 'bumeter', 'en', NOW, OPTS);
    expect(v.text).toBe('$(flame) 5h 62% · 7d 41% · ctx 180K');
    expect(v.level).toBe('normal');
    expect(v.tooltip).toContain('**5-hour** `▰▰▰▰▰▰▱▱▱▱` 62% · resets');
    expect(v.tooltip).toContain('Latest session of bumeter: context 180K');
    expect(v.tooltip).toContain('command:bumeter.openOverview');
  });

  it('turns yellow past 70% or a large context, red past 90% or when blocked', () => {
    expect(renderStatus(limits(75, 10), null, null, 'en', NOW, OPTS).level).toBe('warning');
    const big = renderStatus(limits(10, 10), now(312_000, 1), 'p', 'en', NOW, OPTS);
    expect(big.level).toBe('warning');
    expect(big.text).toContain('ctx 312K $(warning)');
    expect(big.tooltip).toContain('consider /compact');
    expect(renderStatus(limits(95, 10), null, null, 'en', NOW, OPTS).level).toBe('error');
    const blocked = renderStatus(limits(100, 10, { blocked: { limit_type: 'five_hour', resets_at: NOW + 600 } }), null, null, 'vi', NOW, OPTS);
    expect(blocked.level).toBe('error');
    expect(blocked.tooltip.startsWith('$(error) Đang bị chặn đến')).toBe(true);
  });

  it('a forecast that runs out before the reset is a warning, with the time', () => {
    const v = renderStatus(limits(40, 10, { forecast_five_hour: { hits_at: NOW + 1_800, at_risk: true } }), null, null, 'en', NOW, OPTS);
    expect(v.level).toBe('warning');
    expect(v.tooltip).toContain('at this pace it hits 100%');
  });

  it('an old session is not "current"; no numbers says how to get them', () => {
    expect(renderStatus(limits(10, 10), now(500_000, 120), 'p', 'en', NOW, OPTS).text).not.toContain('ctx');
    const none = renderStatus({ five_hour: null, seven_day: null, stale: false, blocked: null }, null, null, 'en', NOW, OPTS);
    expect(none.text).toBe('$(flame) Bumeter');
    expect(none.tooltip).toContain('bum statusline');
  });
});

describe('renderStatus options', () => {
  const usage: StatusOptions = { id: 'claudeUsage.status', name: 'Claude Code Usage', click: 'claudeUsage.click', fallback: '5h/7d: set up',
    noLimits: 'Click to set up quota tracking.', links: [{ label: 'Set up', command: 'claudeUsage.setupTracking' }] };

  it('the product\'s own fallback text, hint and links', () => {
    const v = renderStatus({ five_hour: null, seven_day: null, stale: false, blocked: null }, null, null, 'en', NOW, usage);
    expect(v.text).toBe('$(flame) 5h/7d: set up');
    expect(v.tooltip).toContain('Click to set up quota tracking.');
    expect(v.tooltip).toContain('[Set up](command:claudeUsage.setupTracking)');
    expect(v.tooltip).not.toContain('bumeter.openOverview');
  });

  it('the same numbers whatever the product', () => {
    expect(renderStatus(limits(62, 41), now(180_000, 5), 'p', 'en', NOW, usage).text).toBe('$(flame) 5h 62% · 7d 41% · ctx 180K');
  });
});

describe('renderStatus title, html and extra', () => {
  const rich: StatusOptions = { ...OPTS, title: 'Claude Code Usage', html: true, extra: () => '---\n\n**Today** 12.4M tokens' };

  it('a bold title first, coloured percentages, the extra lines before the links', () => {
    const v = renderStatus(limits(75, 41), null, null, 'en', NOW, rich);
    expect(v.tooltip.startsWith('**Claude Code Usage**')).toBe(true);
    expect(v.tooltip).toContain('<span style="color:#d29922;">75%</span>');
    expect(v.tooltip).toContain('<span style="color:#3fb950;">41%</span>');
    expect(v.tooltip.indexOf('**Today**')).toBeGreaterThan(v.tooltip.indexOf('Weekly'));
    expect(v.tooltip.indexOf('**Today**')).toBeLessThan(v.tooltip.indexOf('[Open Overview]'));
  });

  it('the title stays first when blocked', () => {
    const v = renderStatus(limits(100, 10, { blocked: { limit_type: 'five_hour', resets_at: NOW + 600 } }), null, null, 'en', NOW, rich);
    expect(v.tooltip.startsWith('**Claude Code Usage**\n\n$(error)')).toBe(true);
    expect(v.tooltip).toContain('<span style="color:#f85149;">100%</span>');
  });

  it('the forecast line is red when at_risk, with html', () => {
    const v = renderStatus(limits(40, 10, { forecast_five_hour: { hits_at: NOW + 1_800, at_risk: true } }), null, null, 'en', NOW, rich);
    expect(v.tooltip).toContain('$(warning) <span style="color:#f85149;">at this pace it hits 100% at');
  });

  it('without them, or with an empty extra, the tooltip is exactly as before', () => {
    const before = renderStatus(limits(75, 41), now(180_000, 5), 'p', 'en', NOW, OPTS).tooltip;
    expect(renderStatus(limits(75, 41), now(180_000, 5), 'p', 'en', NOW, { ...OPTS, extra: () => '' }).tooltip).toBe(before);
    expect(before).not.toContain('<span');
  });
});

describe('StatusBar html', () => {
  it('lets the tooltip use HTML only when asked', async () => {
    const { StatusBar } = await import('../src/status');
    const { statusItems } = await import('./vscode');
    const rpc = { call: async (m: string) => (m === 'limit_state' ? limits(62, 41) : null) } as unknown as import('../src/rpc').RpcClient;
    for (const html of [true, false]) {
      statusItems.length = 0;
      const bar = new StatusBar(rpc, null, 'en', { ...OPTS, html });
      await bar.refresh();
      expect((statusItems.at(-1)!.tooltip as { supportHtml: boolean }).supportHtml).toBe(html);
      bar.dispose();
    }
  });
});
