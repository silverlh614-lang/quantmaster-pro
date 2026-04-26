/**
 * @responsibility PR-X4 ADR-0040 매크로 다이제스트 회귀 테스트
 *
 * 검증:
 *   - PRE_OPEN / POST_CLOSE 두 모드 메시지 포맷 정합성
 *   - 데이터 누락(NaN/undefined/null) 시 'N/A' fallback
 *   - 외국인 5d 누적 단위 분기 (조원 vs 억원)
 *   - dispatchAlert(ChannelSemantic.REGIME) 호출 검증 (mock)
 *   - dedupeKey 형식
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MacroState } from '../persistence/macroStateRepo.js';
import { formatMacroDigest, runMacroDigest } from './macroDigestReport.js';

vi.mock('./alertRouter.js', () => ({
  dispatchAlert: vi.fn().mockResolvedValue(123),
  ChannelSemantic: {
    EXECUTION: 'TRADE',
    SIGNAL: 'ANALYSIS',
    REGIME: 'INFO',
    JOURNAL: 'SYSTEM',
  },
}));

vi.mock('../persistence/macroStateRepo.js', async (importOriginal) => {
  const actual: Record<string, unknown> = await importOriginal();
  return {
    ...actual,
    loadMacroState: vi.fn(),
  };
});

import { dispatchAlert } from './alertRouter.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';

const NOW = new Date('2026-04-26T23:30:00Z'); // KST 08:30 토요일

function makeState(overrides: Partial<MacroState> = {}): MacroState {
  return {
    mhs: 65,
    regime: 'R2_BULL',
    updatedAt: NOW.toISOString(),
    vkospi: 22.3,
    vkospi5dTrend: 0.5,
    usdKrw: 1320,
    usdKrwDayChange: 0.3,
    usdKrw20dChange: -0.5,
    foreignNetBuy5d: 12000, // 1.2조원
    vix: 18.5,
    vixHistory: [19.7, 18.5],
    yieldCurve10y2y: 0.45,
    dxyBullish: false,
    dxy5dChange: 0.8,
    ewyDayChange: 0.8,
    mhsTrend: 'IMPROVING',
    kospiDayReturn: 0.5,
    kospi20dReturn: 2.1,
    marginBalance5dChange: 1.2,
    spx20dReturn: 1.8,
    wtiCrude: 73.5,
    hySpread: 3.2,
    ...overrides,
  };
}

describe('formatMacroDigest — PRE_OPEN', () => {
  it('정상 데이터로 모든 섹션 렌더', () => {
    const msg = formatMacroDigest(makeState(), 'PRE_OPEN', NOW);
    expect(msg).toMatch(/매크로 다이제스트 \(장 전\)/);
    expect(msg).toMatch(/08:30 KST/);
    expect(msg).toContain('🇺🇸');
    expect(msg).toContain('VIX 18.5');
    expect(msg).toContain('US10Y-2Y');
    expect(msg).toContain('DXY');
    expect(msg).toContain('💱');
    expect(msg).toContain('USD/KRW 1,320원');
    expect(msg).toContain('🇰🇷');
    expect(msg).toContain('VKOSPI 22.3');
    expect(msg).toContain('외국인 5d 누적');
    expect(msg).toContain('+1.20조원');
    expect(msg).toContain('EWY ADR');
    expect(msg).toContain('MHS 65');
    expect(msg).toContain('R2 BULL');
  });

  it('macroState=null 시 graceful fallback (모든 N/A)', () => {
    const msg = formatMacroDigest(null, 'PRE_OPEN', NOW);
    expect(msg).toMatch(/매크로 다이제스트 \(장 전\)/);
    expect(msg).toContain('VIX N/A');
    expect(msg).toContain('USD/KRW N/A원');
    expect(msg).toContain('VKOSPI N/A');
    expect(msg).toContain('MHS N/A');
  });

  it('DXY bullish 분기 — 강세/약세 라벨', () => {
    const bullMsg = formatMacroDigest(makeState({ dxyBullish: true }), 'PRE_OPEN', NOW);
    expect(bullMsg).toMatch(/DXY 강세/);
    const bearMsg = formatMacroDigest(makeState({ dxyBullish: false }), 'PRE_OPEN', NOW);
    expect(bearMsg).toMatch(/DXY 약세/);
  });

  it('US10Y-2Y 음수 시 ⚠️ 역전 마커', () => {
    const msg = formatMacroDigest(makeState({ yieldCurve10y2y: -0.3 }), 'PRE_OPEN', NOW);
    expect(msg).toContain('⚠️ 역전');
  });

  it('VKOSPI 5일 추세 양수면 ↑', () => {
    const msg = formatMacroDigest(makeState({ vkospi5dTrend: 1.5 }), 'PRE_OPEN', NOW);
    expect(msg).toMatch(/VKOSPI .* \(5d ↑\)/);
  });

  it('VKOSPI 5일 추세 음수면 ↓', () => {
    const msg = formatMacroDigest(makeState({ vkospi5dTrend: -0.8 }), 'PRE_OPEN', NOW);
    expect(msg).toMatch(/VKOSPI .* \(5d ↓\)/);
  });
});

describe('formatMacroDigest — POST_CLOSE', () => {
  const POST_NOW = new Date('2026-04-26T07:00:00Z'); // KST 16:00

  it('정상 데이터로 모든 섹션 렌더', () => {
    const msg = formatMacroDigest(makeState(), 'POST_CLOSE', POST_NOW);
    expect(msg).toMatch(/매크로 다이제스트 \(장 후\)/);
    expect(msg).toMatch(/16:00 KST/);
    expect(msg).toContain('한국 결산');
    expect(msg).toContain('KOSPI 일변동 +0.5%');
    expect(msg).toContain('20d +2.1%');
    expect(msg).toContain('VKOSPI 22.3');
    expect(msg).toContain('외국인 5d 누적');
    expect(msg).toContain('신용잔고 5d 변화: +1.2%');
    expect(msg).toContain('S&amp;P500 20d +1.8%');
    expect(msg).toContain('WTI 73.5 USD/배럴');
    expect(msg).toContain('HY 스프레드: 3.20%');
  });

  it('macroState=null 시 graceful fallback', () => {
    const msg = formatMacroDigest(null, 'POST_CLOSE', POST_NOW);
    expect(msg).toMatch(/매크로 다이제스트 \(장 후\)/);
    expect(msg).toContain('KOSPI 일변동 N/A');
    expect(msg).toContain('VKOSPI N/A');
  });

  it('hySpread 누락 시 해당 라인 생략 (filter Boolean)', () => {
    const state = makeState({ hySpread: undefined });
    const msg = formatMacroDigest(state, 'POST_CLOSE', POST_NOW);
    expect(msg).not.toContain('HY 스프레드');
  });
});

describe('formatMacroDigest 외국인 5d 누적 단위 분기', () => {
  it('1조원 미만 → 억원', () => {
    const msg = formatMacroDigest(makeState({ foreignNetBuy5d: 5000 }), 'PRE_OPEN', NOW);
    expect(msg).toContain('+5,000억원');
  });

  it('1조원 이상 → 조원', () => {
    const msg = formatMacroDigest(makeState({ foreignNetBuy5d: 12000 }), 'PRE_OPEN', NOW);
    expect(msg).toContain('+1.20조원');
  });

  it('음수 1조원 이상', () => {
    const msg = formatMacroDigest(makeState({ foreignNetBuy5d: -15000 }), 'PRE_OPEN', NOW);
    expect(msg).toContain('-1.50조원');
  });

  it('음수 억원', () => {
    const msg = formatMacroDigest(makeState({ foreignNetBuy5d: -3000 }), 'PRE_OPEN', NOW);
    expect(msg).toContain('-3,000억원');
  });

  it('0 (정확히)', () => {
    const msg = formatMacroDigest(makeState({ foreignNetBuy5d: 0 }), 'PRE_OPEN', NOW);
    // 0 은 양수로 처리 → +0억원
    expect(msg).toContain('+0억원');
  });
});

describe('formatMacroDigest 잔고 키워드 누출 방지', () => {
  it('PRE_OPEN 메시지에 잔고 키워드 없음', () => {
    const msg = formatMacroDigest(makeState(), 'PRE_OPEN', NOW);
    const FORBIDDEN = ['총자산', '총 자산', '주문가능현금', '잔여 현금', '잔여현금', '보유자산', '보유 자산', '평가손익'];
    for (const kw of FORBIDDEN) {
      expect(msg).not.toContain(kw);
    }
  });

  it('POST_CLOSE 메시지에 잔고 키워드 없음', () => {
    const msg = formatMacroDigest(makeState(), 'POST_CLOSE', NOW);
    const FORBIDDEN = ['총자산', '총 자산', '주문가능현금', '잔여 현금', '잔여현금', '보유자산', '보유 자산', '평가손익'];
    for (const kw of FORBIDDEN) {
      expect(msg).not.toContain(kw);
    }
  });

  it('PRE_OPEN 메시지에 개별 종목 정보(6자리 코드) 없음', () => {
    const msg = formatMacroDigest(makeState(), 'PRE_OPEN', NOW);
    expect(msg).not.toMatch(/\b\d{6}\b/);
  });
});

describe('runMacroDigest — dispatchAlert wiring', () => {
  beforeEach(() => {
    vi.mocked(dispatchAlert).mockClear();
    vi.mocked(loadMacroState).mockReturnValue(makeState());
  });

  it('PRE_OPEN 발송 시 dispatchAlert(REGIME) 호출', async () => {
    await runMacroDigest('PRE_OPEN', NOW);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    const [category, message, options] = vi.mocked(dispatchAlert).mock.calls[0];
    expect(category).toBe('INFO'); // ChannelSemantic.REGIME = AlertCategory.INFO
    expect(message).toMatch(/매크로 다이제스트 \(장 전\)/);
    expect(options?.priority).toBe('NORMAL');
    expect(options?.dedupeKey).toMatch(/^macro_digest:PRE_OPEN:\d{4}-\d{2}-\d{2}$/);
  });

  it('POST_CLOSE 발송 시 dispatchAlert(REGIME) 호출 + dedupeKey 다름', async () => {
    const POST_NOW = new Date('2026-04-26T07:00:00Z');
    await runMacroDigest('POST_CLOSE', POST_NOW);
    const [, , options] = vi.mocked(dispatchAlert).mock.calls[0];
    expect(options?.dedupeKey).toMatch(/^macro_digest:POST_CLOSE:\d{4}-\d{2}-\d{2}$/);
  });

  it('macroState=null 시에도 dispatchAlert 호출 (graceful fallback)', async () => {
    vi.mocked(loadMacroState).mockReturnValue(null);
    await runMacroDigest('PRE_OPEN', NOW);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    const [, message] = vi.mocked(dispatchAlert).mock.calls[0];
    expect(message).toContain('VIX N/A');
  });

  it('dispatchAlert throw 시 catch (외부 에러로 cron 차단되지 않음)', async () => {
    vi.mocked(dispatchAlert).mockRejectedValueOnce(new Error('네트워크 실패'));
    // throw 하지 않고 정상 종료해야 함
    await expect(runMacroDigest('PRE_OPEN', NOW)).resolves.toBeUndefined();
  });
});

describe('runMacroDigest dedupeKey KST 자정 정합성', () => {
  beforeEach(() => {
    vi.mocked(dispatchAlert).mockClear();
    vi.mocked(loadMacroState).mockReturnValue(makeState());
  });

  it('UTC 23:30 (KST 다음날 08:30) — KST 일자 기준', async () => {
    // UTC 2026-04-26 23:30 = KST 2026-04-27 08:30
    const ksDate = new Date('2026-04-26T23:30:00Z');
    await runMacroDigest('PRE_OPEN', ksDate);
    const [, , options] = vi.mocked(dispatchAlert).mock.calls[0];
    expect(options?.dedupeKey).toBe('macro_digest:PRE_OPEN:2026-04-27');
  });

  it('UTC 07:00 (KST 16:00 같은 날) — KST 일자 기준', async () => {
    const ksDate = new Date('2026-04-26T07:00:00Z');
    await runMacroDigest('POST_CLOSE', ksDate);
    const [, , options] = vi.mocked(dispatchAlert).mock.calls[0];
    expect(options?.dedupeKey).toBe('macro_digest:POST_CLOSE:2026-04-26');
  });
});
