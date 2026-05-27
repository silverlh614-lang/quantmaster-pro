// @responsibility telegramClient 알림 모듈

const TELEGRAM_SUPPRESSED_NOISE_TYPES = new Set([
  'PRE_ENTRY_WAIT',
  'KIS_WS_LOW_PRIORITY_REJECT',
  'KIS_MTAS_DETAIL',
]);

function isSuppressedNoiseTelegramAlert(message: string, opts?: TelegramAlertOptions): boolean {
  const candidates = [opts?.category, opts?.dedupeKey, message].filter((v): v is string => typeof v === 'string');
  return candidates.some((value) =>
    Array.from(TELEGRAM_SUPPRESSED_NOISE_TYPES).some((noiseType) => value.includes(noiseType)),
  );
}
/**
 * Telegram Bot API — setMyCommands로 봇 메뉴에 명령어 목록 등록
 * 서버 기동 시 1회 호출하면 Telegram 앱에서 '/' 입력 시 자동완성 메뉴가 표시된다.
 *
 * 긴급패치(2026-04-26): 사용자 요청 "/ 누르면 명령어 목록 호출" 충족을 위해
 * `buildBotMenuCommandsExtended()` 사용 — 기존 8개 메타 + commandRegistry 의 모든
 * 51개 alias 자동완성 노출. ADR-0017 Stage 1 의 8개 압축 정책은 메타 메뉴 자체에는
 * 그대로 유지되며 (`buildBotMenuCommands()` 회귀 테스트 그대로 통과), 자동완성에만
 * 전체 명령어가 표시된다.
 */
export async function setTelegramBotCommands(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  let commands;
  try {
    await Promise.all([
      import('../telegram/commands/system/index.js'),
      import('../telegram/commands/watchlist/index.js'),
      import('../telegram/commands/positions/index.js'),
      import('../telegram/commands/alert/index.js'),
      import('../telegram/commands/learning/index.js'),
      import('../telegram/commands/control/index.js'),
      import('../telegram/commands/trade/index.js'),
      import('../telegram/commands/infra/index.js'),
      import('../telegram/commands/shadow/index.js'),
    ]);
    commands = buildBotMenuCommandsExtended();
  } catch (e: unknown) {
    console.error('[Telegram] setMyCommands 빌드 실패:', e instanceof Error ? e.message : e);
    return;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[Telegram] setMyCommands 실패:', err.slice(0, 200));
    } else {
      console.log(`[Telegram] 봇 명령어 메뉴 등록 완료 (${commands.length}개)`);
    }
  } catch (e: unknown) {
    console.error('[Telegram] setMyCommands 오류:', e instanceof Error ? e.message : e);
  }
}

// ─── HTML 이스케이프 유틸 ──────────────────────────────────────────────────────

/**
 * HTML 모드로 전송할 메시지 내부 변수(종목명·코드 등)를 이스케이프한다.
 * <b>, <i> 같은 마크업 태그 자체에는 사용하지 말 것.
 */
export function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** HTML 태그를 제거하고 엔티티를 원래 문자로 복원한다 (plain text 폴백용). */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ─── 아이디어 2: 알림 중복 방지 + 우선순위 레이어 ─────────────────────────────────
export type AlertPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
/** 외부 레포에서 임포트하기 쉬운 별칭 — UI 알림 피드가 같은 enum 재사용. */
export type TelegramAlertPriority = AlertPriority;

// 티어 체계 (T1 🚨 ALARM / T2 📊 REPORT / T3 📋 DIGEST) 를 본 모듈에서 강제한다.
// 선두 아이콘을 티어 아이콘으로 교체해 "이게 지금 봐야 하는가"가 첫 글자로 결정되게 한다.
import { applyTierPrefix, deriveTier, inferCategory, type AlertTier } from './alertTiers.js';
import { appendAlertAudit } from './alertAuditLog.js';
import {
  captureToUnifiedBriefing,
  isUnifiedBriefingActive,
  shouldBypassCapture,
} from './unifiedBriefing.js';
import { buildBotMenuCommandsExtended } from '../telegram/metaCommands.js';
import {
  sanitizeTelegramHtml,
  splitHtmlSafeChunks,
  classifyTelegramRouting,
  isTelegramInvariantRoutingDisabled,
  shouldLogHtmlFailure,
  htmlFailureSignature,
  TELEGRAM_MAX_MESSAGE_LEN,
} from './telegramHtmlSanitizer.js';
import { evaluateAlertNoise, type AlertLevel, type AlertNoiseEvent } from './alertNoisePolicy.js';
import {
  buildThresholdLoopDiagnostic,
  buildThresholdProposalApprovalMessage,
  evaluateThresholdLoopTelegramDelivery,
  formatThresholdLoopEvaluatedLog,
  formatThresholdObserveRecommendedLog,
  formatThresholdProposalRequiresApprovalLog,
  formatThresholdProposalSuppressedLog,
  formatThresholdTelegramSentLog,
  recordThresholdLoopTelegramSent,
  type ThresholdLoopDiagnosticInput,
} from './thresholdSearchLoopNotificationPolicy.js';
export type { AlertTier } from './alertTiers.js';

interface AlertCooldownEntry {
  lastSentAt: number;
  priority: AlertPriority;
}

