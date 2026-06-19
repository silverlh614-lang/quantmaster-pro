// @responsibility ADR-0640 레짐 전환 알림 — 진동 억제·정직한 사유·무변화 라벨 회귀 검증.
import { describe, expect, it, afterEach } from 'vitest';
import {
  classifyRegimeTransition,
  isOscillationReversal,
  pruneDepartures,
  buildRegimeTransitionMessage,
  resolveRegimeNotifyDwellMs,
  shouldSuppressClosedMarketNotice,
  isRegimeNotifyWhenClosedEnabled,
  type NotifiedRegimeDeparture,
} from './regimeTransitionNotice.js';

const CFG = {
  R6_DEFENSE: { kellyMultiplier: 0.3, maxPositions: 3 },
  R5_CAUTION: { kellyMultiplier: 0.3, maxPositions: 3 },
  R3_EARLY: { kellyMultiplier: 0.7, maxPositions: 6 },
};

describe('classifyRegimeTransition (③ 무변화 라벨)', () => {
  it('R6_DEFENSE→R5_CAUTION 은 설정 동일 → RELABEL_NO_CHANGE (공격 전환 오라벨 금지)', () => {
    const c = classifyRegimeTransition({ isDowngrade: false, prevCfg: CFG.R6_DEFENSE, currCfg: CFG.R5_CAUTION });
    expect(c.kind).toBe('RELABEL_NO_CHANGE');
    expect(c.materialChange).toBe(false);
    expect(c.label).not.toContain('공격');
  });

  it('R5_CAUTION→R3_EARLY 은 Kelly·한도 상승 → UPGRADE(공격 전환)', () => {
    const c = classifyRegimeTransition({ isDowngrade: false, prevCfg: CFG.R5_CAUTION, currCfg: CFG.R3_EARLY });
    expect(c.kind).toBe('UPGRADE');
    expect(c.label).toBe('공격 전환');
  });

  it('R3_EARLY→R5_CAUTION 은 하락 → DOWNGRADE(방어 강화)', () => {
    const c = classifyRegimeTransition({ isDowngrade: true, prevCfg: CFG.R3_EARLY, currCfg: CFG.R5_CAUTION });
    expect(c.kind).toBe('DOWNGRADE');
    expect(c.label).toBe('방어 강화');
  });
});

describe('isOscillationReversal / pruneDepartures (① 진동 억제)', () => {
  it('dwell 창 안에서 떠난 레짐으로 되돌아오면 oscillation', () => {
    const now = 1_000_000;
    const dwell = 600_000; // 10분
    const departures: NotifiedRegimeDeparture[] = [{ regime: 'R5_CAUTION', at: now - 60_000 }];
    // R6 에서 R5 로 되돌아옴 → R5 가 최근 departed → true
    expect(isOscillationReversal(departures, 'R5_CAUTION', now, dwell)).toBe(true);
  });

  it('dwell 창 밖이면 정상 전환(억제 안 함)', () => {
    const now = 1_000_000;
    const dwell = 600_000;
    const departures: NotifiedRegimeDeparture[] = [{ regime: 'R5_CAUTION', at: now - 700_000 }];
    expect(isOscillationReversal(departures, 'R5_CAUTION', now, dwell)).toBe(false);
  });

  it('dwell=0 이면 항상 false (legacy 동작 복원)', () => {
    const now = 1_000_000;
    const departures: NotifiedRegimeDeparture[] = [{ regime: 'R5_CAUTION', at: now - 1 }];
    expect(isOscillationReversal(departures, 'R5_CAUTION', now, 0)).toBe(false);
  });

  it('pruneDepartures 는 창 밖·미래 skew 항목 제거', () => {
    const now = 1_000_000;
    const dwell = 600_000;
    const pruned = pruneDepartures(
      [
        { regime: 'R5_CAUTION', at: now - 60_000 }, // 유지
        { regime: 'R4_NEUTRAL', at: now - 700_000 }, // 창 밖
        { regime: 'R6_DEFENSE', at: now + 5_000 }, // 미래 skew
      ],
      now,
      dwell,
    );
    expect(pruned).toHaveLength(1);
    expect(pruned[0].regime).toBe('R5_CAUTION');
  });
});

