// @responsibility Patch Telegram HTML Sanitizer & Diagnostic Invariant Routing Guard 회귀
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  ALLOWED_TELEGRAM_HTML_TAGS,
  TELEGRAM_MAX_MESSAGE_LEN,
  sanitizeTelegramHtml,
  validateTelegramHtml,
  classifyTelegramRouting,
  isTelegramInvariantRoutingDisabled,
  splitHtmlSafeChunks,
  shouldLogHtmlFailure,
  htmlFailureSignature,
  __resetTelegramHtmlSanitizerForTests,
} from './telegramHtmlSanitizer.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  __resetTelegramHtmlSanitizerForTests();
  delete process.env.TELEGRAM_INVARIANT_ROUTING_DISABLED;
});
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

// ── A. SSOT 상수 ──────────────────────────────────────────────────────────────
describe('A. ALLOWED_TELEGRAM_HTML_TAGS SSOT', () => {
  it('Telegram 공식 핵심 태그 b/i/code/pre/a 포함', () => {
    for (const t of ['b', 'i', 'code', 'pre', 'a', 'strong', 'em', 'u', 's']) {
      expect(ALLOWED_TELEGRAM_HTML_TAGS.has(t)).toBe(true);
    }
  });
  it('비허용 태그 script/div/img 불포함', () => {
    for (const t of ['script', 'div', 'img', 'iframe', 'style']) {
      expect(ALLOWED_TELEGRAM_HTML_TAGS.has(t)).toBe(false);
    }
  });
  it('TELEGRAM_MAX_MESSAGE_LEN === 4096', () => {
    expect(TELEGRAM_MAX_MESSAGE_LEN).toBe(4096);
  });
});

// ── B. sanitizeTelegramHtml ──────────────────────────────────────────────────
describe('B. sanitizeTelegramHtml — 허용 태그 통과 / 비허용·stray 이스케이프', () => {
  it('허용 태그 b/i/code/pre 는 그대로 통과', () => {
    const src = '<b>굵게</b> <i>기울임</i> <code>코드</code> <pre>블록</pre>';
    expect(sanitizeTelegramHtml(src)).toBe(src);
  });
  it('<a href="https://..."> 는 통과', () => {
    const src = '<a href="https://example.com">링크</a>';
    expect(sanitizeTelegramHtml(src)).toBe(src);
  });
  it('<a href="javascript:..."> 비안전 스킴은 이스케이프', () => {
    const out = sanitizeTelegramHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).toContain('&lt;a href');
    expect(out).not.toContain('<a href="javascript');
  });
  it('비허용 태그 <script> 는 < 이스케이프', () => {
    const out = sanitizeTelegramHtml('<script>alert(1)</script>');
    expect(out).toBe('&lt;script>alert(1)&lt;/script>');
  });
  it('stray < (태그 아님) 는 &lt; 로 이스케이프', () => {
    expect(sanitizeTelegramHtml('price < 1000 and a < b')).toBe('price &lt; 1000 and a &lt; b');
  });
  it('미닫힘 허용 태그는 끝에서 자동 닫기', () => {
    expect(sanitizeTelegramHtml('<b>굵게 시작만')).toBe('<b>굵게 시작만</b>');
  });
  it('미닫힘 중첩 태그 역순 자동 닫기', () => {
    expect(sanitizeTelegramHtml('<b><i>둘 다 미닫힘')).toBe('<b><i>둘 다 미닫힘</i></b>');
  });
  it('이미 escapeHtml 된 콘텐츠를 이중 이스케이프하지 않음', () => {
    // 호출자가 escapeHtml 한 값: &amp; &lt; &gt; — 텍스트 콘텐츠는 건드리지 않음
    const src = '<b>A&amp;B</b> &lt;tag&gt;';
    expect(sanitizeTelegramHtml(src)).toBe(src);
  });
  it('속성 없는 서식 태그에 속성이 붙으면 이스케이프', () => {
    const out = sanitizeTelegramHtml('<b style="color:red">x</b>');
    expect(out).toContain('&lt;b style');
  });
  it('빈 문자열 / 태그 없는 텍스트는 그대로', () => {
    expect(sanitizeTelegramHtml('')).toBe('');
    expect(sanitizeTelegramHtml('순수 텍스트입니다')).toBe('순수 텍스트입니다');
  });
  it('진단 문자열의 stray < (executionImpact=NONE < threshold) 안전 처리', () => {
    const out = sanitizeTelegramHtml('executionImpact=NONE < threshold');
    expect(out).toBe('executionImpact=NONE &lt; threshold');
  });
});