const alertCooldown = new Map<string, AlertCooldownEntry>();

const telegramIdempotency = new Map<string, number>();
const telegramSenderRegistry = new Set<string>();
const telegramInstanceId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

const COOLDOWN_BY_PRIORITY: Record<AlertPriority, number> = {
  CRITICAL: 0,           // 항상 발송 (비상정지·손절)
  HIGH:     60_000,      // 1분 쿨다운
  NORMAL:   300_000,     // 5분 쿨다운
  LOW:      3_600_000,   // 1시간 쿨다운
};

export interface TelegramAlertOptions {
  priority?: AlertPriority;
  dedupeKey?: string;      // 같은 key면 cooldown 내 재발송 차단
  cooldownMs?: number;     // 커스텀 쿨다운 (ms) — 기본값은 priority별
  /** 인라인 키보드 버튼 (reply_markup) */
  replyMarkup?: Record<string, unknown>;
  /**
   * 티어를 명시적으로 지정한다. 생략 시 priority로 자동 매핑 (CRITICAL→T1, LOW→T3, 그 외→T2).
   * 본 필드가 설정되거나 priority가 지정되면 메시지 선두에 티어 아이콘(🚨/📊/📋)을 강제 부여한다.
   */
  tier?: AlertTier;
  /**
   * 알림 감사 로그용 카테고리 수동 오버라이드. 미설정 시 dedupeKey에서 자동 추정.
   */
  category?: string;
  /**
   * T1 경보에 [확인] 인라인 버튼을 자동 첨부하고 ackTracker에 등록한다.
   * 기본값: tier가 T1_ALARM이고 replyMarkup이 없으면 true, 그 외 false.
   * 명시적으로 false를 설정하면 T1이어도 버튼을 붙이지 않는다 (예: Decision Broker가 자체 3택 사용).
   */
  requireAck?: boolean;
  /** ADR-0468 diagnostic-only noise policy hook. Existing callers are unchanged unless this is supplied. */
  noiseEvent?: AlertNoiseEvent;
}

function priorityFromNoiseLevel(level: AlertLevel): AlertPriority {
  if (level === 'CRITICAL') return 'CRITICAL';
  if (level === 'WARNING') return 'HIGH';
  if (level === 'NOTICE') return 'NORMAL';
  return 'LOW';
}

function inferNoiseEventFromLegacyAlert(
  message: string,
  opts?: TelegramAlertOptions,
): AlertNoiseEvent | undefined {
  if (opts?.noiseEvent) return opts.noiseEvent;

  const upper = `${opts?.category ?? ''} ${opts?.dedupeKey ?? ''} ${message}`.toUpperCase();
  if (upper.includes('[SHADOW') || upper.includes('SHADOW ONLY') || upper.includes('SHADOW_ONLY')) {
    return {
      eventType: upper.includes('STOP') || upper.includes('TARGET') || upper.includes('SELL')
        ? 'SHADOW_EXECUTION_COMPLETED'
        : 'SHADOW_SIGNAL',
      channel: 'CH4_JOURNAL',
      symbol: opts?.dedupeKey,
      strategy: opts?.category ?? 'shadow',
      session: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
      executionImpact: 'NONE',
    };
  }

  return undefined;
}

function shouldSendAlert(opts?: TelegramAlertOptions): boolean {
  if (!opts?.dedupeKey) return true;
  const priority = opts.priority ?? 'NORMAL';
  if (priority === 'CRITICAL') return true; // CRITICAL은 항상 발송

  const entry = alertCooldown.get(opts.dedupeKey);
  if (!entry) return true;

  const cooldown = opts.cooldownMs ?? COOLDOWN_BY_PRIORITY[priority];
  return Date.now() - entry.lastSentAt >= cooldown;
}

function recordAlertSent(opts?: TelegramAlertOptions): void {
  if (!opts?.dedupeKey) return;
  alertCooldown.set(opts.dedupeKey, {
    lastSentAt: Date.now(),
    priority: opts.priority ?? 'NORMAL',
  });
}

// ─── Phase 5: 다이제스트 수신 토글 (/digest_on, /digest_off) ─────────────────
// T3 DIGEST 수신을 사용자가 끌 수 있다. 정보는 /todaylog 로 풀(pull) 조회 가능.
// 파일 영속화 없이 프로세스 메모리만 사용 — 재시작 시 기본값(ON)으로 복귀.
let digestEnabled = process.env.DIGEST_ENABLED !== 'false';

export function isDigestEnabled(): boolean {
  return digestEnabled;
}

export function setDigestEnabled(enabled: boolean): void {
  digestEnabled = enabled;
}

/** 주기적으로 오래된 쿨다운 엔트리 정리 (메모리 누수 방지) */
export function pruneAlertCooldown(): void {
  const now = Date.now();
  for (const [key, entry] of alertCooldown) {
    if (now - entry.lastSentAt > 7_200_000) { // 2시간 이상 경과
      alertCooldown.delete(key);
    }
  }
}

// ─── 아이디어 3: 배치 다이제스트 (장중 노이즈 차단) ─────────────────────────────────
interface DigestEntry {
  message: string;
  timestamp: number;
}

