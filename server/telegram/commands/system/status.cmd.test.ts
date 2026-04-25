// @responsibility: status.cmd.ts 회귀 — formatStatusMessage 11항목 + KIS/Yahoo 라벨 분기.
import { describe, it, expect } from 'vitest';

import { formatStatusMessage, type StatusInputs } from './status.cmd.js';

const BASE: StatusInputs = {
  verdict: '🟢 OK',
  autoTradeMode: 'SHADOW',
  autoTradeEnabled: true,
  emergencyStop: false,
  mhs: 50,
  regime: 'R3_NEUTRAL',
  activeCount: 2,
  maxPositions: 8,
  closedCount: 1,
  pnlSum: 0.5,
  kisTokenHours: 8,
  kisConfigured: true,
  watchlistCount: 30,
  lastScanTs: Date.parse('2026-04-25T01:00:00Z'),
  lastBuyTs: Date.parse('2026-04-25T02:00:00Z'),
  dailyLossPct: 1.2,
  dailyLossLimit: 5,
  yahooStatus: 'OK',
};

describe('formatStatusMessage — 11항목 표시', () => {
  it('정상 운영: verdict + 모드 + MHS + 포지션 + 결산 + KIS + Yahoo 모두 포함', () => {
    const msg = formatStatusMessage(BASE);
    expect(msg).toContain('🟢 OK');
    expect(msg).toContain('SHADOW');
    expect(msg).toContain('비상정지: 🟢 OFF');
    expect(msg).toContain('MHS: 50 (R3_NEUTRAL)');
    expect(msg).toContain('활성 포지션: 2/8');
    expect(msg).toContain('워치리스트: 30개');
    expect(msg).toContain('오늘 결산: 1건 (P&L +0.50%)');
    expect(msg).toContain('일일손실: 1.2% / 5%');
    expect(msg).toContain('KIS 토큰: ✅ 8h');
    expect(msg).toContain('Yahoo: ✅');
    expect(msg).toContain('마지막 스캔');
    expect(msg).toContain('마지막 신호');
  });

  it('LIVE 모드 → 🔴 LIVE 라벨', () => {
    const msg = formatStatusMessage({ ...BASE, autoTradeMode: 'LIVE' });
    expect(msg).toContain('🔴 LIVE');
    expect(msg).not.toContain('SHADOW');
  });

  it('AUTO_TRADE_ENABLED=false → "(off)" 표시', () => {
    const msg = formatStatusMessage({ ...BASE, autoTradeEnabled: false });
    expect(msg).toMatch(/모드:.*\(off\)/);
  });

  it('비상정지 ON → 🔴 ON', () => {
    const msg = formatStatusMessage({ ...BASE, emergencyStop: true });
    expect(msg).toContain('비상정지: 🔴 ON');
  });

  it('MHS undefined → N/A', () => {
    const msg = formatStatusMessage({ ...BASE, mhs: undefined, regime: undefined });
    expect(msg).toContain('MHS: N/A (N/A)');
  });

  it('손실 P&L 음수 → 부호 그대로 표시', () => {
    const msg = formatStatusMessage({ ...BASE, pnlSum: -2.5 });
    expect(msg).toContain('P&L -2.50%');
  });

  it('KIS 미설정 → "미설정" 표기', () => {
    const msg = formatStatusMessage({ ...BASE, kisConfigured: false, kisTokenHours: 0 });
    expect(msg).toContain('KIS 토큰: 미설정');
  });

  it('KIS 토큰 만료 (LIVE) → ❌ 만료', () => {
    const msg = formatStatusMessage({ ...BASE, kisTokenHours: 0 });
    expect(msg).toContain('KIS 토큰: ❌ 만료');
  });

  it('Yahoo DEGRADED → ⚠️', () => {
    const msg = formatStatusMessage({ ...BASE, yahooStatus: 'DEGRADED' });
    expect(msg).toMatch(/Yahoo:.*⚠️/);
  });

  it('Yahoo DOWN → ❌', () => {
    const msg = formatStatusMessage({ ...BASE, yahooStatus: 'DOWN' });
    expect(msg).toMatch(/Yahoo:.*❌/);
  });

  it('Yahoo STALE → 🟡', () => {
    const msg = formatStatusMessage({ ...BASE, yahooStatus: 'STALE' });
    expect(msg).toMatch(/Yahoo:.*🟡/);
  });

  it('Yahoo UNKNOWN → ?', () => {
    const msg = formatStatusMessage({ ...BASE, yahooStatus: 'UNKNOWN' });
    expect(msg).toMatch(/Yahoo:.*\?/);
  });

  it('lastScanTs=0 / lastBuyTs=0 → "미실행" / "없음"', () => {
    const msg = formatStatusMessage({ ...BASE, lastScanTs: 0, lastBuyTs: 0 });
    expect(msg).toContain('마지막 스캔: 미실행');
    expect(msg).toContain('마지막 신호: 없음');
  });
});
