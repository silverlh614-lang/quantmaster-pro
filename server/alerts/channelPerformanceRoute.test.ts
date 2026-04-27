/**
 * @responsibility 긴급패치(2026-04-26) channelPerformance 카테고리 미스라우팅 회귀 테스트
 *
 * 사용자 보고: ADR-0037 §1 시멘틱 매핑(SYSTEM = 메타 학습·복기) 위반 — 일일/주간 거래
 * 성과 리포트가 INFO(REGIME 매크로 사령탑)로 발송되어 매크로 채널에 자기 거래 성과가
 * 끼어 보이던 문제. 본 테스트는 source 정적 검사로 회귀를 영구 차단한다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = process.cwd();

function readSource(rel: string): string {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

describe('channelPerformance — JOURNAL(SYSTEM) 카테고리 라우팅 (긴급패치 2026-04-26)', () => {
  const src = readSource('server/alerts/channelPipeline.ts');

  it('channelPerformance 함수 정의가 존재한다', () => {
    expect(src).toMatch(/export\s+async\s+function\s+channelPerformance\s*\(/);
  });

  it('ChannelSemantic import 가 추가되어 있다', () => {
    expect(src).toMatch(/import\s*\{[^}]*ChannelSemantic[^}]*\}\s*from\s*['"]\.\/alertCategories\.js['"]/);
  });

  it('channelPerformance 함수 본문이 dispatchAlert(ChannelSemantic.JOURNAL, ...) 호출', () => {
    // channelPerformance 함수 본문만 추출 (다른 함수에 영향 없도록).
    const m = src.match(/export\s+async\s+function\s+channelPerformance\s*\(([\s\S]+?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toMatch(/dispatchAlert\s*\(\s*ChannelSemantic\.JOURNAL\s*,/);
  });

  it('channelPerformance 본문에 AlertCategory.INFO 사용 없음 (회귀 방지)', () => {
    const m = src.match(/export\s+async\s+function\s+channelPerformance\s*\(([\s\S]+?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).not.toMatch(/dispatchAlert\s*\(\s*AlertCategory\.INFO\s*,/);
  });

  it('ADR-0037 §1: ChannelSemantic.JOURNAL = AlertCategory.SYSTEM (시멘틱 매핑 SSOT)', async () => {
    const { ChannelSemantic, AlertCategory } = await import('./alertCategories.js');
    expect(ChannelSemantic.JOURNAL).toBe(AlertCategory.SYSTEM);
  });
});