// ── C. validateTelegramHtml ──────────────────────────────────────────────────
describe('C. validateTelegramHtml — 진단', () => {
  it('정상 HTML 은 valid=true, issues 빈 배열', () => {
    const r = validateTelegramHtml('<b>정상</b> <code>코드</code>');
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });
  it('비허용 태그 검출', () => {
    const r = validateTelegramHtml('<div>나쁨</div>');
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.includes('div'))).toBe(true);
  });
  it('미닫힘 태그 검출', () => {
    const r = validateTelegramHtml('<b>미닫힘');
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.includes('미닫힘'))).toBe(true);
  });
  it('짝 없는 닫는 태그 검출', () => {
    const r = validateTelegramHtml('닫기만 </b>');
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.includes('짝 없는'))).toBe(true);
  });
  it('stray < 검출', () => {
    const r = validateTelegramHtml('a < b 입니다');
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.includes('이스케이프되지 않은'))).toBe(true);
  });
});

// ── D. classifyTelegramRouting + ENV ────────────────────────────────────────
describe('D. invariant/debug 라우팅 가드', () => {
  it('[INVARIANT] 접두 → RAILWAY_LOG_ONLY', () => {
    expect(classifyTelegramRouting('[INVARIANT] executionImpact must be NONE')).toBe('RAILWAY_LOG_ONLY');
  });
  it('[DEBUG] / [TRACE] 접두 → RAILWAY_LOG_ONLY', () => {
    expect(classifyTelegramRouting('[DEBUG] scan trace dump')).toBe('RAILWAY_LOG_ONLY');
    expect(classifyTelegramRouting('  [TRACE] step 3')).toBe('RAILWAY_LOG_ONLY');
  });
  it('일반 알림 메시지 → TELEGRAM', () => {
    expect(classifyTelegramRouting('🚨 손절가 도달')).toBe('TELEGRAM');
    expect(classifyTelegramRouting('<b>매수 신호</b>')).toBe('TELEGRAM');
  });
  it('isTelegramInvariantRoutingDisabled — 정확 비교 (=== true)', () => {
    for (const v of ['1', 'TRUE', 'yes', 'True', '']) {
      process.env.TELEGRAM_INVARIANT_ROUTING_DISABLED = v;
      expect(isTelegramInvariantRoutingDisabled()).toBe(false);
    }
    process.env.TELEGRAM_INVARIANT_ROUTING_DISABLED = 'true';
    expect(isTelegramInvariantRoutingDisabled()).toBe(true);
  });
});

// ── E. splitHtmlSafeChunks ───────────────────────────────────────────────────
describe('E. splitHtmlSafeChunks — 태그 중간 미절단', () => {
  it('maxLen 이하는 단일 청크', () => {
    expect(splitHtmlSafeChunks('짧은 메시지', 4096)).toEqual(['짧은 메시지']);
  });
  it('태그 중간에서 자르지 않음 — 모든 청크가 균형 잡힌 < >', () => {
    // maxLen 경계 근처에 태그가 걸치도록 구성
    const body = 'x'.repeat(50);
    const text = `${body}<b>${'y'.repeat(50)}</b>${body}`;
    const chunks = splitHtmlSafeChunks(text, 60);
    for (const c of chunks) {
      // 청크 안에서 마지막 '<' 는 반드시 그 뒤에 '>' 가 있어야 함 (태그 중간 절단 0)
      const lastOpen = c.lastIndexOf('<');
      const lastClose = c.lastIndexOf('>');
      if (lastOpen !== -1) expect(lastClose).toBeGreaterThan(lastOpen);
    }
    expect(chunks.join('')).toBe(text);
  });
  it('개행 경계 선호', () => {
    const text = 'a'.repeat(40) + '\n' + 'b'.repeat(40);
    const chunks = splitHtmlSafeChunks(text, 60);
    expect(chunks[0].endsWith('\n')).toBe(true);
    expect(chunks.join('')).toBe(text);
  });
  it('분할 후 재결합 시 원본 보존 (손실 0)', () => {
    const text = '<b>' + 'z'.repeat(5000) + '</b>';
    const chunks = splitHtmlSafeChunks(text, 1000);
    expect(chunks.join('')).toBe(text);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
  });
});

