/**
 * @responsibility addBusinessDays 인라인(nearMiss/gate2) vs krxHolidays SSOT 의미 특성화 — 휴일 인식 불일치 잠금(dup-concept #2, 경우 B 증거).
 */
import { describe, it, expect } from 'vitest';
import { addBusinessDays as nearMissAddBusinessDays } from './nearMissOutcomeLedger.js';
import { addBusinessDaysFromKstDate, KRX_HOLIDAYS } from '../trading/krxHolidays.js';

/**
 * gate2OutcomeRepo.ts:43 의 인라인 addBusinessDays 는 export 되지 않으므로
 * (그 모듈은 인라인 헬퍼) 동일 로직을 golden 참조로 복제한다.
 * 본 로직이 nearMiss 인라인과 byte-equivalent 함을 아래에서 단언한다.
 */
function gate2InlineAddBusinessDays(ymd: string, n: number): string {
  const date = new Date(`${ymd}T00:00:00.000Z`);
  let added = 0;
  while (added < n) {
    date.setUTCDate(date.getUTCDate() + 1);
    const dow = date.getUTCDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

describe('addBusinessDays 의미 특성화 — 인라인(주말만) vs SSOT(주말+휴일)', () => {
  describe('두 인라인 구현은 서로 byte-equivalent (주말만 건너뜀)', () => {
    const cases: Array<[string, number]> = [
      ['2026-04-27', 5], // 평일 기준
      ['2026-04-24', 5], // 금요일 기준
      ['2026-02-13', 3], // 설날(2/16~2/18) 직전 금요일
      ['2026-04-30', 3], // 근로자의 날(5/1)·어린이날(5/5) 인접
      ['2026-09-23', 5], // 추석(9/24~9/26) 인접
    ];
    for (const [base, n] of cases) {
      it(`${base} +${n}영업일: nearMiss == gate2`, () => {
        expect(nearMissAddBusinessDays(base, n)).toBe(gate2InlineAddBusinessDays(base, n));
      });
    }
  });

  describe('GOLDEN — 인라인 현재 출력 잠금 (평일·주말 경계)', () => {
    it('월요일 +5영업일 → 다음 주 월요일', () => {
      expect(nearMissAddBusinessDays('2026-04-27', 5)).toBe('2026-05-04');
    });
    it('금요일 +1영업일 → 월요일', () => {
      expect(nearMissAddBusinessDays('2026-04-24', 1)).toBe('2026-04-27');
    });
  });

  describe('SSOT 는 휴일+주말 인식 (KRX_HOLIDAYS 비어있지 않음 확인)', () => {
    it('KRX_HOLIDAYS 는 2026 휴일을 포함한다', () => {
      expect(KRX_HOLIDAYS.has('2026-05-01')).toBe(true); // 근로자의 날
      expect(KRX_HOLIDAYS.has('2026-02-16')).toBe(true); // 설날 연휴
    });
  });

  /**
   * 핵심 경우 B 증거: 휴일 구간을 가로지르는 horizon 에서 인라인 != SSOT.
   * 인라인은 휴일을 영업일로 잘못 계산 → SSOT 보다 이른(=잘못된) 타겟 날짜 산출.
   */
  describe('불일치 명시 — 휴일 인접 구간에서 인라인 != SSOT', () => {
    const mismatchCases: Array<{ base: string; n: number; inline: string; ssot: string; note: string }> = [
      {
        // 2026-04-30(목) +3영업일. 인라인: 5/1(금)·5/4(월)·5/5(화) 모두 영업일로 계산.
        // SSOT: 5/1(근로자의 날 휴장)·5/5(어린이날 휴장) 건너뜀.
        base: '2026-04-30',
        n: 3,
        inline: '2026-05-05',
        ssot: '2026-05-07',
        note: '근로자의 날(5/1)·어린이날(5/5) 인라인 무시',
      },
      {
        // 2026-02-13(금) +3영업일. 인라인: 2/16·2/17·2/18 설날 연휴를 영업일로 계산.
        // SSOT: 설날 연휴 전체 건너뜀.
        base: '2026-02-13',
        n: 3,
        inline: '2026-02-18',
        ssot: '2026-02-23',
        note: '설날 연휴(2/16~2/18) 인라인 무시',
      },
      {
        // 2026-09-23(수) +5영업일. 인라인: 추석(9/24~9/26) 영업일로 계산.
        base: '2026-09-23',
        n: 5,
        inline: '2026-09-30',
        ssot: '2026-10-02',
        note: '추석 연휴(9/24~9/26) 인라인 무시',
      },
    ];

    for (const c of mismatchCases) {
      it(`${c.base} +${c.n}영업일 — 인라인 ${c.inline} vs SSOT ${c.ssot} (${c.note})`, () => {
        // 인라인 현재 출력 골든 잠금
        expect(nearMissAddBusinessDays(c.base, c.n)).toBe(c.inline);
        expect(gate2InlineAddBusinessDays(c.base, c.n)).toBe(c.inline);
        // SSOT 출력 잠금
        expect(addBusinessDaysFromKstDate(c.base, c.n)).toBe(c.ssot);
        // 의도적 불일치 단언 — 위임 시 forward-return 타겟 날짜가 바뀐다(학습 라벨 변경).
        expect(nearMissAddBusinessDays(c.base, c.n)).not.toBe(addBusinessDaysFromKstDate(c.base, c.n));
      });
    }
  });
});