describe('buildRegimeTransitionMessage (② 정직한 사유)', () => {
  it('MHS/VKOSPI 변화 0 이면 "거시 지표 변화 없음" 명시 + 전환 사유 노출', () => {
    const msg = buildRegimeTransitionMessage({
      prevRegime: 'R6_DEFENSE',
      currRegime: 'R5_CAUTION',
      prevCfg: CFG.R6_DEFENSE,
      currCfg: CFG.R5_CAUTION,
      prevMhs: 63,
      currMhs: 63,
      prevVkospi: 80.3,
      currVkospi: 80.3,
      transitionReason: 'R6_RECOVERY_WATCH_DECAY',
      r6RecoveryStatus: 'R5_STABILIZING',
      classification: classifyRegimeTransition({ isDowngrade: false, prevCfg: CFG.R6_DEFENSE, currCfg: CFG.R5_CAUTION }),
      resetNote: '',
    });
    expect(msg).toContain('전환 사유: R6_RECOVERY_WATCH_DECAY');
    expect(msg).toContain('복구상태: R5_STABILIZING');
    expect(msg).toContain('거시 지표 변화 없음');
    // ③ 무변화 → "정책 변경 없음" 단일 라인, "공격 전환" 라벨 없음
    expect(msg).toContain('정책 변경 없음');
    expect(msg).not.toContain('(공격 전환)');
  });

  it('실질 변화(material) 전환은 Kelly/한도 변경 라인 출력', () => {
    const msg = buildRegimeTransitionMessage({
      prevRegime: 'R5_CAUTION',
      currRegime: 'R3_EARLY',
      prevCfg: CFG.R5_CAUTION,
      currCfg: CFG.R3_EARLY,
      prevMhs: 50,
      currMhs: 62,
      prevVkospi: 25,
      currVkospi: 20,
      transitionReason: 'RISK_ON_FAST_UPGRADE',
      r6RecoveryStatus: 'NONE',
      classification: classifyRegimeTransition({ isDowngrade: false, prevCfg: CFG.R5_CAUTION, currCfg: CFG.R3_EARLY }),
      resetNote: '',
    });
    expect(msg).toContain('변경사항 (공격 전환)');
    expect(msg).toContain('Kelly 배율: ×0.3 → ×0.7');
    expect(msg).toContain('신규 진입 한도: 3개 → 6개');
    expect(msg).not.toContain('거시 지표 변화 없음');
    // r6RecoveryStatus=NONE 이면 복구상태 라인 생략
    expect(msg).not.toContain('복구상태');
  });
});

describe('shouldSuppressClosedMarketNotice (D2 장외 억제)', () => {
  it('장중이면 억제 안 함', () => {
    expect(shouldSuppressClosedMarketNotice({ marketOpen: true, isR6Entry: false })).toBe(false);
  });

  it('장외 + R6 진입 아님 → 억제 (마감 후 R3↔R4 churn 차단)', () => {
    expect(shouldSuppressClosedMarketNotice({ marketOpen: false, isR6Entry: false })).toBe(true);
  });

  it('장외라도 R6_DEFENSE 진입은 통과 (블랙스완 경보 보존)', () => {
    expect(shouldSuppressClosedMarketNotice({ marketOpen: false, isR6Entry: true })).toBe(false);
  });
});

describe('isRegimeNotifyWhenClosedEnabled (ENV)', () => {
  const original = process.env.REGIME_NOTIFY_WHEN_CLOSED;
  afterEach(() => {
    if (original === undefined) delete process.env.REGIME_NOTIFY_WHEN_CLOSED;
    else process.env.REGIME_NOTIFY_WHEN_CLOSED = original;
  });

  it('미설정 → false (기본 장외 억제)', () => {
    delete process.env.REGIME_NOTIFY_WHEN_CLOSED;
    expect(isRegimeNotifyWhenClosedEnabled()).toBe(false);
  });

  it("=true → 장외에도 발송(legacy 복원)", () => {
    process.env.REGIME_NOTIFY_WHEN_CLOSED = 'true';
    expect(isRegimeNotifyWhenClosedEnabled()).toBe(true);
  });
});

describe('resolveRegimeNotifyDwellMs (ENV 가드)', () => {
  const original = process.env.REGIME_NOTIFY_MIN_DWELL_MIN;
  afterEach(() => {
    if (original === undefined) delete process.env.REGIME_NOTIFY_MIN_DWELL_MIN;
    else process.env.REGIME_NOTIFY_MIN_DWELL_MIN = original;
  });

  it('미설정 → 기본 10분', () => {
    delete process.env.REGIME_NOTIFY_MIN_DWELL_MIN;
    expect(resolveRegimeNotifyDwellMs()).toBe(10 * 60_000);
  });

  it('0 → 억제 비활성(0ms)', () => {
    process.env.REGIME_NOTIFY_MIN_DWELL_MIN = '0';
    expect(resolveRegimeNotifyDwellMs()).toBe(0);
  });

  it('상한 120분 clamp', () => {
    process.env.REGIME_NOTIFY_MIN_DWELL_MIN = '999';
    expect(resolveRegimeNotifyDwellMs()).toBe(120 * 60_000);
  });

  it('음수/NaN → 기본값 fallback', () => {
    process.env.REGIME_NOTIFY_MIN_DWELL_MIN = '-5';
    expect(resolveRegimeNotifyDwellMs()).toBe(10 * 60_000);
    process.env.REGIME_NOTIFY_MIN_DWELL_MIN = 'abc';
    expect(resolveRegimeNotifyDwellMs()).toBe(10 * 60_000);
  });
});
