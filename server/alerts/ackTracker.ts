// @responsibility ackTracker 알림 모듈
/**
 * ackTracker.ts — T1 경보의 "확인" 폐루프 추적.
 *
 * 참뮌 스펙 #4: Tier 1 경보에 [확인] 인라인 버튼 필수 첨부. 미확인 시
 *   - 30분 후 재발송 1회
 *   - 다시 30분 지나도 미확인이면 이메일 에스컬레이션
 *   - 확인 눌릴 때까지 "보지 못한 것"으로 간주
 *
 * 재시작 후에도 대기 상태가 복원되도록 파일 영속화. 크론에서 주기적으로
 * `sweepPendingAcks()` 호출 → 재발송·에스컬레이션 트리거.
 */
import fs from 'fs';
import { T1_ACK_STATE_FILE, ensureDataDir } from '../persistence/paths.js';
import { sendTelegramAlert, answerCallbackQuery, editMessageText } from './telegramClient.js';
// Phase 5-⑩: 이메일 에스컬레이션 제거 — Telegram 재발송으로만 운용.

export interface T1AckEntry {
  ackId: string;
  /** 최초 발송된 Telegram message_id — 편집/재발송 기록용. */
  messageId: number;
  /** 편집 표시용 간략 요약 — 메시지 본문 전체 보관 대신 첫 줄 + 티어. */
  summary: string;
  sentAt: number;
  /** 지금까지 재발송한 횟수 (0 → 1 → 종료). */
  resendCount: number;
  /** 이메일 에스컬레이션 발송 여부. */
  escalated: boolean;
  category?: string;
  dedupeKey?: string;
}

const RESEND_AFTER_MS   = 30 * 60 * 1000;  // 30분
const ESCALATE_AFTER_MS = 60 * 60 * 1000;  // 60분 (= 재발송 후 30분)

let pending: Record<string, T1AckEntry> = loadPending();