const digestBuffer: DigestEntry[] = [];
let digestTimer: ReturnType<typeof setTimeout> | null = null;
// Phase 5 (참뮌 스펙 #9): 10분 → 30분으로 확대. "background radio" 역할.
const DIGEST_INTERVAL_MS = 30 * 60 * 1000; // 30분

/** 다이제스트 버퍼에 메시지 추가 (LOW 우선순위 알림 대상) */
export function addToDigest(message: string): void {
  digestBuffer.push({ message, timestamp: Date.now() });
  if (!digestTimer) {
    digestTimer = setTimeout(flushDigest, DIGEST_INTERVAL_MS);
  }
}

/**
 * 동일 종목/이벤트 반복을 1줄로 압축한다.
 *
 * 그룹 키: "첫 줄에서 HTML·이모지·숫자·%·괄호값을 제거한 시그니처".
 * 예: "삼성전자 +0.8% → +1.2%", "삼성전자 +1.0% → +1.3%" 모두 같은 그룹 →
 *     "삼성전자 (3건)" 압축 출력.
 */
function compressDigestEntries(entries: DigestEntry[]): string[] {
  const groups = new Map<string, { first: string; last: string; count: number }>();
  const order: string[] = [];
  for (const e of entries) {
    const firstLine = e.message.split('\n').find(l => l.trim()) ?? e.message;
    const sig = signatureOf(firstLine);
    if (!groups.has(sig)) {
      groups.set(sig, { first: firstLine.trim(), last: firstLine.trim(), count: 1 });
      order.push(sig);
    } else {
      const g = groups.get(sig)!;
      g.last = firstLine.trim();
      g.count += 1;
    }
  }
  return order.map(sig => {
    const g = groups.get(sig)!;
    if (g.count === 1) return `• ${g.first}`;
    return `• ${g.first} → ${extractTail(g.last)} <i>(${g.count}건 누적)</i>`;
  });
}

function signatureOf(line: string): string {
  return line
    .replace(/<[^>]+>/g, '')
    .replace(/[0-9]+[.,0-9]*%?/g, '#')           // 숫자·퍼센트 제거
    .replace(/[\uD83C-\uDBFF\uDC00-\uDFFF\u2600-\u27BF\uFE0F]/g, '')  // 이모지 제거
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function extractTail(line: string): string {
  // 동일 그룹의 마지막 인스턴스에서 숫자 부분만 꺼내 "→" 뒤에 보여준다.
  const m = line.match(/([+-]?\d[\d.,]*%?)/g);
  return m && m.length > 0 ? m[m.length - 1] : '최근';
}

/** 다이제스트 버퍼를 묶어 한 번에 전송 (T3 📋 DIGEST 아이콘을 강제) */
export async function flushDigest(): Promise<void> {
  digestTimer = null;
  if (digestBuffer.length === 0) return;

  const entries = digestBuffer.splice(0);
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hh = kst.getUTCHours().toString().padStart(2, '0');
  const mm = kst.getUTCMinutes().toString().padStart(2, '0');
  const startTime = new Date(entries[0].timestamp + 9 * 60 * 60 * 1000);
  const startHH = startTime.getUTCHours().toString().padStart(2, '0');
  const startMM = startTime.getUTCMinutes().toString().padStart(2, '0');

  const header = applyTierPrefix(
    `<b>[${entries.length}건 요약] ${startHH}:${startMM}~${hh}:${mm}</b>\n━━━━━━━━━━━━━━━━`,
    'T3_DIGEST',
  );
  const compressed = compressDigestEntries(entries);
  const body = compressed.join('\n');
  const full = `${header}\n${body}\n━━━━━━━━━━━━━━━━\n<i>상세 로그: /todaylog</i>`;

  const messageId = await sendTelegramAlertRaw(full);
  appendAlertAudit({
    at: new Date().toISOString(),
    tier: 'T3_DIGEST',
    priority: 'LOW',
    category: 'digest',
    textLen: full.length,
    messageId,
  });
}

/**
 * Telegram Bot API를 통해 즉시 모바일 알림 전송 (내부용 — 쿨다운 없음)
 * reply_markup 파라미터 지원 (인라인 키보드)
 */
async function sendTelegramAlertRaw(
  message: string,
  replyMarkup?: Record<string, unknown>,
): Promise<number | undefined> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn(
      `[TELEGRAM_PRIVATE_SEND_SKIPPED] reason=MISSING_CONFIG ` +
      `botTokenConfigured=${Boolean(token)} chatIdConfigured=${Boolean(chatId)}`,
    );
    return undefined;
  }

  /**
   * 단일 청크를 전송한다. 전송 전 sanitizeTelegramHtml 로 비허용 태그/stray `<` 를
   * 정제하고 미닫힘 태그를 자동 닫는다. 그래도 400 파싱 오류 시 plain-text 재시도.
   */
  async function sendChunk(
    rawText: string,
    markup?: Record<string, unknown>,
  ): Promise<number | undefined> {
    const text = sanitizeTelegramHtml(rawText);
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    };
    if (markup) payload.reply_markup = markup;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      // 400 + 엔티티 파싱 오류 → parse_mode 없이 plain text 재시도
      if (res.status === 400 && err.includes("can't parse entities")) {
        // HTML 실패 로그는 dedup/cooldown — 같은 시그니처는 5분 내 1회만.
        if (shouldLogHtmlFailure(htmlFailureSignature(text))) {
          console.warn('[Telegram] ⚠️ HTML 파싱 실패 → plain text 재시도 (첫 100자):', text.slice(0, 100));
        }
        const plain: Record<string, unknown> = { chat_id: chatId, text: stripHtml(text) };
        if (markup) plain.reply_markup = markup;
        const fb = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(plain),
        });
        if (fb.ok) {
          evaluateAlertNoise({
            eventType: 'TELEGRAM_HTML_RETRY',
            channel: 'CH4_JOURNAL',
            plainRetrySuccess: true,
            templateId: htmlFailureSignature(text),
            executionImpact: 'NONE',
          });
          const fd = await fb.json() as { result?: { message_id?: number } };
          return fd.result?.message_id;
        }
        evaluateAlertNoise({
          eventType: 'TELEGRAM_HTML_RETRY',
          channel: 'CH4_JOURNAL',
          plainRetrySuccess: false,
          templateId: htmlFailureSignature(text),
          templateFailureCount: 1,
          executionImpact: 'NONE',
        });
        const fbErr = await fb.text();
        console.error('[Telegram] ❌ plain text 폴백도 실패 (거래는 완료됨):', fbErr.slice(0, 200));
        return;
      }
      console.error(
        `[TELEGRAM_PRIVATE_SEND_FAILED] status=${res.status} body=${err.slice(0, 300)}`,
      );
      return;
    }
    const data = await res.json() as { result?: { message_id?: number } };
    return data.result?.message_id;
  }

  try {
    if (message.length <= TELEGRAM_MAX_MESSAGE_LEN) {
      return await sendChunk(message, replyMarkup);
    }
    // 4096자 초과 — HTML 태그 중간에서 자르지 않는 안전 청크 분할.
    const parts = splitHtmlSafeChunks(message, TELEGRAM_MAX_MESSAGE_LEN);
    let lastMsgId: number | undefined;
    for (let idx = 0; idx < parts.length; idx += 1) {
      // replyMarkup은 마지막 청크에만 첨부
      const markup = (replyMarkup && idx === parts.length - 1) ? replyMarkup : undefined;
      const msgId = await sendChunk(parts[idx], markup);
      if (msgId !== undefined) lastMsgId = msgId;
      await new Promise(r => setTimeout(r, 300)); // 연속 전송 간격
    }
    return lastMsgId;
  } catch (e: unknown) {
    console.error('[Telegram] ❌ 네트워크 오류 (거래는 완료됨):', e instanceof Error ? e.message : e);
  }
}

