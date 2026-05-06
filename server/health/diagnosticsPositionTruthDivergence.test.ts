/**
 * @responsibility diagnostics Position Truth Divergence 회귀 테스트 (ADR-0191)
 *
 * Wiring 3 — 사용자 5/6 12회 가짜 매수 사고 후속. /health 메시지에 영속 SSOT
 * drift (12 vs 1) 자동 검출 라인 추가. 정상은 침묵, divergent=true 는 ❌ 노출.
 */

import { describe, expect, it } from 'vitest';
import type { HealthSnapshot } from './diagnostics.js';
import { formatPositionTruthDivergenceLine } from '../telegram/commands/system/health.cmd.js';

function buildSnapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    uptimeHours: '1.0', memMB: 100, commitSha: 'abc1234',
    watchlistCount: 0, activePositions: 0,
    autoTradeEnabled: false, autoTradeMode: 'SHADOW',
    emergencyStop: false, dailyLossPct: 0, dailyLossLimit: 5, dailyLossLimitReached: false,
    kisConfigured: false, kisTokenHours: 0, kisTokenValid: true, realDataTokenHours: 0,
    krxTokenConfigured: false, krxTokenValid: false, krxCircuitState: 'CLOSED', krxFailures: 0,
    yahoo: { status: 'OK', detail: 'HEARTBEAT_OK', heartbeat: { lastSuccessAt: 0, consecutiveFailures: 0 } as HealthSnapshot['yahoo']['heartbeat'] },
    geminiRuntime: { status: 'IDLE', label: null, caller: null, reason: null, updatedAt: null } as HealthSnapshot['geminiRuntime'],
    volume: { ok: true },
    stream: { connected: false, subscribedCount: 0 } as HealthSnapshot['stream'],
    telegramConfigured: true, telegramBotTokenOnly: false, telegramChatIdOnly: false,
    lastScanTs: 0, lastBuyTs: 0, lastScanSummary: null,
    intradayYield: null as unknown as HealthSnapshot['intradayYield'],
    verdict: '🟢 OK',
    ...overrides,
  };
}

describe('ADR-0191 §Wiring 3 — formatPositionTruthDivergenceLine SSOT', () => {
  it('positionTruthDivergence 부재 → 빈 문자열 (라인 미노출)', () => {
    const snapshot = buildSnapshot({ positionTruthDivergence: undefined });
    expect(formatPositionTruthDivergenceLine(snapshot)).toBe('');
  });

  it('divergent=false → 빈 문자열 (정상은 침묵)', () => {
    const snapshot = buildSnapshot({
      positionTruthDivergence: {
        shadowOpenCount: 2, aggregateActiveCount: 2,
        divergent: false, divergentStockCodes: [],
      },
    });
    expect(formatPositionTruthDivergenceLine(snapshot)).toBe('');
  });

  it('divergent=true (사용자 12 vs 1 시나리오) → ❌ 라인 + 카운트 표시', () => {
    const snapshot = buildSnapshot({
      positionTruthDivergence: {
        shadowOpenCount: 12, aggregateActiveCount: 1,
        divergent: true, divergentStockCodes: [],
      },
    });
    const line = formatPositionTruthDivergenceLine(snapshot);
    expect(line).toContain('❌');
    expect(line).toContain('Position Truth Divergence');
    expect(line).toContain('shadow=12');
    expect(line).toContain('aggregate=1');
    expect(line).toContain('codes: N/A');
  });

  it('divergent=true + 종목 갈라짐 (≤5) → codes 라벨 전체 표시', () => {
    const snapshot = buildSnapshot({
      positionTruthDivergence: {
        shadowOpenCount: 3, aggregateActiveCount: 2,
        divergent: true, divergentStockCodes: ['005930', '058470'],
      },
    });
    const line = formatPositionTruthDivergenceLine(snapshot);
    expect(line).toContain('codes: 005930,058470');
  });

  it('divergent=true + 종목 갈라짐 (5개 이하 정확히) → 전체 표시', () => {
    const snapshot = buildSnapshot({
      positionTruthDivergence: {
        shadowOpenCount: 5, aggregateActiveCount: 0,
        divergent: true,
        divergentStockCodes: ['005930', '058470', '000660', '035420', '000270'],
      },
    });
    const line = formatPositionTruthDivergenceLine(snapshot);
    expect(line).toContain('005930,058470,000660,035420,000270');
    expect(line).not.toContain('외');
  });

  it('divergent=true + 종목 6개 이상 → 첫 5개 + "외 N개" (메시지 폭주 차단)', () => {
    const snapshot = buildSnapshot({
      positionTruthDivergence: {
        shadowOpenCount: 8, aggregateActiveCount: 0,
        divergent: true,
        divergentStockCodes: ['001', '002', '003', '004', '005', '006', '007', '008'],
      },
    });
    const line = formatPositionTruthDivergenceLine(snapshot);
    expect(line).toContain('001,002,003,004,005');
    expect(line).toContain('외 3개');
  });

  it('detectError 보존 (positionAggregator throw 시) — divergent=true 자체는 정상 노출', () => {
    const snapshot = buildSnapshot({
      positionTruthDivergence: {
        shadowOpenCount: 1, aggregateActiveCount: 0,
        divergent: true, divergentStockCodes: ['058470'],
        detectError: 'shadow-log corrupted',
      },
    });
    const line = formatPositionTruthDivergenceLine(snapshot);
    expect(line).toContain('Position Truth Divergence');
    expect(line).toContain('codes: 058470');
  });
});

describe('ADR-0191 §Wiring 3 — collectHealthSnapshot 통합', () => {
  it('safeDetectPositionTruthDivergence wrapper 존재 (try/catch 격리)', () => {
    const fs = require('fs');
    const path = require('path');
    const diagSrc = fs.readFileSync(
      path.resolve(__dirname, 'diagnostics.ts'), 'utf-8',
    );
    expect(diagSrc).toMatch(/safeDetectPositionTruthDivergence/);
    expect(diagSrc).toMatch(/try \{[\s\S]+?detectPositionTruthDivergence\(\)[\s\S]+?\} catch/);
  });

  it('positionTruthDivergence 옵셔널 필드 (HealthSnapshot interface)', () => {
    const fs = require('fs');
    const path = require('path');
    const diagSrc = fs.readFileSync(
      path.resolve(__dirname, 'diagnostics.ts'), 'utf-8',
    );
    expect(diagSrc).toMatch(/positionTruthDivergence\?: PositionTruthDivergenceReport/);
  });

  it('ADR-0191 추적 주석 (diagnostics.ts)', () => {
    const fs = require('fs');
    const path = require('path');
    const diagSrc = fs.readFileSync(
      path.resolve(__dirname, 'diagnostics.ts'), 'utf-8',
    );
    expect(diagSrc).toMatch(/ADR-0191/);
  });

  it('formatHealthMessage 분기 라인 — 빈 문자열 시 라인 자체 미노출 (조건부 렌더)', () => {
    const fs = require('fs');
    const path = require('path');
    const healthCmdSrc = fs.readFileSync(
      path.resolve(__dirname, '..', 'telegram', 'commands', 'system', 'health.cmd.ts'), 'utf-8',
    );
    expect(healthCmdSrc).toMatch(/ptdLine \? `\$\{ptdLine\}\\n` : ''/);
  });
});
