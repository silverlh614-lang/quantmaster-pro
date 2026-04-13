/**
 * Telegram Bot API — setMyCommands로 봇 메뉴에 명령어 목록 등록
 * 서버 기동 시 1회 호출하면 Telegram 앱에서 '/' 입력 시 자동완성 메뉴가 표시된다.
 */
export async function setTelegramBotCommands(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const commands = [
    { command: 'help',      description: '명령어 목록 보기' },
    { command: 'status',    description: '시스템 현황 요약' },
    { command: 'market',    description: '시장상황 요약 레포트' },
    { command: 'watchlist', description: '워치리스트 조회' },
    { command: 'shadow',    description: 'Shadow 성과 현황' },
    { command: 'pending',   description: '미체결 주문 조회' },
    { command: 'report',    description: '일일 리포트 생성' },
    { command: 'buy',       description: '수동 매수 신호 (예: /buy 005930)' },
    { command: 'stop',      description: '비상 정지 발동' },
    { command: 'reset',     description: '비상 정지 해제' },
    { command: 'pnl',       description: '실시간 포지션별 손익 조회' },
    { command: 'pos',       description: '보유 포지션 요약' },
    { command: 'add',       description: '워치리스트 추가 (예: /add 005380)' },
    { command: 'remove',    description: '워치리스트 제거 (예: /remove 005380)' },
    { command: 'regime',    description: '매크로 레짐 + MHS + VKOSPI 현황' },
    { command: 'scan',      description: '장중 강제 스캔 트리거' },
    { command: 'cancel',    description: '종목 미체결 주문 취소 (예: /cancel 005380)' },
  ];

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

// ─── 아이디어 2: 알림 중복 방지 + 우선순위 레이어 ─────────────────────────────────
export type AlertPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

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
const DIGEST_INTERVAL_MS = 10 * 60 * 1000; // 10분

/** 다이제스트 버퍼에 메시지 추가 (LOW 우선순위 알림 대상) */
export function addToDigest(message: string): void {
  digestBuffer.push({ message, timestamp: Date.now() });
  if (!digestTimer) {
    digestTimer = setTimeout(flushDigest, DIGEST_INTERVAL_MS);
  }
}

/** 다이제스트 버퍼를 묶어 한 번에 전송 */
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

  const header = `📋 <b>[${entries.length}건 요약] ${startHH}:${startMM}~${hh}:${mm}</b>\n━━━━━━━━━━━━━━━━━━━━`;
  const body = entries.map(e => e.message).join('\n');
  const full = `${header}\n${body}\n━━━━━━━━━━━━━━━━━━━━`;

  await sendTelegramAlertRaw(full);
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

  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    };
    if (replyMarkup) payload.reply_markup = replyMarkup;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[Telegram] 전송 실패:', err.slice(0, 200));
      return;
    }
    const data = await res.json() as { result?: { message_id?: number } };
    return data.result?.message_id;
  } catch (e: unknown) {
    console.error('[Telegram] 오류:', e instanceof Error ? e.message : e);
  }
}

/**
 * Telegram Bot API를 통해 알림 전송 (우선순위 + 중복방지 + 다이제스트 지원)
 *
 * - CRITICAL: 항상 즉시 발송
 * - HIGH: 1분 쿨다운
 * - NORMAL: 5분 쿨다운 (기본)
 * - LOW: 다이제스트 버퍼에 축적 → 10분 단위 일괄 전송
 *
 * 기존 sendTelegramAlert(message) 시그니처 100% 호환.
 */
export async function sendTelegramAlert(
  message: string,
  opts?: TelegramAlertOptions,
): Promise<number | undefined> {
  // LOW 우선순위: 다이제스트 버퍼로 전환 (replyMarkup 있으면 즉시 발송)
  if (opts?.priority === 'LOW' && !opts?.replyMarkup) {
    if (shouldSendAlert(opts)) {
      addToDigest(message);
      recordAlertSent(opts);
    }
    return;
  }

  if (!shouldSendAlert(opts)) {
    console.log(`[Telegram] 쿨다운 중 — 발송 생략 (key=${opts?.dedupeKey})`);
    return;
  }

  const msgId = await sendTelegramAlertRaw(message, opts?.replyMarkup);
  recordAlertSent(opts);
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