/**
 * Telegram Bot API를 통해 알림 전송 (우선순위 + 중복방지 + 다이제스트 + 티어 아이콘 강제)
 *
 * - CRITICAL: 항상 즉시 발송 / 티어 T1 🚨 ALARM
 * - HIGH: 1분 쿨다운 / 기본 T2 📊 REPORT (T1 수준이면 `tier: 'T1_ALARM'` 명시)
 * - NORMAL: 5분 쿨다운 / T2 📊 REPORT
 * - LOW: 다이제스트 버퍼 / T3 📋 DIGEST
 *
 * priority 또는 tier 가 지정되면 메시지 선두 아이콘은 자동으로 티어 아이콘으로 정규화된다.
 * 두 옵션 모두 없으면 (예: 사용자 명령 응답) 메시지는 그대로 전달된다.
 *
 * 기존 sendTelegramAlert(message) 시그니처 100% 호환.
 */
interface NoisePolicyApplicationResult {
  opts?: TelegramAlertOptions;
  suppressed: boolean;
}

function applyInferredNoisePolicyToAlert(
  message: string,
  opts?: TelegramAlertOptions,
): NoisePolicyApplicationResult {
  const inferredNoiseEvent = inferNoiseEventFromLegacyAlert(message, opts);
  if (!inferredNoiseEvent) return { opts, suppressed: false };

  const baseOpts = opts ?? {};
  const noise = evaluateAlertNoise(inferredNoiseEvent);
  if (!noise.shouldSendNow) {
    if (noise.shouldDigest) {
      addToDigest(message);
      appendAlertAudit({
        at: new Date().toISOString(),
        tier: 'T3_DIGEST',
        priority: 'LOW',
        category: baseOpts.category ?? noise.reason,
        dedupeKey: baseOpts.dedupeKey ?? noise.dedupeKey,
        textLen: message.length,
      });
    }
    return { opts: baseOpts, suppressed: true };
  }

  return {
    suppressed: false,
    opts: {
      ...baseOpts,
      priority: baseOpts.priority ?? priorityFromNoiseLevel(noise.level),
      dedupeKey: baseOpts.dedupeKey ?? noise.dedupeKey,
      cooldownMs: baseOpts.cooldownMs ?? noise.ttlSeconds * 1000,
      category: baseOpts.category ?? noise.reason,
    },
  };
}

