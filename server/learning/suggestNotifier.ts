/**
 * @responsibility 학습 모듈의 임계 충족 suggest 알림을 Telegram 으로 송출하고 24h dedupe 로 중복을 차단한다.
 */

import { sendTelegramAlert } from '../alerts/telegramClient.js';

export interface SuggestPayload {
  /** 모듈 구분자. dedupe 버킷 키이기도 하다. */
  moduleKey: 'counterfactual' | 'ledger' | 'kellySurface' | 'regimeCoverage';
  /** 24h dedupe 키 — 날짜·대상 cell 이 들어간 canonical string. */
  signature: string;
  /** Telegram 메시지 제목 (이모지 포함 가능). */
  title: string;
  /** 임계 근거 (샘플수·CI·%p 비교 등). */
  rationale: string;
  /** 현재 운용 파라미터 문자열. */
  currentValue: string;
  /** 권고 파라미터 문자열. */
  suggestedValue: string;
  /** 발동 임계 표현 (e.g. "샘플≥30 & ratio≥0.8"). */
  threshold: string;
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/** signature → lastSentAt (epoch ms). 프로세스 재시작 시 초기화 (MVP). */
const lastSent = new Map<string, number>();

/** 환경변수 `LEARNING_SUGGEST_ENABLED='false'` 만 disable. 기본 on. */
export function isSuggestEnabled(): boolean {
  return process.env.LEARNING_SUGGEST_ENABLED !== 'false';
}

/**
 * Suggest 알림을 Telegram 으로 송출.
 *  - env 플래그가 off 면 즉시 false.
 *  - 동일 signature 가 24h 내 재호출되면 warn 로그 후 false.
 *  - 송출 성공 시 true.
 */
export async function sendSuggestAlert(payload: SuggestPayload): Promise<boolean> {
  if (!isSuggestEnabled()) return false;

  const now = Date.now();
  const prev = lastSent.get(payload.signature);
  if (typeof prev === 'number' && now - prev < DEDUPE_WINDOW_MS) {
    console.warn(
      `[suggestNotifier] dedupe hit — signature=${payload.signature} age=${Math.round((now - prev) / 60000)}m`,
    );
    return false;
  }

  const message =
    `💡 <b>학습 모듈 Suggest — ${payload.moduleKey}</b>\n` +
    `${payload.title}\n` +
    `근거: ${payload.rationale}\n` +
    `현재: ${payload.currentValue}\n` +
    `권고: ${payload.suggestedValue}\n` +
    `임계: ${payload.threshold}\n` +
    `반영: 수동 (/accept-suggest 는 Phase 2)`;

  try {
    await sendTelegramAlert(message, {
      priority: 'NORMAL',
      category: 'learning',
      dedupeKey: `suggest_${payload.moduleKey}_${payload.signature}`,
      cooldownMs: DEDUPE_WINDOW_MS,
    });
  } catch (e) {
    console.warn('[suggestNotifier] Telegram 송출 실패:', e instanceof Error ? e.message : String(e));
    return false;
  }

  lastSent.set(payload.signature, now);
  return true;
}

/**
 * 테스트 편의용 dedupe 맵 초기화. 프로덕션에서는 호출하지 않는다.
 */
export function __resetSuggestDedupeForTests(): void {
  lastSent.clear();
}
