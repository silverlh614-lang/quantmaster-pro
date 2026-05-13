/**
 * @responsibility ADR-0505 detail trace repo 회귀 — FIFO 200 + 7일 TTL +
 * atomic write tmp→rename + 손상 JSON fallback + sanitized metadata only.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  GATE1_FORENSIC_FIFO_LIMIT,
  GATE1_FORENSIC_TTL_DAYS,
  appendGate1ForensicTrace,
  loadGate1ForensicTrace,
  __resetGate1ForensicTraceForTests,
  isGate1ForensicTracePersistDisabled,
} from './gate1MinimumSignalForensicTraceRepo.js';
import type { Gate1MinimumSignalForensicAuditAdr0505 } from '../trading/signalScanner/gate1MinimumSignalForensicAuditAdr0505.js';

function makeAudit(symbol: string): Gate1MinimumSignalForensicAuditAdr0505 {
  return {
    symbol,
    name: `T-${symbol}`,
    scoreSystem: 'MINIMUM_SIGNAL_SCORE_100_SCALE',
    requiredScore: 70,
    actualScore: 22,
    scoreGap: -48,
    passed: false,
    positiveComponents: {},
    penaltyComponents: {},
    missingPositiveSources: [],
    dominantFailureReason: 'UNKNOWN',
    supplyScopeAudit: {
      expectedScope: 'SYMBOL_LEVEL_INVESTOR_FLOW',
      quoteSymbol: null,
      kisFlowSymbol: null,
      symbolMatched: null,
      foreignNetBuy: null,
      institutionalNetBuy: null,
      semanticAvailable: false,
      warning: 'NONE',
    },
    sectorEnergyAudit: {
      registeredInEvaluateServerGateRegistry: false,
      layer: 'SECTOR_BOOST_PROMOTION_MINIMUM_SCORE_LAYER',
      directRawGateScoreImpact: 0,
    },
    wouldPassIf: {
      unknownNeutral: false,
      providerPenaltyRemoved: false,
      sectorPenaltyRemoved: false,
      softFailPenaltyRemoved: false,
      watchlistImportedPlus5: false,
      relativeStrengthRestoredPlus7: false,
      breakoutStructureRestoredPlus5: false,
      allPositiveSourcesRestored: false,
    },
    executionImpact: 'NONE',
    liveExecutionAllowed: false,
    policyPromotionMode: 'SHADOW_ONLY',
  };
}

describe('ADR-0505 detail trace repo — sanitized FIFO + TTL', () => {
  const origDataDir = process.env.PERSIST_DATA_DIR;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr0505-'));
    process.env.PERSIST_DATA_DIR = tmpDir;
    // 모듈 캐시 isolate — paths.ts 가 DATA_DIR 캐시
    __resetGate1ForensicTraceForTests();
  });

  afterEach(() => {
    if (origDataDir === undefined) delete process.env.PERSIST_DATA_DIR;
    else process.env.PERSIST_DATA_DIR = origDataDir;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('빈 파일 → loadGate1ForensicTrace returns []', () => {
    const result = loadGate1ForensicTrace();
    expect(result).toEqual([]);
  });

  it('append + load round-trip — 신규 entry 영속 + 재로드', () => {
    const count = appendGate1ForensicTrace('scan-1', new Date().toISOString(), [makeAudit('005930')]);
    expect(count).toBe(1);
    const loaded = loadGate1ForensicTrace();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].audit.symbol).toBe('005930');
  });

  it('FIFO 200 trim — limit 초과 시 가장 오래된 entry 제거', () => {
    const now = new Date().toISOString();
    const audits: Gate1MinimumSignalForensicAuditAdr0505[] = [];
    for (let i = 0; i < GATE1_FORENSIC_FIFO_LIMIT + 10; i++) {
      audits.push(makeAudit(`S${String(i).padStart(6, '0')}`));
    }
    appendGate1ForensicTrace('scan-many', now, audits);
    const loaded = loadGate1ForensicTrace();
    expect(loaded).toHaveLength(GATE1_FORENSIC_FIFO_LIMIT);
    // 가장 오래된 (S000000 ~ S000009) 제거됨, 최신 200건만 보존
    expect(loaded[0].audit.symbol).toBe('S000010');
  });

  it('7일 TTL — 오래된 entry 자동 제거', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    // 먼저 오래된 entry 영속
    appendGate1ForensicTrace('scan-old', eightDaysAgo, [makeAudit('OLD0001')]);
    // 두 번째 append — TTL filter 가 작동하여 OLD entry 제거됨
    appendGate1ForensicTrace('scan-new', new Date().toISOString(), [makeAudit('NEW0001')]);
    const loaded = loadGate1ForensicTrace();
    expect(loaded.find((e) => e.audit.symbol === 'OLD0001')).toBeUndefined();
    expect(loaded.find((e) => e.audit.symbol === 'NEW0001')).toBeDefined();
  });

  it('손상 JSON → 빈 배열 fallback (engine throws 차단)', () => {
    const filePath = path.join(tmpDir, 'diagnostics', 'gate1-minimum-signal-forensic-adr0505.json');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{not valid json[[[', 'utf-8');
    const result = loadGate1ForensicTrace();
    expect(result).toEqual([]);
  });

  it('atomic write — tmp 파일 정상 cleanup', () => {
    appendGate1ForensicTrace('scan-1', new Date().toISOString(), [makeAudit('005930')]);
    const tmpPath = path.join(
      tmpDir,
      'diagnostics',
      'gate1-minimum-signal-forensic-adr0505.json.tmp',
    );
    expect(fs.existsSync(tmpPath)).toBe(false);
  });

  it('빈 audits → 영속 0건 + 0 반환 (잡음 차단)', () => {
    const count = appendGate1ForensicTrace('scan-empty', new Date().toISOString(), []);
    expect(count).toBe(0);
    const loaded = loadGate1ForensicTrace();
    expect(loaded).toEqual([]);
  });

  describe('ENV gate — GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_PERSIST_DISABLED', () => {
    const origPersist = process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_PERSIST_DISABLED;
    afterEach(() => {
      if (origPersist === undefined)
        delete process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_PERSIST_DISABLED;
      else process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_PERSIST_DISABLED = origPersist;
    });

    it("=== 'true' 활성 시 영속 skip", () => {
      process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_PERSIST_DISABLED = 'true';
      const count = appendGate1ForensicTrace('scan-disabled', new Date().toISOString(), [makeAudit('S')]);
      expect(count).toBe(0);
      expect(isGate1ForensicTracePersistDisabled()).toBe(true);
    });

    it('default OFF — 영속 정상', () => {
      delete process.env.GATE1_MINIMUM_SIGNAL_FORENSIC_TRACE_PERSIST_DISABLED;
      expect(isGate1ForensicTracePersistDisabled()).toBe(false);
    });
  });

  it('TTL 상수 정합 (사용자 명시 절대 변경 금지)', () => {
    expect(GATE1_FORENSIC_FIFO_LIMIT).toBe(200);
    expect(GATE1_FORENSIC_TTL_DAYS).toBe(7);
  });
});
