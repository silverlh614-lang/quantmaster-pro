/**
 * @responsibility ADR-0128 /data_verification_review 회귀 테스트 — queue 조회 / approve / drop / alias 등록
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const _getManualReviewQueue = vi.fn(() => [] as Array<{
  stockCode: string;
  stockName?: string;
  consecutiveFailures: number;
  firstFailedAt: string;
  lastFailedAt: string;
  lastFailureReason: string;
  nextRetryAt: string;
  manualReviewState: 'NONE' | 'QUEUED' | 'APPROVED' | 'DROPPED';
}>);
const _setManualReviewState = vi.fn<(...args: unknown[]) => boolean>(() => true);

vi.mock('../../../persistence/verificationQueueRepo.js', () => ({
  getManualReviewQueue: _getManualReviewQueue,
  setManualReviewState: _setManualReviewState,
}));

vi.mock('../../commandRegistry.js', () => ({
  commandRegistry: { register: vi.fn() },
}));

let dataVerificationReview: typeof import('./dataVerificationReview.cmd.js').default;
let formatVerificationReviewMessage: typeof import('./dataVerificationReview.cmd.js').formatVerificationReviewMessage;

beforeEach(async () => {
  const mod = await import('./dataVerificationReview.cmd.js');
  dataVerificationReview = mod.default;
  formatVerificationReviewMessage = mod.formatVerificationReviewMessage;
  _getManualReviewQueue.mockClear();
  _getManualReviewQueue.mockReturnValue([]);
  _setManualReviewState.mockClear();
  _setManualReviewState.mockReturnValue(true);
});

afterEach(() => {
  // no-op
});

describe('/data_verification_review — queue 조회', () => {
  it('빈 queue → "현재 검토 대기 종목 없음" 안내 + 사용법', async () => {
    _getManualReviewQueue.mockReturnValueOnce([]);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await dataVerificationReview.execute({ args: [], reply });

    expect(reply).toHaveBeenCalledOnce();
    const msg = reply.mock.calls[0]![0];
    expect(msg).toContain('검토 대기 종목 없음');
    expect(msg).toContain('approve <code>');
    expect(msg).toContain('drop <code>');
  });

  it('2건 queue 조회 → 종목별 사유 + 최근 시각 표기', async () => {
    _getManualReviewQueue.mockReturnValueOnce([
      {
        stockCode: '189300', stockName: '인텔리안테크',
        consecutiveFailures: 3,
        firstFailedAt: '2026-04-28T16:30:00Z',
        lastFailedAt: '2026-04-30T16:30:00Z',
        lastFailureReason: 'STALE_BASE_OR_SPLIT_ADJUSTMENT',
        nextRetryAt: '2026-05-01T16:30:00Z',
        manualReviewState: 'QUEUED',
      },
      {
        stockCode: '098460',
        consecutiveFailures: 4,
        firstFailedAt: '2026-04-27T16:30:00Z',
        lastFailedAt: '2026-04-30T16:30:00Z',
        lastFailureReason: 'CORPORATE_ACTION_SUSPECTED',
        nextRetryAt: '2026-05-01T16:30:00Z',
        manualReviewState: 'QUEUED',
      },
    ]);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await dataVerificationReview.execute({ args: [], reply });

    const msg = reply.mock.calls[0]![0];
    expect(msg).toContain('2건 검토 대기');
    expect(msg).toContain('인텔리안테크 (189300)');
    expect(msg).toContain('098460');
    expect(msg).toContain('연속 3회 실패');
    expect(msg).toContain('STALE_BASE');
    expect(msg).toContain('CORPORATE_ACTION_SUSPECTED');
  });
});

describe('/data_verification_review approve <code>', () => {
  it('정상 — setManualReviewState(APPROVED) + ✅ 격리 해제 메시지', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await dataVerificationReview.execute({ args: ['approve', '189300'], reply });

    expect(_setManualReviewState).toHaveBeenCalledOnce();
    expect(_setManualReviewState.mock.calls[0]).toEqual([
      '189300', 'APPROVED', expect.any(Date), 'telegram_operator',
    ]);
    const msg = reply.mock.calls[0]![0];
    expect(msg).toContain('격리 해제');
    expect(msg).toContain('189300');
    expect(msg).toContain('APPROVED');
  });

  it('entry 없음 → ❌ 안내', async () => {
    _setManualReviewState.mockReturnValueOnce(false);
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await dataVerificationReview.execute({ args: ['approve', '999999'], reply });
    const msg = reply.mock.calls[0]![0];
    expect(msg).toContain('queue 에 entry 없음');
  });
});

describe('/data_verification_review drop <code>', () => {
  it('정상 — setManualReviewState(DROPPED) + 🛑 영구 제외 메시지', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await dataVerificationReview.execute({ args: ['drop', '189300'], reply });

    expect(_setManualReviewState).toHaveBeenCalledOnce();
    expect(_setManualReviewState.mock.calls[0]).toEqual([
      '189300', 'DROPPED', expect.any(Date), 'telegram_operator',
    ]);
    const msg = reply.mock.calls[0]![0];
    expect(msg).toContain('영구 제외');
    expect(msg).toContain('DROPPED');
  });
});

describe('/data_verification_review — 입력 검증', () => {
  it('approve 인자만 있고 code 없음 → ❌ 형식 오류', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await dataVerificationReview.execute({ args: ['approve'], reply });
    expect(_setManualReviewState).not.toHaveBeenCalled();
    const msg = reply.mock.calls[0]![0];
    expect(msg).toContain('형식 오류');
  });

  it('잘못된 code 형식 (6자리 아님) → ❌ 형식 오류', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await dataVerificationReview.execute({ args: ['approve', 'ABC'], reply });
    expect(_setManualReviewState).not.toHaveBeenCalled();
    const msg = reply.mock.calls[0]![0];
    expect(msg).toContain('형식 오류');
  });

  it('알 수 없는 sub-command → ❌ 사용법 안내', async () => {
    const reply = vi.fn<(message: string) => Promise<void>>(async () => undefined);
    await dataVerificationReview.execute({ args: ['unknown'], reply });
    const msg = reply.mock.calls[0]![0];
    expect(msg).toContain('알 수 없는 인자');
  });
});

describe('TelegramCommand 메타데이터 + alias', () => {
  it('name + 2 aliases (/dvr, /verification_queue) 등록', () => {
    expect(dataVerificationReview.name).toBe('/data_verification_review');
    expect(dataVerificationReview.aliases).toContain('/dvr');
    expect(dataVerificationReview.aliases).toContain('/verification_queue');
  });

  it('category=SYS, riskLevel=1, visibility=ADMIN', () => {
    expect(dataVerificationReview.category).toBe('SYS');
    expect(dataVerificationReview.riskLevel).toBe(1);
    expect(dataVerificationReview.visibility).toBe('ADMIN');
    expect(dataVerificationReview.description).toBeTruthy();
    expect(dataVerificationReview.usage).toContain('approve');
  });
});

describe('formatVerificationReviewMessage SSOT', () => {
  it('빈 입력 → 사용법 포함 placeholder', () => {
    const msg = formatVerificationReviewMessage([]);
    expect(msg).toContain('검토 대기 종목 없음');
    expect(msg).toContain('approve');
  });

  it('1건 입력 → stockName/code/연속실패/사유/시각', () => {
    const msg = formatVerificationReviewMessage([{
      stockCode: '005930', stockName: '삼성전자',
      consecutiveFailures: 3,
      firstFailedAt: '2026-04-28T16:30:00Z',
      lastFailedAt: '2026-04-30T16:30:00Z',
      lastFailureReason: 'STALE_BASE',
      nextRetryAt: '2026-05-01T16:30:00Z',
      manualReviewState: 'QUEUED',
    }]);
    expect(msg).toContain('1건 검토 대기');
    expect(msg).toContain('삼성전자 (005930)');
    expect(msg).toContain('연속 3회');
    expect(msg).toContain('STALE_BASE');
  });
});
