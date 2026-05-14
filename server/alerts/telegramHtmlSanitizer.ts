// @responsibility Telegram HTML sanitize/validate + invariant 라우팅 가드 + HTML-safe 청크 분할 SSOT
/**
 * telegramHtmlSanitizer.ts — Patch: Telegram HTML Sanitizer & Diagnostic Invariant Routing Guard
 *
 * Telegram Bot API 의 `parse_mode: 'HTML'` 전송 전 단일 통로 검증/정제 SSOT.
 *
 * 1. 허용 태그 화이트리스트 — Telegram 공식 지원 태그(b/i/code/pre/a 등)만 통과,
 *    비허용 `<...>` 와 stray `<` 는 `&lt;` 로 이스케이프 ("can't parse entities" 차단).
 * 2. 미닫힘 허용 태그 자동 닫기 — 청크 경계/잘림으로 깨진 태그 복구.
 * 3. invariant/debug 문자열 라우팅 가드 — `[INVARIANT]`/`[DEBUG]`/`[TRACE]` 접두 메시지는
 *    기본적으로 Telegram 알림이 아니라 Railway/debug 로그로만 보낸다.
 * 4. HTML-safe 4096자 청크 분할 — `<...>` 태그 중간에서 자르지 않는다.
 * 5. HTML 파싱 실패 로그 dedup/cooldown — 같은 시그니처는 cooldown 내 1회만.
 *
 * 본 모듈은 순수 함수 SSOT — 외부 네트워크/영속 의존 0건.
 */

/** Telegram Bot API 가 HTML parse_mode 에서 공식 지원하는 태그 (telegram.org/bots/api#html-style). */
export const ALLOWED_TELEGRAM_HTML_TAGS = new Set<string>([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'code',
  'pre',
  'a',
  'span',
  'tg-spoiler',
  'blockquote',
]);

/** Telegram 단일 메시지 최대 길이. */
export const TELEGRAM_MAX_MESSAGE_LEN = 4096;

/** `<a href>` 에서 허용하는 URL 스킴. */
const ALLOWED_HREF_SCHEMES = /^(https?|tg|mailto|ftp):/i;

/** invariant/debug 라우팅 가드 — 이 접두로 시작하면 Telegram 대신 Railway 로그로만. */
const INVARIANT_DEBUG_PREFIXES = ['[INVARIANT]', '[DEBUG]', '[TRACE]'];

// ─── 1·2. 허용 태그 화이트리스트 + 미닫힘 자동 닫기 ──────────────────────────────

/** 단일 `<...>` 토큰이 허용 태그인지 판정 (속성 검증 포함). */
function isAllowedTagToken(tag: string, attrs: string, isClose: boolean): boolean {
  if (!ALLOWED_TELEGRAM_HTML_TAGS.has(tag)) return false;
  const a = attrs.trim();
  if (isClose) return a === ''; // 닫는 태그는 속성 불가
  if (tag === 'a') {
    const href =
      attrs.match(/\bhref\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/\bhref\s*=\s*'([^']*)'/i)?.[1];
    if (!href) return false;
    return ALLOWED_HREF_SCHEMES.test(href.trim());
  }
  if (tag === 'code' || tag === 'span' || tag === 'pre') {
    // 선택적 class 속성만 허용 (예: <code class="language-ts">, <span class="tg-spoiler">)
    return a === '' || /^class\s*=\s*("[^"]*"|'[^']*')$/i.test(a);
  }
  // 그 외 bare 서식 태그 — 속성 불가
  return a === '';
}

export interface TelegramHtmlValidation {
  valid: boolean;
  /** 발견된 비허용 태그 / 미닫힘 태그 등 진단 사유 (최대 10건). */
  issues: string[];
}

/**
 * 허용 태그 화이트리스트 기준 HTML 검증 (진단 전용 — 변형하지 않음).
 * sanitizeTelegramHtml 이 실제 정제를 수행하고, 본 함수는 무엇이 잘못됐는지만 보고한다.
 */
export function validateTelegramHtml(text: string): TelegramHtmlValidation {
  const issues: string[] = [];
  const openStack: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*)?)>/g;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = tagRe.exec(text)) !== null) {
    // 토큰 사이 텍스트에 stray '<' 존재 여부
    const between = text.slice(lastIndex, m.index);
    if (between.includes('<')) issues.push('이스케이프되지 않은 < 문자');
    lastIndex = tagRe.lastIndex;

    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? '';
    if (!isAllowedTagToken(tag, attrs, isClose)) {
      issues.push(`비허용 태그: <${isClose ? '/' : ''}${tag}>`);
      continue;
    }
    if (isClose) {
      const idx = openStack.lastIndexOf(tag);
      if (idx === -1) issues.push(`짝 없는 닫는 태그: </${tag}>`);
      else openStack.splice(idx, 1);
    } else {
      openStack.push(tag);
    }
    if (issues.length >= 10) break;
  }
  if (text.slice(lastIndex).includes('<')) issues.push('이스케이프되지 않은 < 문자');
  for (const tag of openStack) issues.push(`미닫힘 태그: <${tag}>`);

  return { valid: issues.length === 0, issues: issues.slice(0, 10) };
}

