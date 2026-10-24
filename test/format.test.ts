import { describe, expect, it } from 'vitest';
import { fmtCountdown, fmtTokens, langOf, localize, t, textBar } from '../src/format';

describe('format', () => {
  it('tokens like the app', () => {
    expect([fmtTokens(950), fmtTokens(12_400), fmtTokens(3_420_000)]).toEqual(['950', '12K', '3.4M']);
  });
  it('countdowns', () => {
    expect(fmtCountdown(5_400, 0)).toBe('1h30');
    expect(fmtCountdown(2_700, 0)).toBe('45m');
    expect(fmtCountdown(86_400 * 3 + 3_600 * 4, 0)).toBe('3d4h');
    expect(fmtCountdown(0, 100)).toBe('0m');
  });
  it('text bars', () => {
    expect(textBar(62)).toBe('▰▰▰▰▰▰▱▱▱▱');
    expect(textBar(150)).toBe('▰'.repeat(10));
  });
  it('language and wording', () => {
    expect([langOf('vi'), langOf('vi-VN'), langOf('en-US'), langOf('ja')]).toEqual(['vi', 'vi', 'en', 'en']);
    expect(t('en', 'resetsAt', { time: '14:30', left: '1h20' })).toBe('resets 14:30 · in 1h20');
    expect(t('vi', 'refresh')).toBe('Làm mới');
  });
  it('a product builds its own t with localize; a missing param stays visible', () => {
    const own = localize({ vi: { hi: 'Chào {name}' }, en: { hi: 'Hi {name}' } });
    expect(own('en', 'hi', { name: 'Bum' })).toBe('Hi Bum');
    expect(own('vi', 'hi')).toBe('Chào {name}');
  });
});
