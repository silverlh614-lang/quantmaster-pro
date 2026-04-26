/**
 * @responsibility PR-X2 ADR-0038 채널 발송 메시지 잔고 키워드 누출 차단 회귀 테스트
 *
 * scripts/check_sensitive_alerts.js 의 findSensitiveLeaks + isExcludedLineContext
 * 휴리스틱을 픽스처 문자열로 검증. 실제 스크립트 실행 검증은
 * npm run validate:sensitiveAlerts 가 담당.
 *
 * 또한 sendPrivateAlert export 존재 + sendTelegramBroadcast deprecated 표시 검증.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { readFileSync } from 'fs';

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/check_sensitive_alerts.js');

describe('check_sensitive_alerts script — 통합 실행', () => {
  it('현재 코드베이스에서 잔고 키워드 누출 0건 (PR-X2 후 정상 상태)', () => {
    const output = execSync(`node ${SCRIPT_PATH}`, { encoding: 'utf-8' });
    expect(output).toContain('[SensitiveAlerts] OK');
    expect(output).toContain('잔고 키워드 누출 없음');
  });
});

describe('sendPrivateAlert / sendTelegramBroadcast 시그니처', () => {
  const clientSrc = readFileSync(
    resolve(process.cwd(), 'server/alerts/telegramClient.ts'),
    'utf-8',
  );

  it('sendPrivateAlert export 존재 — 개인 DM 전용 SSOT', () => {
    expect(clientSrc).toMatch(/export\s+async\s+function\s+sendPrivateAlert\s*\(/);
  });

  it('sendPrivateAlert JSDoc 에 "private DM only" / "채널 발송하지 않음" 명시', () => {
    expect(clientSrc).toMatch(/(개인 채팅\(DM\) 전용|TELEGRAM_CHAT_ID 한 곳)/);
    expect(clientSrc).toMatch(/(절대 발송되지 않|never reaches channel)/);
  });

  it('sendTelegramBroadcast 에 @deprecated JSDoc 표시', () => {
    expect(clientSrc).toMatch(/@deprecated/);
  });

  it('sendTelegramBroadcast deprecated 메시지가 마이그레이션 경로 안내', () => {
    expect(clientSrc).toMatch(/sendPrivateAlert/);
    expect(clientSrc).toMatch(/dispatchAlert/);
  });
});

describe('check_sensitive_alerts 패턴 검증', () => {
  // findSensitiveLeaks + isExcludedLineContext 본체와 동기화 — 스크립트 변경 시 본 테스트도 갱신.

  function stripComments(src: string): string {
    let stripped = src.replace(/\/\*[\s\S]*?\*\//g, '');
    stripped = stripped.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    return stripped;
  }

  function isExcludedLineContext(rawLines: string[], idx: number): boolean {
    const line = rawLines[idx] ?? '';
    if (/\bconsole\.(log|warn|error|debug|info)\s*\(/.test(line)) return true;
    if (/\bthrow\s+new\s+(Error|TypeError|RangeError|RuntimeError)\s*\(/.test(line)) return true;
    if (/\bsafe-channel-keyword\b/.test(line)) return true;
    if (idx > 0 && /\bsafe-channel-keyword\b/.test(rawLines[idx - 1] ?? '')) return true;
    return false;
  }

  function findLeaks(src: string): Array<{ line: number; keyword: string }> {
    const SENSITIVE = ['총자산', '총 자산', '주문가능현금', '잔여 현금', '잔여현금', '보유자산', '보유 자산', '평가손익'];
    const rawLines = src.split('\n');
    const lines = stripComments(src).split('\n');
    const found: Array<{ line: number; keyword: string }> = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!/["'`]/.test(line)) continue;
      if (isExcludedLineContext(rawLines, i)) continue;
      for (const kw of SENSITIVE) {
        const re = new RegExp(`["'\`][^"'\`\n]*${kw}[^"'\`\n]*["'\`]`);
        if (re.test(line)) found.push({ line: i + 1, keyword: kw });
      }
    }
    return found;
  }

  it('template literal 안 "총자산" 키워드 탐지', () => {
    const code = 'await dispatchAlert(cat, `총자산: ${x}원`);';
    const leaks = findLeaks(code);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks[0].keyword).toBe('총자산');
  });

  it('double-quote 안 "주문가능현금" 키워드 탐지', () => {
    const code = 'const m = "주문가능현금: 3천만원"; await dispatchAlert(cat, m);';
    const leaks = findLeaks(code);
    expect(leaks[0].keyword).toBe('주문가능현금');
  });

  it("single-quote 안 '보유자산' 키워드 탐지", () => {
    const code = "const m = '보유자산 5억';";
    const leaks = findLeaks(code);
    expect(leaks[0].keyword).toBe('보유자산');
  });

  it('console.log 안 키워드는 제외 (Railway 로그)', () => {
    const code = 'console.log(`총자산: ${x}원`);';
    expect(findLeaks(code)).toEqual([]);
  });

  it('console.warn 안 키워드도 제외', () => {
    const code = 'console.warn(`주문가능현금: ${x}`);';
    expect(findLeaks(code)).toEqual([]);
  });

  it('throw new Error 안 키워드 제외 (예외 메시지)', () => {
    const code = 'throw new Error(`총자산 음수: ${x}`);';
    expect(findLeaks(code)).toEqual([]);
  });

  it('인라인 // safe-channel-keyword opt-out 주석 동작', () => {
    const code = 'const m = `총자산 표기는 의도된 것 — 외부 발송 아님`; // safe-channel-keyword';
    expect(findLeaks(code)).toEqual([]);
  });

  it('직전 라인 // safe-channel-keyword 도 opt-out', () => {
    const code = '// safe-channel-keyword: 페르소나 분석 어휘\nconst m = `총자산회전율 분석`;';
    expect(findLeaks(code)).toEqual([]);
  });

  it('식별자(변수명) 등장은 위반 아님 — 따옴표 밖', () => {
    const code = 'const 총자산 = balance.totalAssets; return 총자산;';
    expect(findLeaks(code)).toEqual([]);
  });

  it('주석 안 키워드 등장은 위반 아님', () => {
    const code = '// 총자산 계산 후 dispatchAlert 호출\nconst x = 1;';
    expect(findLeaks(code)).toEqual([]);
  });

  it('한 라인 다중 키워드 누적', () => {
    const code = 'const m = `총자산: ${a}원 / 주문가능현금: ${b}원`;';
    const leaks = findLeaks(code);
    expect(leaks.length).toBe(2);
    const kws = leaks.map((l) => l.keyword).sort();
    expect(kws).toContain('총자산');
    expect(kws).toContain('주문가능현금');
  });

  it('SENSITIVE 키워드 8종 모두 탐지', () => {
    const allKws = ['총자산', '총 자산', '주문가능현금', '잔여 현금', '잔여현금', '보유자산', '보유 자산', '평가손익'];
    for (const kw of allKws) {
      const code = `const m = \`${kw} 표시\`;`;
      const leaks = findLeaks(code);
      expect(leaks.length).toBeGreaterThan(0);
    }
  });
});