/**
 * 허용 태그만 통과시키고, 비허용 `<...>` 와 stray `<` 는 `&lt;` 로 이스케이프한다.
 * 미닫힘 허용 태그는 끝에서 자동으로 닫는다.
 *
 * 핵심: 태그 사이의 텍스트 콘텐츠는 *건드리지 않는다* — 호출자가 이미 escapeHtml 한
 * 변수/진단값을 이중 이스케이프하지 않기 위함. 본 함수는 `<` 단위로만 정제한다.
 */
export function sanitizeTelegramHtml(text: string): string {
  let out = '';
  const openStack: string[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i];
    if (ch !== '<') {
      out += ch;
      i += 1;
      continue;
    }
    // '<' — 유효한 허용 태그인지 시도
    const m = text.slice(i).match(/^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*)?)>/);
    if (m) {
      const isClose = m[1] === '/';
      const tag = m[2].toLowerCase();
      const attrs = m[3] ?? '';
      if (isAllowedTagToken(tag, attrs, isClose)) {
        out += m[0];
        if (isClose) {
          const idx = openStack.lastIndexOf(tag);
          if (idx !== -1) openStack.splice(idx, 1);
        } else {
          openStack.push(tag);
        }
        i += m[0].length;
        continue;
      }
    }
    // 유효한 허용 태그가 아님 → '<' 이스케이프
    out += '&lt;';
    i += 1;
  }

  // 미닫힘 허용 태그 자동 닫기 (역순)
  while (openStack.length > 0) {
    out += `</${openStack.pop()!}>`;
  }
  return out;
}

// ─── 3. invariant/debug 라우팅 가드 ────────────────────────────────────────────

export type TelegramRoutingDecision = 'TELEGRAM' | 'RAILWAY_LOG_ONLY';

/**
 * 메시지가 invariant/debug 문자열인지 분류한다.
 * `[INVARIANT]` / `[DEBUG]` / `[TRACE]` 접두로 시작하면 RAILWAY_LOG_ONLY —
 * Telegram 알림이 아니라 Railway/debug 로그로만 보내야 한다.
 */
export function classifyTelegramRouting(message: string): TelegramRoutingDecision {
  const trimmed = message.trimStart();
  for (const prefix of INVARIANT_DEBUG_PREFIXES) {
    if (trimmed.startsWith(prefix)) return 'RAILWAY_LOG_ONLY';
  }
  return 'TELEGRAM';
}

/** ENV `TELEGRAM_INVARIANT_ROUTING_DISABLED=true` — 라우팅 가드 비활성 (정확 비교, ADR-0157). */
export function isTelegramInvariantRoutingDisabled(): boolean {
  return process.env.TELEGRAM_INVARIANT_ROUTING_DISABLED === 'true';
}

// ─── 4. HTML-safe 4096자 청크 분할 ─────────────────────────────────────────────

/**
 * 텍스트를 maxLen 이하 청크로 분할 — `<...>` 태그 중간에서 자르지 않는다.
 * 가능하면 개행 경계에서 자른다. 각 청크는 호출자가 sanitizeTelegramHtml 로
 * 미닫힘 태그를 자동 닫으므로 태그가 청크를 넘어도 파싱 오류는 발생하지 않는다.
 */
export function splitHtmlSafeChunks(
  text: string,
  maxLen: number = TELEGRAM_MAX_MESSAGE_LEN,
): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = maxLen;

    // 1) 태그 중간이면 '<' 앞으로 후퇴
    const head = rest.slice(0, cut);
    const lastOpen = head.lastIndexOf('<');
    const lastClose = head.lastIndexOf('>');
    if (lastOpen > lastClose) {
      cut = lastOpen;
    }

    // 2) 개행 경계 선호 (너무 멀리 후퇴하지 않을 때만)
    if (cut > 1) {
      const nlIdx = rest.lastIndexOf('\n', cut - 1);
      if (nlIdx > maxLen * 0.5) {
        cut = nlIdx + 1; // 개행을 현재 청크에 포함
      }
    }

    // 3) 가드 — cut 이 0 이하로 떨어지면 (병적 케이스) 하드 컷
    if (cut <= 0) cut = maxLen;

    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks;
}

// ─── 5. HTML 파싱 실패 로그 dedup/cooldown ─────────────────────────────────────

const HTML_FAILURE_LOG_COOLDOWN_MS = 5 * 60 * 1000; // 5분
const htmlFailureLogCooldown = new Map<string, number>();

/** HTML 파싱 실패 메시지의 dedup 시그니처 (태그 제거 + 공백 정규화 + 60자). */
export function htmlFailureSignature(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * 같은 시그니처의 HTML 실패 로그를 cooldown 내 1회만 허용한다 (로그 도배 차단).
 * @returns 로그를 출력해도 되면 true.
 */
export function shouldLogHtmlFailure(signature: string, now: number = Date.now()): boolean {
  const last = htmlFailureLogCooldown.get(signature);
  if (last !== undefined && now - last < HTML_FAILURE_LOG_COOLDOWN_MS) return false;
  htmlFailureLogCooldown.set(signature, now);
  return true;
}

/** 테스트 격리용 — cooldown Map 초기화. */
export function __resetTelegramHtmlSanitizerForTests(): void {
  htmlFailureLogCooldown.clear();
}
