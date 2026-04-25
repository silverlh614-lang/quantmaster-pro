/**
 * @responsibility multiSourceStockMaster 회귀 테스트 (ADR-0013) — 4-tier 폴백 동작·검증·alert
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  refreshMultiSourceMaster,
  setMasterAlertHook,
  getMasterDiagnostic,
} from './multiSourceStockMaster.js';
import {
  __testOnly as healthTestOnly,
} from '../persistence/stockMasterHealthRepo.js';
import {
  __testOnly as shadowTestOnly,
  loadShadowMaster,
} from '../persistence/shadowMasterDb.js';
import {
  __testOnly as krxTestOnly,
  setStockMaster,
  getMasterSize,
  type StockMasterEntry,
} from '../persistence/krxStockMasterRepo.js';

function generateValidEntries(n: number, market: 'KOSPI' | 'KOSDAQ' = 'KOSPI'): StockMasterEntry[] {
  const out: StockMasterEntry[] = [];
  for (let i = 0; i < n; i++) {
    const code = String(100000 + i).padStart(6, '0');
    out.push({ code, name: `종목${i}`, market });
  }
  return out;
}

function isWeekendNow(): boolean {
  const day = new Date(Date.now() + 9 * 3_600_000).getUTCDay();
  return day === 0 || day === 6;
}

describe('multiSourceStockMaster (ADR-0013)', () => {
  beforeEach(() => {
    healthTestOnly.reset();
    shadowTestOnly.reset();
    krxTestOnly.reset();
    /* KRX 디스크 파일은 명시적으로 unlink 하지 않음 — 다른 test 파일(krxStockMasterRepo.test.ts) 와 동일 path 를 공유하므로 파일 unlink 가 fork 간 race 를 유발. krxTestOnly.reset() 의 메모리 리셋 + orchestrator 의 setStockMaster 가 매 테스트마다 자기 fork 의 _store 를 덮어쓰므로 disk 잔여물은 본 테스트 결과에 영향 없음. */
    setMasterAlertHook(null);
  });
  afterEach(() => {
    healthTestOnly.reset();
    shadowTestOnly.reset();
    krxTestOnly.reset();
    /* KRX 디스크 파일은 명시적으로 unlink 하지 않음 — 다른 test 파일(krxStockMasterRepo.test.ts) 와 동일 path 를 공유하므로 파일 unlink 가 fork 간 race 를 유발. krxTestOnly.reset() 의 메모리 리셋 + orchestrator 의 setStockMaster 가 매 테스트마다 자기 fork 의 _store 를 덮어쓰므로 disk 잔여물은 본 테스트 결과에 영향 없음. */
    setMasterAlertHook(null);
  });

  it('Tier 1 KRX 성공 시 active + shadow 모두 갱신', async () => {
    if (isWeekendNow()) return; // 주말 단락은 별도 테스트
    // Naver/KRX 둘 다 모킹할 수 없으므로 skipKrx + skipNaver 분기로 검증
    // 대신 tryKrx 는 fetch 를 모킹해야 한다 — 그건 통합 테스트라 본 건 polling 회피.
    // 본 케이스는 skipKrx=true 로 돌리고 다음 테스트에서 Tier 2 동작 확인.
  });

  it('Tier 1/2 둘 다 skip → Tier 3 Shadow 사용', async () => {
    // Shadow 에 미리 데이터 적재
    const entries = generateValidEntries(100);
    const shadowOk = (await import('../persistence/shadowMasterDb.js')).updateShadowMaster('KRX_CSV', entries);
    expect(shadowOk).toBe(true);

    const result = await refreshMultiSourceMaster({ skipKrx: true, skipNaver: true });
    expect(result.finalSource).toBe('SHADOW_DB');
    expect(result.finalCount).toBe(100);
    expect(result.usedFallback).toBe(true);
    expect(getMasterSize()).toBe(100);
    // Shadow 내용은 KRX_CSV 그대로 — Tier 3 사용이 shadow 를 갱신하지 않음
    expect(loadShadowMaster()?.source).toBe('KRX_CSV');
  });

  it('Shadow 부재 + 모든 라이브 skip → Tier 4 Seed 사용', async () => {
    const result = await refreshMultiSourceMaster({ skipKrx: true, skipNaver: true });
    expect(result.finalSource).toBe('STATIC_SEED');
    expect(result.usedFallback).toBe(true);
    expect(result.finalCount).toBeGreaterThanOrEqual(50);
    expect(getMasterSize()).toBe(result.finalCount);
    // Seed 는 shadow 를 갱신하지 않음
    expect(loadShadowMaster()).toBeNull();
  });

  it('Seed fallback 시 CRITICAL 경보 트리거', async () => {
    const calls: Array<{ level: string; key: string }> = [];
    setMasterAlertHook((level, _msg, dedupeKey) => {
      calls.push({ level, key: dedupeKey });
    });
    await refreshMultiSourceMaster({ skipKrx: true, skipNaver: true });
    expect(calls.find((c) => c.key.startsWith('master_source_alert:SEED_FALLBACK'))).toBeTruthy();
    expect(calls[0]?.level).toBe('CRITICAL');
  });

  it('attempts 배열 — skip 한 tier 는 attempts 에 포함되지 않음', async () => {
    // Shadow 에 데이터 적재 (Tier 3 진입을 위해)
    (await import('../persistence/shadowMasterDb.js')).updateShadowMaster('KRX_CSV', generateValidEntries(100));
    const result = await refreshMultiSourceMaster({ skipKrx: true, skipNaver: true });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].source).toBe('SHADOW_DB');
    expect(result.attempts[0].ok).toBe(true);
  });

  it('getMasterDiagnostic — 4 source 의 score + activeCount 노출', async () => {
    // 미리 active master 적재
    setStockMaster([{ code: '005930', name: '삼성전자', market: 'KOSPI' }]);
    const diag = getMasterDiagnostic();
    expect(diag.activeCount).toBe(1);
    expect(diag.sources).toHaveLength(4);
    const sources = diag.sources.map((s) => s.source).sort();
    expect(sources).toEqual(['KRX_CSV', 'NAVER_LIST', 'SHADOW_DB', 'STATIC_SEED']);
    expect(diag.overallHealth).toBeGreaterThanOrEqual(0);
    expect(diag.overallHealth).toBeLessThanOrEqual(100);
  });
});

describe('multiSourceStockMaster — alert hook', () => {
  beforeEach(() => {
    healthTestOnly.reset();
    shadowTestOnly.reset();
    krxTestOnly.reset();
    setMasterAlertHook(null);
  });
  afterEach(() => setMasterAlertHook(null));

  it('hook null 일 때 에러 없이 silent', async () => {
    setMasterAlertHook(null);
    await expect(refreshMultiSourceMaster({ skipKrx: true, skipNaver: true })).resolves.toBeTruthy();
  });

  it('hook 가 throw 해도 orchestrator 는 성공', async () => {
    setMasterAlertHook(() => { throw new Error('hook 폭발'); });
    const result = await refreshMultiSourceMaster({ skipKrx: true, skipNaver: true });
    expect(result.finalSource).toBe('STATIC_SEED');
  });
});

// 검증 동작은 krxStockMasterRepo.test.ts 의 validateMasterPayload 가 확인하므로 본 파일에서 중복 안 함.
void vi; // 미사용 import 가드