// ── F. HTML 실패 로그 dedup/cooldown ─────────────────────────────────────────
describe('F. shouldLogHtmlFailure dedup/cooldown', () => {
  it('같은 시그니처는 cooldown 내 1회만 true', () => {
    const sig = 'parse-fail-sig';
    const t0 = 1_000_000;
    expect(shouldLogHtmlFailure(sig, t0)).toBe(true);
    expect(shouldLogHtmlFailure(sig, t0 + 1000)).toBe(false);
    expect(shouldLogHtmlFailure(sig, t0 + 60_000)).toBe(false);
  });
  it('cooldown 만료 후 다시 true', () => {
    const sig = 'parse-fail-sig-2';
    const t0 = 2_000_000;
    expect(shouldLogHtmlFailure(sig, t0)).toBe(true);
    expect(shouldLogHtmlFailure(sig, t0 + 5 * 60 * 1000 + 1)).toBe(true);
  });
  it('서로 다른 시그니처는 독립', () => {
    const t0 = 3_000_000;
    expect(shouldLogHtmlFailure('sig-A', t0)).toBe(true);
    expect(shouldLogHtmlFailure('sig-B', t0)).toBe(true);
  });
  it('htmlFailureSignature — 태그 제거 + 공백 정규화 + 60자', () => {
    const sig = htmlFailureSignature('<b>삼성전자</b>   가격\n조회');
    expect(sig).not.toContain('<');
    expect(sig).toBe('삼성전자 가격 조회');
    expect(htmlFailureSignature('x'.repeat(200)).length).toBe(60);
  });
});

// ── G. telegramClient.ts wiring 정적 가드 ────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('G. telegramClient.ts wiring 정적 가드', () => {
  const tcSrc = stripComments(fs.readFileSync(path.join(HERE, 'telegramClient.ts'), 'utf-8'));

  it('telegramHtmlSanitizer SSOT import', () => {
    expect(tcSrc).toMatch(/from\s*['"]\.\/telegramHtmlSanitizer\.js['"]/);
  });
  it('sendChunk 가 sanitizeTelegramHtml 호출', () => {
    expect(tcSrc).toMatch(/sanitizeTelegramHtml\(/);
  });
  it('청크 분할이 splitHtmlSafeChunks 사용 (slice 하드 컷 제거)', () => {
    expect(tcSrc).toMatch(/splitHtmlSafeChunks\(/);
  });
  it('invariant 라우팅 가드 wiring (classifyTelegramRouting + RAILWAY_LOG_ONLY)', () => {
    expect(tcSrc).toMatch(/classifyTelegramRouting\(/);
    expect(tcSrc).toMatch(/RAILWAY_LOG_ONLY/);
  });
  it('HTML 실패 로그 dedup wiring (shouldLogHtmlFailure)', () => {
    expect(tcSrc).toMatch(/shouldLogHtmlFailure\(/);
  });
  it('sendTelegramPlainText export — parse_mode 없는 plain 전송 함수', () => {
    expect(tcSrc).toMatch(/export\s+async\s+function\s+sendTelegramPlainText/);
  });
  it('sanitizer 모듈은 외부 네트워크 의존 0건', () => {
    const sanSrc = stripComments(fs.readFileSync(path.join(HERE, 'telegramHtmlSanitizer.ts'), 'utf-8'));
    expect(sanSrc).not.toMatch(/fetch\(|axios|node-fetch/);
    expect(sanSrc).not.toMatch(/import\s/); // 순수 함수 SSOT — import 0건
  });
});
