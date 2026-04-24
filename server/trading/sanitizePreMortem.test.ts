/**
 * @responsibility Gemini Pre-Mortem 응답 서문 제거·번호항목 추출·상한 검증 회귀 테스트
 *
 * ADR-0005 에 정의된 sanitizePreMortemResponse 의 4가지 경계:
 * 서문 제거, 번호 폴백, 120자 말줄임, 600자 전체 상한.
 */

import { describe, it, expect } from 'vitest';
import { sanitizePreMortemResponse } from './entryEngine.js';

describe('sanitizePreMortemResponse', () => {
  it('서문이 있어도 번호 항목 3개만 추출', () => {
    const raw = [
      'QuantMaster 시스템 아키텍트로서, 현대제철(004020) 매수 포지션이 -10% 손실로 마감된 상황에 대한',
      '가장 가능성 높은 원인 3가지를 분석한다. 이는 시스템의 Gate 0, Gate 1, Gate 2 단계를 점검한다.',
      '',
      '1. R5_CAUTION 레짐 전환 → 지수 낙폭 확대로 손절선 조기 도달',
      '2. 철강 섹터 RS 하락 → 업종 공매도 증가로 하방 압력',
      '3. VKOSPI 28 돌파 → 구조적 변동성 확대로 하드스톱 체결',
      '',
      '이상으로 분석한다.',
    ].join('\n');
    const out = sanitizePreMortemResponse(raw);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^1\. R5_CAUTION/);
    expect(lines[1]).toMatch(/^2\. 철강/);
    expect(lines[2]).toMatch(/^3\. VKOSPI/);
    expect(out).not.toMatch(/아키텍트|분석한다/);
  });

  it('번호 없이 하이픈/불릿만 있어도 라인 추출', () => {
    const raw = [
      '- MA60 이탈 → 중기 추세 붕괴',
      '- 외인 순매도 3일 연속 → 수급 공백',
      '- 실적 가이던스 하향 → 목표가 재평가',
    ].join('\n');
    const out = sanitizePreMortemResponse(raw);
    const lines = out.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^1\. MA60/);
  });

  it('번호가 전혀 없으면 문장 단위 폴백 + 메타 문장 제거', () => {
    const raw =
      'QuantMaster 시스템 아키텍트로서 분석한다. ' +
      '레짐이 R5 로 전환되며 손절선이 조기에 도달했다. ' +
      '거래량이 20일 평균 40% 수준으로 감소하며 수급 공백이 노출됐다. ' +
      'VKOSPI 급등으로 포지션 전반에 구조적 공포가 확산됐다.';
    const out = sanitizePreMortemResponse(raw);
    expect(out).not.toMatch(/아키텍트/);
    // 문장 기반이라도 3줄 이하는 보장.
    const lines = out.split('\n');
    expect(lines.length).toBeLessThanOrEqual(3);
    expect(lines[0]).toMatch(/^1\. /);
  });

  it('각 라인 120자 초과 시 말줄임', () => {
    const longLine = '1. ' + '가'.repeat(200) + ' → 손실';
    const out = sanitizePreMortemResponse(longLine);
    expect(out.split('\n')[0].length).toBeLessThanOrEqual(120 + 4);
    expect(out.endsWith('...')).toBe(true);
  });

  it('전체 600자 상한', () => {
    const long = Array.from({ length: 5 }).map((_, i) => `${i + 1}. ${'가'.repeat(200)}`).join('\n');
    const out = sanitizePreMortemResponse(long);
    expect(out.length).toBeLessThanOrEqual(600);
  });

  it('빈 입력은 빈 문자열 반환', () => {
    expect(sanitizePreMortemResponse('')).toBe('');
    expect(sanitizePreMortemResponse('   ')).toBe('');
  });
});