function loadPending(): Record<string, T1AckEntry> {
  try {
    if (!fs.existsSync(T1_ACK_STATE_FILE)) return {};
    const raw = fs.readFileSync(T1_ACK_STATE_FILE, 'utf8');
    if (!raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e: unknown) {
    console.warn('[AckTracker] 상태 로드 실패:', e instanceof Error ? e.message : e);
    return {};
  }
}

function savePending(): void {
  try {
    ensureDataDir();
    fs.writeFileSync(T1_ACK_STATE_FILE, JSON.stringify(pending, null, 2), 'utf8');
  } catch (e: unknown) {
    console.warn('[AckTracker] 상태 저장 실패:', e instanceof Error ? e.message : e);
  }
}

/** T1 경보 전송 직후 ACK 대기 엔트리를 등록한다. */
export function registerPendingAck(entry: Omit<T1AckEntry, 'resendCount' | 'escalated'>): void {
  pending[entry.ackId] = { ...entry, resendCount: 0, escalated: false };
  savePending();
}

/** 사용자가 [확인] 버튼을 눌렀을 때 호출 — 폐루프 완료 처리. */
export async function resolveAck(
  ackId: string,
  action: 'CONFIRMED' | 'RESPONDING',
  callbackQueryId: string,
): Promise<boolean> {
  const entry = pending[ackId];
  if (!entry) {
    await answerCallbackQuery(callbackQueryId, '이미 처리되었거나 만료된 경보입니다.');
    return false;
  }
  delete pending[ackId];
  savePending();

  const label = action === 'CONFIRMED' ? '✅ 확인 완료' : '🔥 긴급 대응중';
  await editMessageText(
    entry.messageId,
    `${label} <i>(${new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })})</i>\n` +
    `<b>${entry.summary}</b>`,
  ).catch(() => { /* 편집 실패는 로깅만 */ });
  await answerCallbackQuery(callbackQueryId, label);
  return true;
}

/**
 * 콜백 데이터 라우팅 엔드포인트 — webhookHandler에서 호출.
 *
 * callback_data 형식: `t1_ack:<ackId>:<CONFIRMED|RESPONDING>`
 */
export async function handleT1AckCallback(
  callbackQueryId: string,
  data: string,
): Promise<boolean> {
  if (!data.startsWith('t1_ack:')) return false;
  const parts = data.split(':');
  const ackId = parts[1];
  const action = parts[2] === 'RESPONDING' ? 'RESPONDING' : 'CONFIRMED';
  if (!ackId) {
    await answerCallbackQuery(callbackQueryId, '잘못된 ACK 요청');
    return true;
  }
  await resolveAck(ackId, action, callbackQueryId);
  return true;
}

/**
 * 주기 스캔 — 미확인 ACK를 재발송 또는 이메일 에스컬레이션한다.
 * 스케줄러가 5분 간격으로 호출.
 */
export async function sweepPendingAcks(now: number = Date.now()): Promise<void> {
  const list = Object.values(pending);
  for (const entry of list) {
    const age = now - entry.sentAt;

    // 1차: 30분 경과 + 아직 재발송 안 했으면 재발송
    if (age >= RESEND_AFTER_MS && entry.resendCount === 0) {
      await resendAckAlert(entry).catch(e =>
        console.error('[AckTracker] 재발송 실패:', e instanceof Error ? e.message : e));
      entry.resendCount += 1;
      savePending();
      continue;
    }

    // Phase 5-⑩: 60분 경과 이메일 에스컬레이션 제거 — Telegram CRITICAL 재발송만 유지.
    if (age >= ESCALATE_AFTER_MS && !entry.escalated) {
      await escalateViaTelegram(entry).catch(e =>
        console.error('[AckTracker] 에스컬레이션 실패:', e instanceof Error ? e.message : e));
      entry.escalated = true;
      savePending();
    }
  }
}

async function resendAckAlert(entry: T1AckEntry): Promise<void> {
  // 재발송은 동일 dedupeKey를 쓰되 쿨다운 우회를 위해 customKey 를 분기.
  const text =
    `<b>[재발송 — 미확인 T1 경보]</b>\n` +
    `원경보: ${entry.summary}\n` +
    `발송 시각: ${new Date(entry.sentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n` +
    `<i>30분 경과 미확인 → 자동 재발송. 미확인 시 30분 후 Telegram CRITICAL 에스컬레이션.</i>`;

  await sendTelegramAlert(text, {
    priority: 'CRITICAL',
    tier: 'T1_ALARM',
    dedupeKey: `t1_ack_resend:${entry.ackId}`,
    category: 'ack_resend',
    replyMarkup: buildAckReplyMarkup(entry.ackId),
  });
}

async function escalateViaTelegram(entry: T1AckEntry): Promise<void> {
  await sendTelegramAlert(
    `🚨 <b>[T1 경보 60분 미확인 — 에스컬레이션]</b>\n` +
    `요약: ${entry.summary}\n` +
    `최초 발송: ${new Date(entry.sentAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}\n` +
    `카테고리: ${entry.category ?? 'uncategorized'}\n\n` +
    `<i>60분 이상 미확인 — 즉시 [확인] 또는 [긴급 대응중] 버튼으로 루프를 닫아 주세요.</i>`,
    {
      priority: 'CRITICAL',
      tier: 'T1_ALARM',
      dedupeKey: `t1_ack_escalate:${entry.ackId}`,
      category: 'ack_escalate',
      replyMarkup: buildAckReplyMarkup(entry.ackId),
    },
  );
}

/** [✅ 확인] [🔥 긴급 대응중] 2-택 ACK 버튼 셋. */
export function buildAckReplyMarkup(ackId: string): Record<string, unknown> {
  return {
    inline_keyboard: [[
      { text: '✅ 확인', callback_data: `t1_ack:${ackId}:CONFIRMED` },
      { text: '🔥 긴급 대응중', callback_data: `t1_ack:${ackId}:RESPONDING` },
    ]],
  };
}

/** UI/대시보드 노출용 — 현재 미확인 ACK 개수. */
export function countPendingAcks(): number {
  return Object.keys(pending).length;
}

/** 테스트·진단용 엔트리 목록 조회. */
export function listPendingAcks(): T1AckEntry[] {
  return Object.values(pending);
}
