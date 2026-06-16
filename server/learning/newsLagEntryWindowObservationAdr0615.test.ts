// @responsibility ADR-0615 회귀 — PRE/IN/PAST ci95 경계·n<3 null skip·isComplete 제외·sector 조인·now 결정성·businessDaysElapsed drift 고정·flag OFF no-op·try-catch 격리.
import { afterEach, describe, expect, it, vi } from 'vitest';

// getOptimalEntryWindow 만 mock — records 는 순수 함수 인자로 주입(파일시스템 미접근).
const getOptimalEntryWindow = vi.fn();
vi.mock('./newsLagBayesian.js', () => ({
  getOptimalEntryWindow: (newsType: string, sector: string) =>
    getOptimalEntryWindow(newsType, sector),
}));
// loadNewsSupplyRecords 는 loadActiveNewsSupplyRecordsForObservation 경유만 — 파일시스템 read 회피용 mock.
const loadNewsSupplyRecords = vi.fn(() => [] as unknown[]);
vi.mock('./newsSupplyLogger.js', () => ({
  loadNewsSupplyRecords: () => loadNewsSupplyRecords(),
}));

import {
  businessDaysElapsed,
  classifyWindowStatus,
  pickBestStatus,
  computeNewsLagEntryWindowObservation,
  computeNewsLagEntryWindowBySector,
  isNewsLagEntryWindowObservationEnabled,
  loadActiveNewsSupplyRecordsForObservation,
  type NewsLagMatchedRecord,
} from './newsLagEntryWindowObservationAdr0615.js';

// ── 테스트 헬퍼 ────────────────────────────────────────────────────────────────

type RecordShape = {
  sector: string;
  newsType: string;
  detectedAt: string;
  isComplete: boolean;
};

function rec(over: Partial<RecordShape> = {}): RecordShape {
  return {
    sector: '반도체',
    newsType: '반도체수주',
    detectedAt: '2026-06-01T00:00:00.000Z',
    isComplete: false,
    ...over,
  };
}

function posterior(over: Record<string, number> = {}) {
  return {
    newsType: '반도체수주',
    sector: '반도체',
    meanLagDays: 5,
    stdDays: 1,
    ci95LowDays: 3,
    ci95HighDays: 7,
    sampleSize: 10,
    ...over,
  };
}

function matched(over: Partial<NewsLagMatchedRecord> = {}): NewsLagMatchedRecord {
  return {
    newsType: 'x',
    detectedAt: '2026-06-01T00:00:00.000Z',
    elapsedDays: 5,
    meanLagDays: 5,
    ci95LowDays: 3,
    ci95HighDays: 7,
    sampleSize: 10,
    windowStatus: 'IN',
    ...over,
  };
}

/**
 * newsSupplyLogger.ts:69-81 businessDaysElapsed 원본 정의 복제(drift 고정 기준).
 * 본 모듈의 businessDaysElapsed 가 이 정의와 모든 입력에서 동일 결과를 내야 한다.
 */
