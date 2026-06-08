/**
 * @responsibility Gemini 리포트 신뢰도 태그 제거 회귀 테스트 (장마감 다이제스트 깨짐 수정)
 *
 * 페르소나는 모든 주장에 [REALTIME]/[CALCULATED] 등 신뢰도 태그를 붙인다. 진단/쿼리
 * 응답엔 유지하되, 사용자 대면 리포트/다이제스트(callGemini 경로)에선 제거해 가독성을
 * 확보한다. stripReliabilityTags() 가 태그만 제거하고 본문·레짐 태그([CRISIS])는
 * 보존하며 이중 공백·구두점 앞 공백을 정리함을 보장한다.
 */

import { describe, it, expect } from 'vitest';
import { stripReliabilityTags } from './geminiClient.js';

describe('stripReliabilityTags', () => {
  it('5종 신뢰도 태그를 모두 제거한다', () => {
    const input =
      'KOSPI [REALTIME] -8.29% 급락과 [CALCULATED] 손실 4건, AI [ESTIMATED] 추정, ' +
      '[INFERRED] 간접추론, [MANUAL] 확인 필요.';
    const out = stripReliabilityTags(input);
    for (const tag of ['[REALTIME]', '[CALCULATED]', '[ESTIMATED]', '[INFERRED]', '[MANUAL]']) {
      expect(out).not.toContain(tag);
    }
  });

  it('레짐 태그 [CRISIS] 등 비신뢰도 태그는 보존한다', () => {
    const input = '시장은 [CRISIS] 레짐에 준하는 [REALTIME] 리스크 회피를 보였다.';
    const out = stripReliabilityTags(input);
    expect(out).toContain('[CRISIS]');
    expect(out).not.toContain('[REALTIME]');
  });

  it('태그 제거 후 이중 공백·구두점 앞 공백을 정리한다', () => {
    const input = '손실 [CALCULATED] 실현 [REALTIME] .';
    const out = stripReliabilityTags(input);
    expect(out).not.toMatch(/ {2,}/);
    expect(out).not.toMatch(/\s\./); // 구두점 앞 공백 없음
    expect(out).toContain('손실 실현.');
  });

  it('태그 없는 본문은 그대로 보존한다', () => {
    const input = '오늘 한국 주식시장은 급락했고 신규 진입 신호는 없었습니다.';
    expect(stripReliabilityTags(input)).toBe(input);
  });

  it('빈 입력은 그대로 반환한다', () => {
    expect(stripReliabilityTags('')).toBe('');
  });
});
