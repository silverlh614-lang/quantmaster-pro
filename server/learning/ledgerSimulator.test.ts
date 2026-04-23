import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import { LEDGER_FILE } from '../persistence/paths.js';
import {
  recordUniverseEntries, resolveLedger, getUniverseStats, loadLedgerEntries,
  UNIVERSE_SETTINGS,
} from './ledgerSimulator.js';

// 원본 복원 — 테스트 병렬 실행 시 다른 suite 가 이 파일을 읽어도 영향을 주지 않도록.
const _backup = fs.existsSync(LEDGER_FILE) ? fs.readFileSync(LEDGER_FILE, 'utf-8') : null;

function resetLedger() {
  if (fs.existsSync(LEDGER_FILE)) fs.unlinkSync(LEDGER_FILE);
}

afterAll(() => {
  if (_backup !== null) fs.writeFileSync(LEDGER_FILE, _backup);
  else if (fs.existsSync(LEDGER_FILE)) fs.unlinkSync(LEDGER_FILE);
});

describe('ledgerSimulator', () => {
  beforeEach(resetLedger);

  it('recordUniverseEntries 3 universe 생성', () => {
    const created = recordUniverseEntries({
      stockCode: '005930', stockName: '삼성전자', entryPrice: 10_000,
      regime: 'R2_BULL',
    });
    expect(created).toHaveLength(3);
    expect(created.map(e => e.universe).sort()).toEqual(['A', 'B', 'C']);
    // targetPrice / stopPrice 정합성
    const a = created.find(e => e.universe === 'A')!;
    expect(a.targetPrice).toBeCloseTo(10_000 * 1.12, 0);
    expect(a.stopPrice).toBeCloseTo(10_000 * 0.95, 0);
  });

  it('같은 날 동일 종목 중복 기록은 스킵 (멱등)', () => {
    recordUniverseEntries({ stockCode: '005930', stockName: '삼성전자', entryPrice: 10_000 });
    const dup = recordUniverseEntries({ stockCode: '005930', stockName: '삼성전자', entryPrice: 10_500 });
    expect(dup).toEqual([]);
    expect(loadLedgerEntries()).toHaveLength(3);
  });

  it('resolveLedger: TP 도달 시 HIT_TP, 정확한 returnPct', async () => {
    recordUniverseEntries({ stockCode: '005930', stockName: '삼성전자', entryPrice: 10_000 });
    // A universe targetPrice = 11200
    const res = await resolveLedger(async () => 11_300);
    expect(res.hitTP).toBeGreaterThanOrEqual(1);
    const entries = loadLedgerEntries().filter(e => e.universe === 'A');
    expect(entries[0].status).toBe('HIT_TP');
    expect(entries[0].returnPct).toBeCloseTo(13, 0);
  });

  it('resolveLedger: SL 도달 시 HIT_SL', async () => {
    recordUniverseEntries({ stockCode: '005930', stockName: '삼성전자', entryPrice: 10_000 });
    // A universe stopPrice = 9500
    const res = await resolveLedger(async () => 9_400);
    expect(res.hitSL).toBeGreaterThanOrEqual(1);
    const entries = loadLedgerEntries().filter(e => e.universe === 'A');
    expect(entries[0].status).toBe('HIT_SL');
  });

  it('getUniverseStats: 3 universe 각각 Sharpe 계산', async () => {
    // 2 신호 × 3 universe 생성, 전부 TP
    recordUniverseEntries({ stockCode: '005930', stockName: '삼성', entryPrice: 10_000 });
    recordUniverseEntries({ stockCode: '035420', stockName: '네이버', entryPrice: 10_000 });
    await resolveLedger(async () => 12_000);
    const stats = getUniverseStats();
    for (const s of stats) {
      expect(s.closedSamples).toBeGreaterThan(0);
      expect(s.winRate).toBeGreaterThan(0);
      expect(Number.isFinite(s.sharpe)).toBe(true);
    }
  });

  it('UNIVERSE_SETTINGS A Kelly 1.0, B 0.6, C 0.25', () => {
    expect(UNIVERSE_SETTINGS.A.kellyFactor).toBe(1.0);
    expect(UNIVERSE_SETTINGS.B.kellyFactor).toBe(0.6);
    expect(UNIVERSE_SETTINGS.C.kellyFactor).toBe(0.25);
  });
});
