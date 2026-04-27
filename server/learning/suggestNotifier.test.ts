import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// telegramClient.sendTelegramAlert 를 모킹하여 실제 네트워크 호출 차단.
vi.mock('../alerts/telegramClient.js', () => ({
  sendTelegramAlert: vi.fn().mockResolvedValue(undefined),
}));

import { sendTelegramAlert } from '../alerts/telegramClient.js';
import {
  sendSuggestAlert,
  isSuggestEnabled,
  escapeSuggestHtml,
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

  // ── HTML escape (2026-04-27 사용자 보고: regimeCoverage suggest HTML 파싱 실패) ──

  describe('escapeSuggestHtml', () => {
    it('& 를 &amp; 로 치환 (entity 미완성 차단)', () => {
      expect(escapeSuggestHtml('샘플 부족 & dry')).toBe('샘플 부족 &amp; dry');
    });

    it('< 를 &lt; 로 치환 (잘못된 태그 차단)', () => {
      expect(escapeSuggestHtml('current/target<50%')).toBe('current/target&lt;50%');
    });

    it('> 를 &gt; 로 치환 (대칭)', () => {
      expect(escapeSuggestHtml('a>b')).toBe('a&gt;b');
    });

    it('& 를 가장 먼저 치환 (이미 escape 된 결과가 다시 치환되지 않도록)', () => {
      expect(escapeSuggestHtml('a & <b>')).toBe('a &amp; &lt;b&gt;');
    });

    it('치환 대상이 없으면 그대로 반환', () => {
      expect(escapeSuggestHtml('정상 텍스트 50%')).toBe('정상 텍스트 50%');
    });

    it('빈 문자열 안전', () => {
      expect(escapeSuggestHtml('')).toBe('');
    });
  });

  it('regimeCoverage 사용자 보고 시나리오: title "& dry" + threshold "<50% & ..." 모두 escape', async () => {
    // 2026-04-27 Railway 로그 재현 — regimeBalancedSampler 가 보낸 실제 페이로드.
    await sendSuggestAlert(mkPayload({
      moduleKey: 'regimeCoverage',
      signature: 'regime-R5_CAUTION-2026-04-27',
      title: '레짐 R5_CAUTION 샘플 부족 & 14일 dry',
      threshold: 'current/target<50% & 14일 dry',
    }));
    expect(mockSendAlert).toHaveBeenCalledTimes(1);
    const [message] = mockSendAlert.mock.calls[0];
    // 본문에 raw '<' '&' 가 그대로 남으면 파싱 실패 → escape 통과 확인.
    expect(message).not.toContain('current/target<50%');
    expect(message).not.toContain('샘플 부족 & 14일');
    expect(message).toContain('current/target&lt;50%');
    expect(message).toContain('샘플 부족 &amp; 14일');
    // <b>...</b> 헤더는 빌더가 직접 구성하므로 그대로 보존.
    expect(message).toContain('<b>학습 모듈 Suggest — regimeCoverage</b>');
  });

  it('moduleKey 자체에는 특수문자가 없지만 escape 통과 (회귀 가드)', async () => {
    await sendSuggestAlert(mkPayload({ moduleKey: 'kellySurface' }));
    const [message] = mockSendAlert.mock.calls[0];
    // kellySurface 가 잘못 escape 되면 텍스트가 깨짐.
    expect(message).toContain('<b>학습 모듈 Suggest — kellySurface</b>');
  });

  it('rationale/currentValue/suggestedValue 도 escape 통과', async () => {
    await sendSuggestAlert(mkPayload({
      rationale: '샘플 45 & ratio<0.84',
      currentValue: 'Gate ≥ 7 & RRR > 2',
      suggestedValue: 'Gate ≥ 6 & RRR > 1.8',
    }));
    const [message] = mockSendAlert.mock.calls[0];
    expect(message).not.toContain('& ratio<');
    expect(message).toContain('&amp; ratio&lt;');
    expect(message).not.toContain('Gate ≥ 7 & RRR > 2');
    expect(message).toContain('Gate ≥ 7 &amp; RRR &gt; 2');
  });
});
