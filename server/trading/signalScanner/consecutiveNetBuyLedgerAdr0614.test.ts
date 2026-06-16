// @responsibility ADR-0614 ledger 회귀 — 연속 카운트·누적·upsert dedup·rolling 캡·semantic 부재 미기록·flag OFF·null marketCapPct·try-catch 격리.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendConsecutiveNetBuyObservation,
  computeConsecutiveNetBuySignal,
  loadConsecutiveNetBuyWindow,
  isConsecutiveNetBuyObservationEnabled,
  CONSECUTIVE_NETBUY_WINDOW_DAYS,
  type ConsecutiveNetBuyLedgerRow,
} from './consecutiveNetBuyLedgerAdr0614.js';

function tmpFile(): string {
  return path.join(os.tmpdir(), `consecutive-netbuy-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

function kisFlow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { foreignNetBuy: 100, institutionalNetBuy: 50, source: 'KIS_API', ...over };
}

function row(over: Partial<ConsecutiveNetBuyLedgerRow> = {}): ConsecutiveNetBuyLedgerRow {
  return {
    dateKey: '2026-06-16',
    stockCode: '005930',
    foreignNetBuy: 100,
    institutionalNetBuy: 50,
    provider: 'KIS_API',
    marketCap: null,
    fetchedAt: new Date().toISOString(),
    semanticStatus: 'OK',
    executionImpact: 'NONE',
    observationOnly: true,
    ...over,
  };
}

describe('consecutiveNetBuyLedgerAdr0614', () => {
  const files: string[] = [];
  afterEach(() => {
    for (const f of files) if (fs.existsSync(f)) fs.rmSync(f, { recursive: true, force: true });
    files.length = 0;
    delete process.env.CONSECUTIVE_NETBUY_OBSERVATION_ENABLED;
  });

  it('semantic OK → append, row 영속 (executionImpact NONE / observationOnly true)', () => {
    const file = tmpFile(); files.push(file);
    const r = appendConsecutiveNetBuyObservation({
      stockCode: '005930', kisFlow: kisFlow(), tradingDate: '2026-06-16', provider: 'KIS_API', filePath: file,
    });
    expect(r).toMatchObject({
      dateKey: '2026-06-16', stockCode: '005930', foreignNetBuy: 100, institutionalNetBuy: 50,
      provider: 'KIS_API', marketCap: null, semanticStatus: 'OK', executionImpact: 'NONE', observationOnly: true,
    });
    expect(loadConsecutiveNetBuyWindow('005930', file)).toHaveLength(1);
  });

  it('semantic 부재/DEGRADED/FIELD_MISSING → 미기록 (불변식 #6 결손≠신호)', () => {
    const file = tmpFile(); files.push(file);
    // null kisFlow → DATA_UNAVAILABLE
    expect(appendConsecutiveNetBuyObservation({ stockCode: '005930', kisFlow: null, tradingDate: '2026-06-16', filePath: file })).toBeNull();
    // 일부만 부재 → DEGRADED
    expect(appendConsecutiveNetBuyObservation({ stockCode: '005930', kisFlow: { foreignNetBuy: 100, source: 'KIS_API' }, tradingDate: '2026-06-16', filePath: file })).toBeNull();
    // 전부 부재 → FIELD_MISSING
    expect(appendConsecutiveNetBuyObservation({ stockCode: '005930', kisFlow: { source: 'KIS_API' }, tradingDate: '2026-06-16', filePath: file })).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('연속 산출: 3일 연속 foreign>0 → consecutiveForeignDays=3, 중간 음수 끊김', () => {
    const win = [
      row({ dateKey: '2026-06-10', foreignNetBuy: -5, institutionalNetBuy: 10 }),
      row({ dateKey: '2026-06-11', foreignNetBuy: 20, institutionalNetBuy: 10 }),
      row({ dateKey: '2026-06-12', foreignNetBuy: 30, institutionalNetBuy: 10 }),
      row({ dateKey: '2026-06-13', foreignNetBuy: 40, institutionalNetBuy: 10 }),
    ];
    const sig = computeConsecutiveNetBuySignal('005930', win);
    expect(sig.consecutiveForeignDays).toBe(3);          // 최신 3일 연속 양수
    expect(sig.consecutiveInstitutionDays).toBe(4);      // 4일 전부 양수
    expect(sig.consecutiveBothDays).toBe(3);             // both 동반은 foreign 에 의해 3
    expect(sig.bothConsecutive).toBe(true);
    expect(sig.asOfDateKey).toBe('2026-06-13');
  });

  it('연속 끊김: 최신일 0 → consecutive=0 (===0 중단)', () => {
    const win = [
      row({ dateKey: '2026-06-12', foreignNetBuy: 30, institutionalNetBuy: 10 }),
      row({ dateKey: '2026-06-13', foreignNetBuy: 0, institutionalNetBuy: -1 }),
    ];
    const sig = computeConsecutiveNetBuySignal('005930', win);
    expect(sig.consecutiveForeignDays).toBe(0);
    expect(sig.consecutiveInstitutionDays).toBe(0);
    expect(sig.bothConsecutive).toBe(false);
  });

  it('cumulative 합 정확성', () => {
    const win = [
      row({ dateKey: '2026-06-12', foreignNetBuy: 30, institutionalNetBuy: 10 }),
      row({ dateKey: '2026-06-13', foreignNetBuy: 40, institutionalNetBuy: 20 }),
    ];
    const sig = computeConsecutiveNetBuySignal('005930', win);
    expect(sig.cumulativeForeignNetBuy).toBe(70);
    expect(sig.cumulativeInstitutionalNetBuy).toBe(30);
    expect(sig.cumulativeNetBuy).toBe(100);
  });

  it('netBuyVsMarketCapPct: 항상 null (가짜 비율 금지) — marketCap 주어져도 null', () => {
    const win = [row({ dateKey: '2026-06-13', marketCap: 1_000_000 })];
    const sig = computeConsecutiveNetBuySignal('005930', win);
    expect(sig.netBuyVsMarketCapPct).toBeNull();
  });

  it('dedup: 동일 dateKey×stockCode 재append → last-write-wins (row 1개, 최신값)', () => {
    const file = tmpFile(); files.push(file);
    appendConsecutiveNetBuyObservation({ stockCode: '005930', kisFlow: kisFlow({ foreignNetBuy: 100 }), tradingDate: '2026-06-16', filePath: file });
    appendConsecutiveNetBuyObservation({ stockCode: '005930', kisFlow: kisFlow({ foreignNetBuy: 999 }), tradingDate: '2026-06-16', filePath: file });
    const rows = loadConsecutiveNetBuyWindow('005930', file);
    expect(rows).toHaveLength(1);
    expect(rows[0].foreignNetBuy).toBe(999);
  });

  it('rolling window cap: WINDOW_DAYS 초과 시 가장 오래된 dateKey FIFO 제거', () => {
    const file = tmpFile(); files.push(file);
    const total = CONSECUTIVE_NETBUY_WINDOW_DAYS + 5;
    for (let i = 0; i < total; i += 1) {
      const day = String(i + 1).padStart(2, '0');
      appendConsecutiveNetBuyObservation({ stockCode: '005930', kisFlow: kisFlow(), tradingDate: `2026-06-${day}`, filePath: file });
    }
    const rows = loadConsecutiveNetBuyWindow('005930', file);
    expect(rows).toHaveLength(CONSECUTIVE_NETBUY_WINDOW_DAYS);
    // 가장 오래된 5일 제거 — 남은 첫 dateKey 는 06-06.
    expect(rows[0].dateKey).toBe('2026-06-06');
    expect(rows[rows.length - 1].dateKey).toBe(`2026-06-${String(total).padStart(2, '0')}`);
  });

  it('flag SSOT: default OFF, === "true" 만 ON (ADR-0157 정확비교)', () => {
    expect(isConsecutiveNetBuyObservationEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isConsecutiveNetBuyObservationEnabled({ CONSECUTIVE_NETBUY_OBSERVATION_ENABLED: 'TRUE' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isConsecutiveNetBuyObservationEnabled({ CONSECUTIVE_NETBUY_OBSERVATION_ENABLED: '1' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isConsecutiveNetBuyObservationEnabled({ CONSECUTIVE_NETBUY_OBSERVATION_ENABLED: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('손상 JSON → 빈 객체 fallback (append 무중단, 시스템 보호)', () => {
    const file = tmpFile(); files.push(file);
    fs.writeFileSync(file, '{ this is not valid json');
    const r = appendConsecutiveNetBuyObservation({ stockCode: '005930', kisFlow: kisFlow(), tradingDate: '2026-06-16', filePath: file });
    expect(r).not.toBeNull();
    expect(loadConsecutiveNetBuyWindow('005930', file)).toHaveLength(1);
  });

  it('append throw 격리 패턴: 잘못된 filePath(디렉토리) 라도 throw 없이 진행 (불변식 #1 호출자 격리 보강)', () => {
    // saveAll 은 write 실패를 삼키므로 append 가 throw 하지 않음을 확인.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnb-dir-'));
    files.push(dir);
    expect(() => appendConsecutiveNetBuyObservation({
      stockCode: '005930', kisFlow: kisFlow(), tradingDate: '2026-06-16', filePath: dir,
    })).not.toThrow();
  });
});
