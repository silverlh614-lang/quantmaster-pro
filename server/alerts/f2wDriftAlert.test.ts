/**
 * @responsibility f2wDriftAlert 회귀 테스트 (ADR-0046 PR-Y1)
 *
 * 검증:
 *   - 페이로드 검증 (필수 필드 누락 차단)
 *   - 메시지 포맷 (잔고 키워드 누출 0 + 종목 정보 0)
 *   - dispatchAlert(JOURNAL) + sendPrivateAlert 둘 다 호출
 *   - 24h dedupeKey (KST 일자)
 *   - dispatchAlert throw 시 sendPrivateAlert 는 시도 + ok=true (둘 중 하나라도 성공)
 *   - 둘 다 throw 시 ok=false + error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./alertRouter.js', () => ({
  dispatchAlert: vi.fn().mockResolvedValue(1),
  ChannelSemantic: {
    EXECUTION: 'TRADE',
    SIGNAL: 'ANALYSIS',
    REGIME: 'INFO',
    JOURNAL: 'SYSTEM',
  },
}));
vi.mock('./telegramClient.js', () => ({
  sendPrivateAlert: vi.fn().mockResolvedValue(2),
}));

import {
  formatF2WDriftMessage,
  handleF2WDriftAlert,
  type F2WDriftAlertPayload,
} from './f2wDriftAlert.js';
import { dispatchAlert } from './alertRouter.js';
import { sendPrivateAlert } from './telegramClient.js';

beforeEach(() => {
  vi.clearAllMocks();
  (dispatchAlert as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1);
  (sendPrivateAlert as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(2);
});

const NOW = new Date('2026-04-26T00:00:00Z'); // KST 09:00

function makePayload(overrides: Partial<F2WDriftAlertPayload> = {}): F2WDriftAlertPayload {
  return {
    sigma7d: 0.40,
    sigma30dAvg: 0.16,
    ratio: 2.5,
    pausedUntil: '2026-05-03T00:00:00.000Z',
    reason: 'σ7d ≥ σ30d × 2',
    topConditions: [
      { conditionId: 25, weight: 1.5, deviation: 0.45 },
      { conditionId: 1, weight: 0.55, deviation: 0.45 },
      { conditionId: 17, weight: 1.4, deviation: 0.35 },
    ],
    ...overrides,
  };
}

// ─── formatF2WDriftMessage ───────────────────────────────────────────────────

describe('formatF2WDriftMessage', () => {
  it('전체 섹션 렌더 + KST 만료 시각 포맷', () => {
    const msg = formatF2WDriftMessage(makePayload(), NOW);
    expect(msg).toContain('자기학습 가중치 동결');
    expect(msg).toContain('σ7d');
    expect(msg).toContain('0.4000');
    expect(msg).toContain('σ30d');
    expect(msg).toContain('0.1600');
    expect(msg).toContain('ratio = 2.50× (임계 ≥ 2.0×)');
    expect(msg).toContain('일시정지 만료');
    // KST 변환 검증 — UTC 2026-05-03 00:00 → KST 2026-05-03 09:00
    expect(msg).toContain('2026-05-03 09:00 KST');
    expect(msg).toContain('VCP'); // 조건 25 매핑
    expect(msg).toContain('주도주 사이클'); // 조건 1
    expect(msg).toContain('변화는 영양이지만 변화의 변화는 독');
    expect(msg).toContain('shadow 학습은 계속');
  });

  it('Top 조건 0건 시 "데이터 부재" fallback', () => {
    const msg = formatF2WDriftMessage(makePayload({ topConditions: [] }), NOW);
    expect(msg).toContain('데이터 부재');
  });

  it('알 수 없는 conditionId 는 "조건N" fallback', () => {
    const msg = formatF2WDriftMessage(
      makePayload({
        topConditions: [{ conditionId: 99, weight: 1.5, deviation: 0.5 }],
      }),
      NOW,
    );
    expect(msg).toContain('조건99');
  });

  it('절대 규칙 — 잔고 키워드 누출 0건', () => {
    const msg = formatF2WDriftMessage(makePayload(), NOW);
    const sensitiveKeywords = ['총자산', '주문가능현금', '잔여현금', '평가손익', '보유자산'];
    for (const kw of sensitiveKeywords) {
      expect(msg).not.toContain(kw);
    }
  });

  it('절대 규칙 — 6자리 종목 코드 0건', () => {
    const msg = formatF2WDriftMessage(makePayload(), NOW);
    expect(msg).not.toMatch(/\b\d{6}\b/);
  });

  it('잘못된 pausedUntil 은 raw 문자열 그대로', () => {
    const msg = formatF2WDriftMessage(
      makePayload({ pausedUntil: 'invalid-date' }),
      NOW,
    );
    expect(msg).toContain('invalid-date');
  });
});

// ─── handleF2WDriftAlert ─────────────────────────────────────────────────────

describe('handleF2WDriftAlert', () => {
  it('정상 페이로드 → dispatchAlert(JOURNAL) + sendPrivateAlert 둘 다 호출', async () => {
    const result = await handleF2WDriftAlert(makePayload());
    expect(result.ok).toBe(true);
    expect(result.dispatched).toBe(true);
    expect(result.privateSent).toBe(true);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    expect(sendPrivateAlert).toHaveBeenCalledTimes(1);
    // JOURNAL 카테고리 (mock 의 'SYSTEM') 사용 확인
    const dispatchCall = (dispatchAlert as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(dispatchCall[0]).toBe('SYSTEM');
    // dedupeKey 형식
    expect(dispatchCall[2]).toMatchObject({
      priority: 'HIGH',
      dedupeKey: expect.stringMatching(/^f2w_drift_detected:\d{4}-\d{2}-\d{2}$/),
    });
    // sendPrivateAlert 별도 dedupeKey
    const dmCall = (sendPrivateAlert as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(dmCall[1]).toMatchObject({
      priority: 'HIGH',
      dedupeKey: expect.stringMatching(/^f2w_drift_private:\d{4}-\d{2}-\d{2}$/),
      cooldownMs: 24 * 60 * 60 * 1000,
    });
  });

  it('잘못된 페이로드 (필드 누락) → 400 응답 + 호출 0건', async () => {
    const result = await handleF2WDriftAlert({ sigma7d: 0.4 });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
    expect(dispatchAlert).not.toHaveBeenCalled();
    expect(sendPrivateAlert).not.toHaveBeenCalled();
  });

  it('null 페이로드 → invalid_payload', async () => {
    const result = await handleF2WDriftAlert(null);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
  });

  it('topConditions 가 배열 아님 → invalid_payload', async () => {
    const bad = { ...makePayload(), topConditions: 'not-array' };
    const result = await handleF2WDriftAlert(bad);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('invalid_payload');
  });

  it('dispatchAlert throw → privateSent=true 면 ok=true (graceful)', async () => {
    (dispatchAlert as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('CH4 down'));
    const result = await handleF2WDriftAlert(makePayload());
    expect(result.ok).toBe(true);
    expect(result.dispatched).toBe(false);
    expect(result.privateSent).toBe(true);
    expect(result.error).toContain('CH4 down');
  });

  it('sendPrivateAlert throw → dispatched=true 면 ok=true', async () => {
    (sendPrivateAlert as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('DM 401'));
    const result = await handleF2WDriftAlert(makePayload());
    expect(result.ok).toBe(true);
    expect(result.dispatched).toBe(true);
    expect(result.privateSent).toBe(false);
    expect(result.error).toContain('DM 401');
  });

  it('둘 다 throw → ok=false + 누적 error', async () => {
    (dispatchAlert as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('A'));
    (sendPrivateAlert as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('B'));
    const result = await handleF2WDriftAlert(makePayload());
    expect(result.ok).toBe(false);
    expect(result.dispatched).toBe(false);
    expect(result.privateSent).toBe(false);
    expect(result.error).toContain('A');
    expect(result.error).toContain('B');
  });
});
