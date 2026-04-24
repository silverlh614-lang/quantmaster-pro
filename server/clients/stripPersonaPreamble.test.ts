/**
 * @responsibility PR-20 Gemini 응답 페르소나 서문 제거 회귀 테스트
 *
 * Gemini 가 응답 상단에 "QuantMaster 시스템 아키텍트로서…" 같은 메타
 * 자기소개를 자주 붙인다. stripPersonaPreamble() 이 이를 제거하되
 * 정보성 본문·JSON·리스트 구조는 건드리지 않음을 보장한다.
 */

import { describe, it, expect } from 'vitest';
import { stripPersonaPreamble } from './geminiClient.js';

describe('stripPersonaPreamble', () => {
  it('페르소나 자기소개 1문단 + 구분선 + 본문 → 서문만 제거', () => {
    const input = [
      'QuantMaster 시스템 아키텍트로서 금주 한국 주식 시장에 대한 퀀트 인사이트를 제시한다.',
      '',
      '---',
      '',
      '① [MHS: 75] — 시장 건강도는 양호하나, 중립 레짐에서 추세적 상승 동력은 제한적이다.',
      '② [외국인 5일 순매수] ...',
    ].join('\n');
    const out = stripPersonaPreamble(input);
    expect(out).toMatch(/^① \[MHS: 75\]/);
    expect(out).not.toMatch(/QuantMaster/);
    expect(out).not.toMatch(/아키텍트로서/);
  });

  it('메타 서문 없이 곧장 번호 리스트면 원문 보존', () => {
    const input = [
      '① [핵심 지표] — 오늘 MHS 75.',
      '② [둘째 지표] — VKOSPI 18.',
    ].join('\n');
    const out = stripPersonaPreamble(input);
    expect(out).toBe(input);
  });

  it('JSON 응답은 서문 제거 후에도 온전히 보존', () => {
    const input = [
      'QuantMaster 시스템 아키텍트로서 오늘의 반성을 JSON 으로 제시한다.',
      '',
      '{',
      '  "dailyVerdict": "MIXED",',
      '  "keyLessons": []',
      '}',
    ].join('\n');
    const out = stripPersonaPreamble(input);
    expect(out.startsWith('{')).toBe(true);
    expect(out).toContain('"dailyVerdict": "MIXED"');
    expect(out).not.toMatch(/QuantMaster/);
  });

  it('JSON 이 서문 없이 바로 나오면 unchanged', () => {
    const input = '{"ok": true, "count": 5}';
    expect(stripPersonaPreamble(input)).toBe(input);
  });

  it('이모지·볼드 본문이 먼저 오면 원문 보존', () => {
    const input = '📊 <b>핵심 수치</b>\n- MHS 75';
    const out = stripPersonaPreamble(input);
    expect(out).toBe(input);
  });

  it('다중 메타 문장 + 빈 줄 혼재 → 연속 스트립', () => {
    const input = [
      'QuantMaster 시스템 아키텍트로서 다음 내용을 분석한다.',
      '',
      '오늘의 시장을 분석한다.',
      '',
      '1. 시장 방향 중립',
      '2. 외인 순매도 지속',
    ].join('\n');
    const out = stripPersonaPreamble(input);
    expect(out.startsWith('1.')).toBe(true);
    expect(out).not.toMatch(/QuantMaster|아키텍트|분석한다/);
  });

  it('빈 입력은 빈 문자열', () => {
    expect(stripPersonaPreamble('')).toBe('');
  });

  it('모두 제거 시 본문 비면 원문 유지 (안전장치)', () => {
    // 서문만 있는 극단 케이스 — 스트립 후 빈 문자열이 되면 오히려 원문 반환.
    const input = 'QuantMaster 시스템 아키텍트로서 오늘 분석한다.';
    const out = stripPersonaPreamble(input);
    expect(out.length).toBeGreaterThan(0);
  });
});
