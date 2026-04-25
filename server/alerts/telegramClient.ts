/**
 * Telegram Bot API — setMyCommands로 봇 메뉴에 명령어 목록 등록
 * 서버 기동 시 1회 호출하면 Telegram 앱에서 '/' 입력 시 자동완성 메뉴가 표시된다.
 *
 * 메뉴 SSOT 는 `metaCommands.buildBotMenuCommands()` — META_COMMAND_REGISTRY 에
 * 메타 추가 시 자동 갱신된다. 본 함수에서 직접 명령어 배열을 하드코딩하지 말 것
 * (drift 재발 차단).
 */
export async function setTelegramBotCommands(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  // ADR-0017 Stage 1 — 메뉴 노출은 메타 명령어 + /help /status /now 8개 (43→8).
  // 기존 51개 alias 는 webhookHandler.ts switch / commandRegistry 에서 100% 보존
  // 되어 직접 입력으로 사용 가능. 메타 명령어 핸들러는 metaCommands.ts.
  let commands;
  try {
    commands = buildBotMenuCommands();
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
import { buildBotMenuCommands } from '../telegram/metaCommands.js';
export type { AlertTier } from './alertTiers.js';

interface AlertCooldownEntry {
  lastSentAt: number;
  priority: AlertPriority;
}

const alertCooldown = new Map<string, AlertCooldownEntry>();

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
  if (!token || !chatId) return;

  const MAX_LEN = 4096;

  /** 단일 청크를 전송한다. 400 파싱 오류 시 plain-text로 재시도. */
  async function sendChunk(
    text: string,
    markup?: Record<string, unknown>,
  ): Promise<number | undefined> {
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
        console.warn('[Telegram] ⚠️ HTML 파싱 실패 → plain text 재시도 (첫 100자):', text.slice(0, 100));
        const plain: Record<string, unknown> = { chat_id: chatId, text: stripHtml(text) };
        if (markup) plain.reply_markup = markup;
        const fb = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(plain),
        });
        if (fb.ok) {
          const fd = await fb.json() as { result?: { message_id?: number } };
          return fd.result?.message_id;
        }
        const fbErr = await fb.text();
        console.error('[Telegram] ❌ plain text 폴백도 실패 (거래는 완료됨):', fbErr.slice(0, 200));
        return;
      }
      console.error('[Telegram] ❌ 전송 실패 (거래는 완료됨):', err.slice(0, 200));
      return;
    }
    const data = await res.json() as { result?: { message_id?: number } };
    return data.result?.message_id;
  }

  try {
    if (message.length <= MAX_LEN) {
      return await sendChunk(message, replyMarkup);
    } else {
      // 4096자 초과 시 청크 분할 전송
      let lastMsgId: number | undefined;
      for (let i = 0; i < message.length; i += MAX_LEN) {
        const chunk = message.slice(i, i + MAX_LEN);
        // replyMarkup은 마지막 청크에만 첨부
        const markup = (replyMarkup && i + MAX_LEN >= message.length) ? replyMarkup : undefined;
        const msgId = await sendChunk(chunk, markup);
        if (msgId !== undefined) lastMsgId = msgId;
        await new Promise(r => setTimeout(r, 300)); // 연속 전송 간격
      }
      return lastMsgId;
    }
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
export async function sendTelegramAlert(
  message: string,
  opts?: TelegramAlertOptions,
): Promise<number | undefined> {
  // 티어 의도가 명시된 경우에만 선두 아이콘을 강제한다 — 커맨드 응답은 기존 서식 유지.
  const hasTierIntent = Boolean(opts?.priority || opts?.tier);
  const tier: AlertTier | undefined = hasTierIntent ? deriveTier(opts) : undefined;
  const finalMessage = tier ? applyTierPrefix(message, tier) : message;

  // 통합 브리핑 캡처 모드: T1/CRITICAL 외에는 버퍼로 흡수 후 endUnifiedBriefing이 일괄 발송.
  if (isUnifiedBriefingActive() && !shouldBypassCapture(opts) && !opts?.replyMarkup) {
    const absorbed = captureToUnifiedBriefing(finalMessage, opts?.category ?? inferCategory(opts?.dedupeKey));
    if (absorbed) {
      recordAlertSent(opts);
      return;
    }
  }

  // T1 ACK 자동 부착: tier=T1이고 replyMarkup이 없으면 [확인] 버튼 자동 생성.
  // 호출부가 이미 버튼을 달았거나 requireAck=false면 스킵.
  let effectiveReplyMarkup = opts?.replyMarkup;
  let ackId: string | undefined;
  const wantsAck = tier === 'T1_ALARM'
    && !opts?.replyMarkup
    && (opts?.requireAck ?? true);
  if (wantsAck) {
    ackId = `ack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const { buildAckReplyMarkup } = await import('./ackTracker.js');
    effectiveReplyMarkup = buildAckReplyMarkup(ackId);
  }

  // LOW 우선순위 (또는 T3 명시): 다이제스트 버퍼로 전환 (replyMarkup 있으면 즉시 발송)
  const goDigest = (opts?.priority === 'LOW' || opts?.tier === 'T3_DIGEST') && !effectiveReplyMarkup;
  if (goDigest) {
    // /digest_off 상태: Telegram 발송은 하지 않고 감사 로그·UI 피드만 남긴다. 참뮌은 /todaylog 로 조회.
    if (!digestEnabled) {
      try {
        const { appendAlertFeed } = await import('../persistence/alertsFeedRepo.js');
        appendAlertFeed(finalMessage, 'LOW', opts?.dedupeKey);
      } catch { /* noop */ }
      appendAlertAudit({
        at: new Date().toISOString(),
        tier: 'T3_DIGEST',
        priority: opts?.priority,
        category: opts?.category ?? inferCategory(opts?.dedupeKey),
        dedupeKey: opts?.dedupeKey,
        textLen: finalMessage.length,
      });
      return;
    }
    if (shouldSendAlert(opts)) {
      addToDigest(finalMessage);
      recordAlertSent(opts);
      // UI 피드에도 동일 엔트리 누적 (텔레그램 ↔ UI 정보 비대칭 해소).
      try {
        const { appendAlertFeed } = await import('../persistence/alertsFeedRepo.js');
        appendAlertFeed(finalMessage, 'LOW', opts?.dedupeKey);
      } catch { /* noop — 피드 기록은 best-effort */ }
      appendAlertAudit({
        at: new Date().toISOString(),
        tier: tier ?? 'T3_DIGEST',
        priority: opts?.priority,
        category: opts?.category ?? inferCategory(opts?.dedupeKey),
        dedupeKey: opts?.dedupeKey,
        textLen: finalMessage.length,
      });
    }
    return;
  }

  if (!shouldSendAlert(opts)) {
    console.log(`[Telegram] 쿨다운 중 — 발송 생략 (key=${opts?.dedupeKey})`);
    return;
  }

  const msgId = await sendTelegramAlertRaw(finalMessage, effectiveReplyMarkup);
  recordAlertSent(opts);
  try {
    const { appendAlertFeed } = await import('../persistence/alertsFeedRepo.js');
    appendAlertFeed(finalMessage, opts?.priority ?? 'NORMAL', opts?.dedupeKey);
  } catch { /* noop */ }
  if (hasTierIntent) {
    appendAlertAudit({
      at: new Date().toISOString(),
      tier: tier!,
      priority: opts?.priority,
      category: opts?.category ?? inferCategory(opts?.dedupeKey),
      dedupeKey: opts?.dedupeKey,
      textLen: finalMessage.length,
      messageId: msgId,
    });
  }
  // ACK 대기 엔트리 등록 (Telegram 전송 성공 시에만) — 미확인 시 크론이 재발송·이메일 에스컬레이션.
  if (wantsAck && ackId && msgId !== undefined) {
    try {
      const { registerPendingAck } = await import('./ackTracker.js');
      const firstLine = finalMessage.split('\n').find(l => l.trim().length > 0) ?? finalMessage;
      registerPendingAck({
        ackId,
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
  return msgId;
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
      text,
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
      text: message,
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

/**
 * 종목 픽 채널에 알림 전송.
 * TELEGRAM_PICK_CHANNEL_ID 환경변수에 채널 chat_id 설정 필요.
 * 구독자 전체에게 브로드캐스트 — 쿨다운/다이제스트 없이 즉시 전송.
 */
export async function sendPickChannelAlert(
  message: string,
  opts?: { disableNotification?: boolean },
): Promise<number | undefined> {
  const channelId = process.env.TELEGRAM_PICK_CHANNEL_ID;
  if (!channelId) {
    console.log('[Telegram] TELEGRAM_PICK_CHANNEL_ID 미설정 — 픽 채널 전송 스킵');
    return;
  }
  return sendChannelAlertTo(channelId, message, opts);
}

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
  } = params;

  const nonce = Date.now().toString(36);
  const isLive = (process.env.AUTO_TRADE_MODE ?? 'SHADOW').toUpperCase() === 'LIVE';
  const remaining = Math.max(0, dailyLimit - usedToday);

  const header =
    `🧭 <b>[빈 스캔 Decision Broker]</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `연속 빈 스캔: <b>${consecutiveEmptyScans}회</b>\n` +
    `현재 레짐: ${regime}` +
    (currentThreshold !== undefined ? ` | Gate ≥ ${currentThreshold.toFixed(1)}` : '') +
    `\n오늘 사용: ${usedToday}/${dailyLimit}${remaining === 0 ? ' (한도 소진)' : ''}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<b>조치 선택 (30분 후 자동 만료)</b>\n` +
    `① 유니버스 확장 — 52주 신고가 + 외국인 순매수 추가 편입\n` +
    `② 임계값 −0.5 완화${isLive ? ' (LIVE 모드에서 차단됨)' : ''}\n` +
    `③ 관망 유지 — 조치 없이 현 상태 고수`;

  const replyMarkup = {
    inline_keyboard: [[
      { text: '① 유니버스 확장', callback_data: `op_override:EXPAND_UNIVERSE:${nonce}` },
      { text: `② 임계값 −0.5${isLive ? ' 🚫' : ''}`, callback_data: `op_override:RELAX_THRESHOLD:${nonce}` },
      { text: '③ 관망 유지', callback_data: `op_override:HOLD:${nonce}` },
    ]],
  };

  return sendTelegramAlert(header, {
    priority: 'HIGH',
    tier: 'T1_ALARM',  // 참뮌의 선택 대기 중 — 응답 없으면 관망 유지로 자동 만료.
    dedupeKey: 'empty_scan_broker',
    category: 'decision_broker',
    replyMarkup,
  });
}

/**
 * 브로드캐스트 전송.
 *
 * TELEGRAM_CHAT_ID 단일 변수 운영 체제에서는 DM 과 채널 대상이 동일하므로
 * 중복 송신을 피하기 위해 sendTelegramAlert(DM) 한 번만 호출한다.
 * disableChannelNotification 옵션은 레거시 호출자 호환을 위해 유지한다.
 *
 * @returns 개인 채팅 메시지 ID
 */
export async function sendTelegramBroadcast(
  message: string,
  opts?: TelegramAlertOptions & { disableChannelNotification?: boolean },
): Promise<number | undefined> {
  return sendTelegramAlert(message, opts);
}