function shouldSuppressByTelegramRoutingGuard(message: string): boolean {
  if (
    !isTelegramInvariantRoutingDisabled() &&
    classifyTelegramRouting(message) === 'RAILWAY_LOG_ONLY'
  ) {
    console.log('[TelegramRoutingGuard] invariant/debug 문자열 — Telegram 발송 생략, 로그 전용:', message.slice(0, 200));
    return true;
  }
  return false;
}

interface TieredAlertPayload {
  finalMessage: string;
  hasTierIntent: boolean;
  tier?: AlertTier;
}

function buildTieredAlertPayload(
  message: string,
  opts?: TelegramAlertOptions,
): TieredAlertPayload {
  const hasTierIntent = Boolean(opts?.priority || opts?.tier);
  const tier: AlertTier | undefined = hasTierIntent ? deriveTier(opts) : undefined;
  return {
    finalMessage: tier ? applyTierPrefix(message, tier) : message,
    hasTierIntent,
    tier,
  };
}

function captureUnifiedBriefingIfNeeded(
  finalMessage: string,
  opts?: TelegramAlertOptions,
): boolean {
  if (isUnifiedBriefingActive() && !shouldBypassCapture(opts) && !opts?.replyMarkup) {
    const absorbed = captureToUnifiedBriefing(finalMessage, opts?.category ?? inferCategory(opts?.dedupeKey));
    if (absorbed) {
      recordAlertSent(opts);
      return true;
    }
  }
  return false;
}

interface AckContext {
  effectiveReplyMarkup?: Record<string, unknown>;
  wantsAck: boolean;
  ackId?: string;
}

