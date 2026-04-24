import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// telegramClient.sendTelegramAlert 를 모킹하여 실제 네트워크 호출 차단.
vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
}));

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import {
  sendSuggestAlert,
  isSuggestEnabled,
  __resetSuggestDedupeForTests,
  type SuggestPayload,
} from './suggestNotifier.js';

const mockSendAlert = sendTelegramAlert as unknown as ReturnType<typeof vi.fn>;

function mkPayload(overrides: Partial<SuggestPayload> = {}): SuggestPayload {
  return {
    moduleKey: 'counterfactual',
    signature: 'counterfactual-2026-04-24',
    title: '탈락 후보 Gate 과잉 의심',
    rationale: '샘플 45건, 통과 평균 6.2% / 탈락 평균 5.2% (ratio 0.84)',
    currentValue: 'Gate Score ≥ 7',
    suggestedValue: 'Gate Score ≥ 6',
    threshold: '샘플≥30 & ratio≥0.8',
    ...overrides,
  };
}

describe('suggestNotifier', () => {
  const originalEnv = process.env.LEARNING_SUGGEST_ENABLED;

  beforeEach(() => {
    __resetSuggestDedupeForTests();
    mockSendAlert.mockClear();
    delete process.env.LEARNING_SUGGEST_ENABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.LEARNING_SUGGEST_ENABLED;
    else process.env.LEARNING_SUGGEST_ENABLED = originalEnv;
  });

  it('isSuggestEnabled: env 미설정 시 기본 true', () => {
    expect(isSuggestEnabled()).toBe(true);
  });

  it('isSuggestEnabled: LEARNING_SUGGEST_ENABLED=false 시 false', () => {
    process.env.LEARNING_SUGGEST_ENABLED = 'false';
    expect(isSuggestEnabled()).toBe(false);
  });

  it('LEARNING_SUGGEST_ENABLED=false → sendSuggestAlert 는 즉시 false, Telegram 미호출', async () => {
    process.env.LEARNING_SUGGEST_ENABLED = 'false';
    const ok = await sendSuggestAlert(mkPayload());
    expect(ok).toBe(false);
    expect(mockSendAlert).not.toHaveBeenCalled();
  });

  it('최초 호출은 true, Telegram 1회 송출', async () => {
    const ok = await sendSuggestAlert(mkPayload());
    expect(ok).toBe(true);
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
    // message 본문에 moduleKey 와 title 이 포함되어야 함.
    const [message] = mockSendAlert.mock.calls[0];
    expect(message).toContain('counterfactual');
    expect(message).toContain('Gate 과잉');
  });

  it('같은 signature 연속 2회 → 두 번째는 false, Telegram 추가 호출 없음', async () => {
    const payload = mkPayload();
    const first  = await sendSuggestAlert(payload);
    const second = await sendSuggestAlert(payload);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
  });

  it('다른 signature 면 재송출 허용', async () => {
    await sendSuggestAlert(mkPayload({ signature: 'counterfactual-2026-04-23' }));
    await sendSuggestAlert(mkPayload({ signature: 'counterfactual-2026-04-24' }));
    expect(mockSendAlert).toHaveBeenCalledTimes(2);
  });

  it('24h 경과 후 같은 signature 재송출 허용 (fake timers)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00Z'));
    const payload = mkPayload();
    const first = await sendSuggestAlert(payload);
    expect(first).toBe(true);

    // 25h 경과 — dedupe 창 초과.
    vi.setSystemTime(new Date('2026-04-25T01:00:00Z'));
    const second = await sendSuggestAlert(payload);
    expect(second).toBe(true);
    expect(mockSendAlert).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
