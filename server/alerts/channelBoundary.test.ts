/**
 * @responsibility PR-X1 ADR-0032 채널 ID env 직접 접근 차단 boundary 회귀 테스트
 *
 * scripts/check_channel_boundary.js 의 findViolations 로직을 픽스처 문자열로 검증.
 * 실제 스크립트 실행 검증은 npm run validate:channelBoundary 가 담당.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/check_channel_boundary.js');

describe('check_channel_boundary script — 통합 실행', () => {
  it('현재 코드베이스에서 SSOT 외 직접 접근 0건 (PR-X1 후 정상 상태)', () => {
    const output = execSync(`node ${SCRIPT_PATH}`, { encoding: 'utf-8' });
    expect(output).toContain('[ChannelBoundary] OK');
    expect(output).toContain('SSOT 외 직접 접근 없음');
  });
});

describe('check_channel_boundary 패턴 검증', () => {
  // findViolations 는 module 내부라 직접 import 불가 — 픽스처 분기 검증을 위해
  // 동일 시그니처 매칭 로직을 본 테스트에서 재현. 스크립트 변경 시 본 테스트도 동기화.

  function findViolationsInline(src: string): string[] {
    const SIGNATURES = [
      'TELEGRAM_TRADE_CHANNEL_ID',
      'TELEGRAM_ANALYSIS_CHANNEL_ID',
      'TELEGRAM_INFO_CHANNEL_ID',
      'TELEGRAM_SYSTEM_CHANNEL_ID',
      'TELEGRAM_PICK_CHANNEL_ID',
    ];
    let stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
    stripped = stripped.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const found: string[] = [];
    for (const sig of SIGNATURES) {
      const re1 = new RegExp(`process\\.env\\.${sig}\\b`);
      const re2 = new RegExp(`process\\.env\\[['"]${sig}['"]\\]`);
      if (re1.test(stripped) || re2.test(stripped)) found.push(sig);
    }
    return found;
  }

  it('process.env.TELEGRAM_TRADE_CHANNEL_ID 직접 접근 탐지', () => {
    const code = `const id = process.env.TELEGRAM_TRADE_CHANNEL_ID;`;
    expect(findViolationsInline(code)).toContain('TELEGRAM_TRADE_CHANNEL_ID');
  });

  it('process.env["TELEGRAM_INFO_CHANNEL_ID"] 대괄호 접근 탐지', () => {
    const code = `const id = process.env["TELEGRAM_INFO_CHANNEL_ID"];`;
    expect(findViolationsInline(code)).toContain('TELEGRAM_INFO_CHANNEL_ID');
  });

  it("process.env['TELEGRAM_SYSTEM_CHANNEL_ID'] 작은따옴표 접근 탐지", () => {
    const code = `const id = process.env['TELEGRAM_SYSTEM_CHANNEL_ID'];`;
    expect(findViolationsInline(code)).toContain('TELEGRAM_SYSTEM_CHANNEL_ID');
  });

  it('주석 안의 변수명 등장은 위반 아님', () => {
    const code = `// 참고: TELEGRAM_TRADE_CHANNEL_ID 는 alertRouter 가 관리\nconst x = 1;`;
    expect(findViolationsInline(code)).toEqual([]);
  });

  it('블록 주석 안의 코드는 위반 아님', () => {
    const code = `/* const id = process.env.TELEGRAM_PICK_CHANNEL_ID; */ const x = 1;`;
    expect(findViolationsInline(code)).toEqual([]);
  });

  it('단순 변수명 등장은 위반 아님 (process.env 우측만 검사)', () => {
    const code = `const TELEGRAM_TRADE_CHANNEL_ID = 'abc'; export { TELEGRAM_TRADE_CHANNEL_ID };`;
    expect(findViolationsInline(code)).toEqual([]);
  });

  it('TELEGRAM_CHAT_ID 는 검사 대상 아님 — 개인 회선은 PR-X2 scope', () => {
    const code = `const id = process.env.TELEGRAM_CHAT_ID;`;
    expect(findViolationsInline(code)).toEqual([]);
  });

  it('알림 카테고리 5종 모두 SIGNATURES 에 포함', () => {
    const allSigs = ['TRADE', 'ANALYSIS', 'INFO', 'SYSTEM', 'PICK'];
    for (const tag of allSigs) {
      const code = `const id = process.env.TELEGRAM_${tag}_CHANNEL_ID;`;
      expect(findViolationsInline(code).length).toBeGreaterThan(0);
    }
  });

  it('한 파일에 여러 위반 시 모두 반환', () => {
    const code = `
      const a = process.env.TELEGRAM_TRADE_CHANNEL_ID;
      const b = process.env.TELEGRAM_INFO_CHANNEL_ID;
    `;
    const found = findViolationsInline(code);
    expect(found).toContain('TELEGRAM_TRADE_CHANNEL_ID');
    expect(found).toContain('TELEGRAM_INFO_CHANNEL_ID');
  });
});