async function buildAckContext(
  tier: AlertTier | undefined,
  opts?: TelegramAlertOptions,
): Promise<AckContext> {
  const wantsAck = tier === 'T1_ALARM'
    && !opts?.replyMarkup
    && (opts?.requireAck ?? true);
  if (!wantsAck) {
    return { effectiveReplyMarkup: opts?.replyMarkup, wantsAck: false };
  }

  const ackId = `ack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const { buildAckReplyMarkup } = await import('./ackTracker.js');
  return {
    effectiveReplyMarkup: buildAckReplyMarkup(ackId),
    wantsAck,
    ackId,
  };
}

async function appendAlertFeedBestEffort(
  message: string,
  priority: AlertPriority,
  dedupeKey?: string,
): Promise<void> {
  try {
    const { appendAlertFeed } = await import('../persistence/alertsFeedRepo.js');
    appendAlertFeed(message, priority, dedupeKey);
  } catch { /* noop */ }
}

async function handleDigestAlertIfNeeded(
  finalMessage: string,
  opts: TelegramAlertOptions | undefined,
  tier: AlertTier | undefined,
  effectiveReplyMarkup?: Record<string, unknown>,
): Promise<boolean> {
  const goDigest = (opts?.priority === 'LOW' || opts?.tier === 'T3_DIGEST') && !effectiveReplyMarkup;
  if (!goDigest) return false;

  if (!digestEnabled) {
    await appendAlertFeedBestEffort(finalMessage, 'LOW', opts?.dedupeKey);
    appendAlertAudit({
      at: new Date().toISOString(),
      tier: 'T3_DIGEST',
      priority: opts?.priority,
      category: opts?.category ?? inferCategory(opts?.dedupeKey),
      dedupeKey: opts?.dedupeKey,
      textLen: finalMessage.length,
    });
    return true;
  }

  if (shouldSendAlert(opts)) {
    addToDigest(finalMessage);
    recordAlertSent(opts);
    await appendAlertFeedBestEffort(finalMessage, 'LOW', opts?.dedupeKey);
    appendAlertAudit({
      at: new Date().toISOString(),
      tier: tier ?? 'T3_DIGEST',
      priority: opts?.priority,
      category: opts?.category ?? inferCategory(opts?.dedupeKey),
      dedupeKey: opts?.dedupeKey,
      textLen: finalMessage.length,
    });
  }
  return true;
}

async function registerAckIfNeeded(
  ack: AckContext,
  msgId: number | undefined,
  finalMessage: string,
  opts?: TelegramAlertOptions,
): Promise<void> {
  if (!ack.wantsAck || !ack.ackId || msgId === undefined) return;

  try {
    const { registerPendingAck } = await import('./ackTracker.js');
    const firstLine = finalMessage.split('\n').find(l => l.trim().length > 0) ?? finalMessage;
    registerPendingAck({
      ackId: ack.ackId,
      messageId: msgId,
      summary: firstLine.replace(/<[^>]+>/g, '').slice(0, 160),
      sentAt: Date.now(),
      category: opts?.category ?? inferCategory(opts?.dedupeKey),
      dedupeKey: opts?.dedupeKey,
    });
  } catch (e: unknown) {
    console.warn('[Telegram] ACK 등록 실패:', e instanceof Error ? e.message : e);
  }
}

async function sendImmediateAlert(
  payload: TieredAlertPayload,
  ack: AckContext,
  opts?: TelegramAlertOptions,
): Promise<number | undefined> {
  const channelId = process.env.TELEGRAM_CHAT_ID ?? 'default';
  const senderKey = `${channelId}`;
  if (!telegramSenderRegistry.has(senderKey)) {
    telegramSenderRegistry.add(senderKey);
    console.log(`[TELEGRAM_SENDER_REGISTERED] instanceId=${telegramInstanceId} channelId=${channelId} alreadyRegistered=false`);
  } else if (process.env.TELEGRAM_SENDER_DEBUG === 'true') {
    console.log(`[TELEGRAM_SENDER_DUPLICATE_BLOCKED] instanceId=${telegramInstanceId} channelId=${channelId} reason=ALREADY_REGISTERED`);
  }
  const msgHash = Buffer.from(payload.finalMessage).toString('base64').slice(0, 16);
  const idempotencyKey = `${channelId}:${opts?.category ?? 'UNKNOWN'}:${opts?.dedupeKey ?? 'NO_KEY'}:${msgHash}`;
  const last = telegramIdempotency.get(idempotencyKey);
  if (last && Date.now() - last < 10 * 60 * 1000) {
    console.log(`[TELEGRAM_IDEMPOTENCY_SUPPRESSED] channelId=${channelId} alertType=REGIME_STATUS effectiveRegime=R6_DEFENSE messageHash=${msgHash} ttl=10m telegramSent=false`);
    return undefined;
  }
  if (!shouldSendAlert(opts)) {
    console.log(`[Telegram] 쿨다운 중 — 발송 생략 (key=${opts?.dedupeKey})`);
    return undefined;
  }

  const msgId = await sendTelegramAlertRaw(payload.finalMessage, ack.effectiveReplyMarkup);
  recordAlertSent(opts);
  await appendAlertFeedBestEffort(payload.finalMessage, opts?.priority ?? 'NORMAL', opts?.dedupeKey);
  if (payload.hasTierIntent) {
    appendAlertAudit({
      at: new Date().toISOString(),
      tier: payload.tier!,
      priority: opts?.priority,
      category: opts?.category ?? inferCategory(opts?.dedupeKey),
      dedupeKey: opts?.dedupeKey,
      textLen: payload.finalMessage.length,
      messageId: msgId,
    });
  }
  await registerAckIfNeeded(ack, msgId, payload.finalMessage, opts);
  return msgId;
}

/**
 * Telegram Bot API를 통해 알림 전송 (우선순위 + 중복방지 + 다이제스트 + 티어 아이콘 강제).
 *
 * 기존 sendTelegramAlert(message) 시그니처 100% 호환.
 */
export async function sendTelegramAlert(
  message: string,
  opts?: TelegramAlertOptions,
): Promise<number | undefined> {
  const noisePolicy = applyInferredNoisePolicyToAlert(message, opts);
  if (noisePolicy.suppressed) return undefined;
  opts = noisePolicy.opts;

  if (isSuppressedNoiseTelegramAlert(message, opts)) return undefined;

  // invariant/debug 라우팅 가드는 Telegram 대신 Railway/debug 로그로만 보낸다.
  if (shouldSuppressByTelegramRoutingGuard(message)) return undefined;

  const payload = buildTieredAlertPayload(message, opts);
  if (captureUnifiedBriefingIfNeeded(payload.finalMessage, opts)) return undefined;

  const ack = await buildAckContext(payload.tier, opts);
  const digestHandled = await handleDigestAlertIfNeeded(
    payload.finalMessage,
    opts,
    payload.tier,
    ack.effectiveReplyMarkup,
  );
  if (digestHandled) return undefined;

  return sendImmediateAlert(payload, ack, opts);
}
/**
 * parse_mode 없는 plain text 전용 전송 SSOT.
 *
 * HTML 파싱을 일절 거치지 않으므로 `<`, `>`, `&` 가 그대로 안전하게 전달된다.
 * 진단/raw 문자열, HTML 마크업이 의미 없는 메시지에 사용한다.
 *
 * - parse_mode 미지정 (HTML 파싱 0건)
 * - 4096자 초과 시 splitHtmlSafeChunks 로 분할 (plain text 도 안전)
 * - dedupeKey/cooldownMs/priority 로 쿨다운 적용 (sendTelegramAlert 와 동일 메커니즘)
 * - 티어 아이콘 / 다이제스트 / ACK 버튼 미적용 — 순수 plain text
 */
export async function sendTelegramPlainText(
  message: string,
  opts?: Pick<TelegramAlertOptions, 'priority' | 'dedupeKey' | 'cooldownMs'>,
): Promise<number | undefined> {
  if (!shouldSendAlert(opts)) {
    console.log(`[Telegram] plain 쿨다운 중 — 발송 생략 (key=${opts?.dedupeKey})`);
    return;
  }

  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  async function sendPlainChunk(text: string): Promise<number | undefined> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }), // parse_mode 미지정
      });
      if (!res.ok) {
        console.error('[Telegram] ❌ plain text 전송 실패:', (await res.text()).slice(0, 200));
        return;
      }
      const data = await res.json() as { result?: { message_id?: number } };
      return data.result?.message_id;
    } catch (e: unknown) {
      console.error('[Telegram] ❌ plain text 네트워크 오류:', e instanceof Error ? e.message : e);
      return;
    }
  }

  let lastMsgId: number | undefined;
  const parts = splitHtmlSafeChunks(message, TELEGRAM_MAX_MESSAGE_LEN);
  for (const part of parts) {
    const msgId = await sendPlainChunk(part);
    if (msgId !== undefined) lastMsgId = msgId;
    if (parts.length > 1) await new Promise(r => setTimeout(r, 300));
  }
  recordAlertSent(opts);
  return lastMsgId;
}

/**
 * Telegram callbackQuery에 대한 응답 (answerCallbackQuery)
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text ?? '',
      }),
    });
  } catch (e: unknown) {
    console.error('[Telegram] answerCallbackQuery 오류:', e instanceof Error ? e.message : e);
  }
}

/**
 * 기존 메시지 텍스트 수정 (editMessageText)
 * 인라인 키보드 버튼 비활성화 시 사용
 */
export async function editMessageText(
  messageId: number,
  text: string,
  replyMarkup?: Record<string, unknown>,
): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      message_id: messageId,
      text: sanitizeTelegramHtml(text),
      parse_mode: 'HTML',
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e: unknown) {
    console.error('[Telegram] editMessageText 오류:', e instanceof Error ? e.message : e);
  }
}

// ─── 채널 알림 (TELEGRAM_CHAT_ID) ────────────────────────────────────────────

/**
 * Telegram 채널에 알림 전송.
 * TELEGRAM_CHAT_ID 환경변수에 채팅 chat_id 설정 필요 — 별도의 채널 변수는 사용하지 않는다.
 * (공개 채널: "@채널이름", 비공개 채널/DM: "-100xxxxxxxxxx" 또는 숫자 chat_id)
 *
 * - 쿨다운/다이제스트 없이 즉시 전송
 * - replyMarkup 미지원 (채널 메시지에는 인라인 키보드 제외)
 */
export async function sendChannelAlert(
  message: string,
  opts?: { disableNotification?: boolean },
): Promise<number | undefined> {
  const channelId = process.env.TELEGRAM_CHAT_ID;
  if (!channelId) {
    console.log('[Telegram] TELEGRAM_CHAT_ID 미설정 — 채널 전송 스킵');
    return;
  }
  return sendChannelAlertTo(channelId, message, opts);
}

export async function sendChannelAlertTo(
  channelId: string,
  message: string,
  opts?: { disableNotification?: boolean },
): Promise<number | undefined> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !channelId) return;

  try {
    const payload: Record<string, unknown> = {
      chat_id: channelId,
      text: sanitizeTelegramHtml(message),
      parse_mode: 'HTML',
    };
    if (opts?.disableNotification) {
      payload.disable_notification = true;
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[Telegram] 채널 전송 실패:', err.slice(0, 200));
      return;
    }
    const data = await res.json() as { result?: { message_id?: number } };
    return data.result?.message_id;
  } catch (e: unknown) {
    console.error('[Telegram] 채널 전송 오류:', e instanceof Error ? e.message : e);
  }
}

// ADR-0039 (PR-X3): sendPickChannelAlert 함수 삭제 — 호출자 0건 마이그레이션 완료.
// 신규 코드는 dispatchAlert(ChannelSemantic.SIGNAL, message) 사용.
// alertRouter.resolveAnalysisChannelId 가 TELEGRAM_PICK_CHANNEL_ID legacy fallback 유지.

// ─── 빈 스캔 Decision Broker (인라인 3택) ─────────────────────────────────
// 5회 연속 빈 스캔 시 운용자에게 3택을 제시하고 서버가 callback으로 액션을 받는다.
// callback_data 포맷: "op_override:<ACTION>:<nonce>" — webhookHandler → overrideExecutor로 라우팅.

export type EmptyScanOverrideAction = 'EXPAND_UNIVERSE' | 'RELAX_THRESHOLD' | 'HOLD';

export interface EmptyScanBrokerParams {
  consecutiveEmptyScans: number;
  regime?: string;
  /** 현재 실효 Gate 임계값 (숫자). 메시지 맥락 제공용. */
  currentThreshold?: number;
  /** 오늘 이미 소진한 오버라이드 횟수 */
  usedToday?: number;
  dailyLimit?: number;
  /** Notification-only no-entry decomposition for threshold proposal suppression. */
  thresholdDiagnostic?: Partial<ThresholdLoopDiagnosticInput>;
}

/**
 * 3택(유니버스 확장/임계값 완화/관망) 인라인 키보드와 함께 상황 보고를 전송.
 * LIVE 모드 감지 시 RELAX 버튼은 텍스트에 "SHADOW 전용" 경고를 덧붙인다(실행은 executor가 차단).
 *
 * dedupeKey로 동일 사이클 스팸을 방지 — callback 수신 전까지는 재발송 금지.
 */
export async function sendEmptyScanDecisionBroker(
  params: EmptyScanBrokerParams,
): Promise<number | undefined> {
  const {
    consecutiveEmptyScans,
    regime = 'R4_NEUTRAL',
    currentThreshold,
    usedToday = 0,
    dailyLimit = 2,
    thresholdDiagnostic = {},
  } = params;

  const nonce = Date.now().toString(36);
  const isLive = (process.env.AUTO_TRADE_MODE ?? 'SHADOW').toUpperCase() === 'LIVE';
  const remaining = Math.max(0, dailyLimit - usedToday);
  const diagnostic = buildThresholdLoopDiagnostic({
    ...thresholdDiagnostic,
    noEntryStreak: consecutiveEmptyScans,
    regime,
    gateThreshold: currentThreshold,
  });
  const delivery = evaluateThresholdLoopTelegramDelivery(diagnostic);
  console.log(formatThresholdLoopEvaluatedLog(diagnostic));

  if (!diagnostic.thresholdLoweringEligible) {
    console.log(formatThresholdObserveRecommendedLog(diagnostic));
    console.log(formatThresholdProposalSuppressedLog(diagnostic, delivery, {
      gate3RrrFailCount: thresholdDiagnostic.gate3RrrFailCount ?? 0,
      preBreakoutWaitCount: thresholdDiagnostic.preBreakoutWaitCount ?? 0,
    }));
    return;
  }

  if (!delivery.shouldSend) {
    console.log(formatThresholdProposalSuppressedLog(diagnostic, delivery, {
      gate3RrrFailCount: thresholdDiagnostic.gate3RrrFailCount ?? 0,
      preBreakoutWaitCount: thresholdDiagnostic.preBreakoutWaitCount ?? 0,
    }));
    return;
  }
  console.log(formatThresholdProposalRequiresApprovalLog(diagnostic, delivery));

  const header =
    buildThresholdProposalApprovalMessage(diagnostic, delivery) +
    `\n\n<b>Decision Broker</b>\n` +
    `연속 빈 스캔: <b>${consecutiveEmptyScans}회</b>\n` +
    `현재 레짐: ${regime}` +
    (currentThreshold !== undefined ? ` | Gate >= ${currentThreshold.toFixed(1)}` : '') +
    `\n오늘 사용: ${usedToday}/${dailyLimit}${remaining === 0 ? ' (한도 소진)' : ''}\n` +
    `<b>조치 선택 (30분 후 자동 만료)</b>\n` +
    `1. 유니버스 확장\n` +
    `2. 임계값 -0.5 검토${isLive ? ' (LIVE 모드 차단)' : ''}\n` +
    `3. 관망 유지`;

  const replyMarkup = {
    inline_keyboard: [[
      { text: '1. 유니버스 확장', callback_data: `op_override:EXPAND_UNIVERSE:${nonce}` },
      { text: `2. 임계값 -0.5${isLive ? ' 차단' : ''}`, callback_data: `op_override:RELAX_THRESHOLD:${nonce}` },
      { text: '3. 관망 유지', callback_data: `op_override:HOLD:${nonce}` },
    ]],
  };

  const messageId = await sendTelegramAlert(header, {
    priority: 'HIGH',
    tier: 'T1_ALARM',  // Operator approval prompt; no response keeps HOLD.
    dedupeKey: diagnostic.dedupKey,
    cooldownMs: 60 * 60 * 1000,
    category: 'threshold_search',
    replyMarkup,
  });
  if (messageId !== undefined) {
    recordThresholdLoopTelegramSent(diagnostic);
    console.log(formatThresholdTelegramSentLog(diagnostic));
  }
  return messageId;
}

/**
 * 개인 채팅(DM) 전용 알림 SSOT — sendTelegramAlert 의 시멘틱 별칭 (ADR-0038 §1).
 *
 * 사용 시점: **잔고/자산/비상정지/손절 접근 경보/KIS 오류/EgressGuard 차단** 등
 * 본인만 봐야 할 민감 정보. 채널(TELEGRAM_*_CHANNEL_ID) 로는 절대 발송되지 않음을
 * 호출자 시그니처에서 명시한다.
 *
 * 채널 발송이 필요한 알림은 `dispatchAlert(category, ...)` (alertRouter SSOT) 사용.
 *
 * @see sendTelegramAlert — 동일 구현 (TELEGRAM_CHAT_ID 한 곳으로만 발송)
 * @see ADR-0038 — 개인 회선 격리 정책
 */
export async function sendPrivateAlert(
  message: string,
  opts?: TelegramAlertOptions,
): Promise<number | undefined> {
  return sendTelegramAlert(message, opts);
}

/**
 * 브로드캐스트 전송.
 *
 * @deprecated PR-X2 (ADR-0038) — `TELEGRAM_CHAT_ID` 단일 변수 운영 환경에서는 이미
 * `sendTelegramAlert` 와 동일 동작을 한다. 명칭이 "broadcast" 로 오해 소지 있어
 * 신규 코드는 다음 중 하나로 마이그레이션:
 *   - 개인 DM 전용 (잔고/자산/오류) → `sendPrivateAlert(...)`
 *   - 채널 발송 (매매/픽/레짐/리포트) → `dispatchAlert(category, ...)`
 *
 * 기존 9개 호출자(weeklyConditionScorecard / supplyChainAgent / foreignFlowLeadingAlert
 * / stopLossTransparencyReport / newHighMomentumScanner / positionMorningCard /
 * sectorCycleDashboard / weeklyQuantInsight / scanReviewReport) 는 PR-X3 에서 일괄
 * 마이그레이션 예정. 본 PR 은 표시만.
 *
 * @returns 개인 채팅 메시지 ID
 */
export async function sendTelegramBroadcast(
  message: string,
  opts?: TelegramAlertOptions & { disableChannelNotification?: boolean },
): Promise<number | undefined> {
  return sendTelegramAlert(message, opts);
}