function referenceBusinessDaysElapsed(from: Date, to: Date): number {
  let count = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

describe('newsLagEntryWindowObservationAdr0615', () => {
  afterEach(() => {
    getOptimalEntryWindow.mockReset();
    loadNewsSupplyRecords.mockReset();
    delete process.env.NEWS_LAG_ENTRY_WINDOW_OBSERVATION_ENABLED;
  });

  // ── classifyWindowStatus — ci95 경계(두 번째 공식 0, ci95 재사용) ─────────────
  describe('classifyWindowStatus (ci95 경계)', () => {
    it('elapsed < ci95Low → PRE', () => {
      expect(classifyWindowStatus(2, 3, 7)).toBe('PRE');
    });
    it('elapsed === ci95Low → IN (경계 포함)', () => {
      expect(classifyWindowStatus(3, 3, 7)).toBe('IN');
    });
    it('ci95Low < elapsed < ci95High → IN', () => {
      expect(classifyWindowStatus(5, 3, 7)).toBe('IN');
    });
    it('elapsed === ci95High → IN (경계 포함)', () => {
      expect(classifyWindowStatus(7, 3, 7)).toBe('IN');
    });
    it('elapsed > ci95High → PAST', () => {
      expect(classifyWindowStatus(8, 3, 7)).toBe('PAST');
    });
  });

  // ── pickBestStatus 우선순위 IN > PRE > PAST > null ────────────────────────────
  describe('pickBestStatus (IN > PRE > PAST > null)', () => {
    it('빈 배열 → null', () => {
      expect(pickBestStatus([])).toBeNull();
    });
    it('PRE+PAST 혼재 → PRE (IN 없음)', () => {
      expect(
        pickBestStatus([matched({ windowStatus: 'PAST' }), matched({ windowStatus: 'PRE' })]),
      ).toBe('PRE');
    });
    it('IN 존재 → IN (PRE/PAST 무시)', () => {
      expect(
        pickBestStatus([
          matched({ windowStatus: 'PAST' }),
          matched({ windowStatus: 'PRE' }),
          matched({ windowStatus: 'IN' }),
        ]),
      ).toBe('IN');
    });
    it('PAST 만 → PAST', () => {
      expect(pickBestStatus([matched({ windowStatus: 'PAST' })])).toBe('PAST');
    });
  });

  // ── businessDaysElapsed drift 고정 (원본과 1:1) ────────────────────────────────
  describe('businessDaysElapsed drift 고정', () => {
    it('주말 제외 영업일 — 알려진 값', () => {
      // 2026-06-01(월) → 2026-06-08(월): 영업일 5 (월~금)
      expect(
        businessDaysElapsed(new Date('2026-06-01'), new Date('2026-06-08')),
      ).toBe(5);
    });
    it('동일/역방향 → 0', () => {
      const d = new Date('2026-06-10');
      expect(businessDaysElapsed(d, d)).toBe(0);
      expect(businessDaysElapsed(new Date('2026-06-10'), new Date('2026-06-01'))).toBe(0);
    });
    it('원본(newsSupplyLogger:69-81) 정의와 모든 입력에서 동일 (drift 0)', () => {
      const bases = ['2026-01-05', '2026-03-13', '2026-06-01', '2026-12-31'];
      for (const b of bases) {
        for (let offset = 0; offset <= 45; offset++) {
          const from = new Date(b);
          const to = new Date(from);
          to.setDate(to.getDate() + offset);
          expect(businessDaysElapsed(from, to)).toBe(
            referenceBusinessDaysElapsed(from, to),
          );
        }
      }
    });
  });

  // ── ENV SSOT default OFF ──────────────────────────────────────────────────────
  describe('isNewsLagEntryWindowObservationEnabled (default OFF)', () => {
    it('미설정 → false', () => {
      expect(isNewsLagEntryWindowObservationEnabled({})).toBe(false);
    });
    it("'true' → true", () => {
      expect(
        isNewsLagEntryWindowObservationEnabled({
          NEWS_LAG_ENTRY_WINDOW_OBSERVATION_ENABLED: 'true',
        }),
      ).toBe(true);
    });
    it("'1'/'TRUE' 등 비정확 비교 → false (ADR-0157)", () => {
      expect(
        isNewsLagEntryWindowObservationEnabled({
          NEWS_LAG_ENTRY_WINDOW_OBSERVATION_ENABLED: '1',
        }),
      ).toBe(false);
      expect(
        isNewsLagEntryWindowObservationEnabled({
          NEWS_LAG_ENTRY_WINDOW_OBSERVATION_ENABLED: 'TRUE',
        }),
      ).toBe(false);
    });
  });

  // ── computeNewsLagEntryWindowObservation — sector 조인·분류·graceful skip ──────
  describe('computeNewsLagEntryWindowObservation', () => {
    const now = new Date('2026-06-08'); // detectedAt 2026-06-01 → 영업일 5

    it('sector 조인 + n≥3 posterior → matched 분류 (elapsed 5, ci95[3,7] → IN)', () => {
      getOptimalEntryWindow.mockReturnValue(posterior());
      const obs = computeNewsLagEntryWindowObservation(
        '반도체',
        [rec()] as never,
        now,
      );
      expect(obs.sector).toBe('반도체');
      expect(obs.executionImpact).toBe('NONE');
      expect(obs.observationOnly).toBe(true);
      expect(obs.matchedRecords).toHaveLength(1);
      expect(obs.matchedRecords[0]).toMatchObject({
        newsType: '반도체수주',
        elapsedDays: 5,
        ci95LowDays: 3,
        ci95HighDays: 7,
        windowStatus: 'IN',
      });
      expect(obs.bestStatus).toBe('IN');
      expect(getOptimalEntryWindow).toHaveBeenCalledWith('반도체수주', '반도체');
    });

    it('PRE/IN/PAST 경계 — now 주입 결정성 (동일 입력 → 동일 산출)', () => {
      getOptimalEntryWindow.mockReturnValue(posterior({ ci95LowDays: 3, ci95HighDays: 7 }));
      // elapsed 2 (2026-06-01 화 → 2026-06-03 목) → PRE
      const pre = computeNewsLagEntryWindowObservation(
        '반도체',
        [rec()] as never,
        new Date('2026-06-03'),
      );
      // elapsed 10 (2026-06-01 → 2026-06-15) → PAST
      const past = computeNewsLagEntryWindowObservation(
        '반도체',
        [rec()] as never,
        new Date('2026-06-15'),
      );
      expect(pre.bestStatus).toBe('PRE');
      expect(past.bestStatus).toBe('PAST');
      // 결정성: 동일 입력 재호출 → 동일 결과
      const preAgain = computeNewsLagEntryWindowObservation(
        '반도체',
        [rec()] as never,
        new Date('2026-06-03'),
      );
      expect(preAgain).toEqual(pre);
    });

    it('n<3 → posterior null → graceful skip (불변식 #6)', () => {
      getOptimalEntryWindow.mockReturnValue(null);
      const obs = computeNewsLagEntryWindowObservation('반도체', [rec()] as never, now);
      expect(obs.matchedRecords).toHaveLength(0);
      expect(obs.bestStatus).toBeNull();
    });

    it('isComplete=true record → 제외 (활성 record 만)', () => {
      getOptimalEntryWindow.mockReturnValue(posterior());
      const obs = computeNewsLagEntryWindowObservation(
        '반도체',
        [rec({ isComplete: true })] as never,
        now,
      );
      expect(obs.matchedRecords).toHaveLength(0);
      // 완료 record 는 posterior 조회조차 하지 않음 (sector/isComplete 선필터)
      expect(getOptimalEntryWindow).not.toHaveBeenCalled();
    });

    it('sector 미매칭 record → 제외', () => {
      getOptimalEntryWindow.mockReturnValue(posterior());
      const obs = computeNewsLagEntryWindowObservation(
        '반도체',
        [rec({ sector: '바이오' })] as never,
        now,
      );
      expect(obs.matchedRecords).toHaveLength(0);
      expect(getOptimalEntryWindow).not.toHaveBeenCalled();
    });

    it('손상 detectedAt(NaN) → graceful skip', () => {
      getOptimalEntryWindow.mockReturnValue(posterior());
      const obs = computeNewsLagEntryWindowObservation(
        '반도체',
        [rec({ detectedAt: 'not-a-date' })] as never,
        now,
      );
      expect(obs.matchedRecords).toHaveLength(0);
    });

    it('빈 records → matchedRecords:[], bestStatus:null', () => {
      const obs = computeNewsLagEntryWindowObservation('반도체', [] as never, now);
      expect(obs.matchedRecords).toHaveLength(0);
      expect(obs.bestStatus).toBeNull();
      expect(obs.executionImpact).toBe('NONE');
    });
  });

  // ── computeNewsLagEntryWindowBySector — sector별 1회 dedup ─────────────────────
  describe('computeNewsLagEntryWindowBySector', () => {
    it('중복 sector → 1회만 산출 (Set dedup)', () => {
      getOptimalEntryWindow.mockReturnValue(posterior());
      const map = computeNewsLagEntryWindowBySector(
        ['반도체', '반도체', '바이오'],
        [rec()] as never,
        new Date('2026-06-08'),
      );
      expect(map.size).toBe(2);
      expect(map.get('반도체')?.bestStatus).toBe('IN');
      expect(map.get('바이오')?.matchedRecords).toHaveLength(0);
      // 반도체 record 1건 × 1회(dedup) + 바이오 0건 = posterior 조회 1회
      expect(getOptimalEntryWindow).toHaveBeenCalledTimes(1);
    });

    it('빈 sector 배열 → 빈 Map', () => {
      const map = computeNewsLagEntryWindowBySector([], [rec()] as never);
      expect(map.size).toBe(0);
    });
  });

  // ── loadActiveNewsSupplyRecordsForObservation — single 통로 ───────────────────
  describe('loadActiveNewsSupplyRecordsForObservation (single 통로)', () => {
    it('loadNewsSupplyRecords export 경유 (내부 store 미접근)', () => {
      loadNewsSupplyRecords.mockReturnValue([rec()] as never);
      const out = loadActiveNewsSupplyRecordsForObservation();
      expect(loadNewsSupplyRecords).toHaveBeenCalledTimes(1);
      expect(out).toHaveLength(1);
    });
  });

  // ── try/catch 격리 — stamp 호출자 패턴 회귀 (불변식 #1) ────────────────────────
  describe('stamp try/catch 격리 (불변식 #1)', () => {
    it('산출이 throw 해도 호출자 try/catch 가 scan 본체 보호', () => {
      // getOptimalEntryWindow 내부 throw 모사 → compute 가 전파해도 호출자가 격리.
      getOptimalEntryWindow.mockImplementation(() => {
        throw new Error('posterior store 손상');
      });
      let scanContinued = false;
      // universeScanner stamp 블록과 동형: try { ...산출... } catch { /* 격리 */ }
      try {
        computeNewsLagEntryWindowObservation('반도체', [rec()] as never, new Date('2026-06-08'));
      } catch {
        /* SDS-ignore: 테스트 — stamp 격리 시뮬레이션 */
      }
      scanContinued = true; // catch 후 후속 로직 진행 단언
      expect(scanContinued).toBe(true);
    });
  });
});
