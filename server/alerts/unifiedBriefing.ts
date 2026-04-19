/**
 * unifiedBriefing.ts — 동일 시간대 여러 리포트를 1건으로 병합 발송한다.
 *
 * 참뮌 스펙 #5:
 *   08:30 장전 + 08:50 워치리스트 + 09:00 MHS → 08:45 "아침 브리핑" 1건
 *   11:30 + 12:00 + 14:00 장중 점검 3건       → 12:30 "정오 점검" 1건
 *   15:35 + 15:40 + 16:00 마감 3건            → 16:00 "장마감 종합" 1건
 *
 * 기존 send 함수들을 건드리지 않기 위해 "capture 모드" 를 도입. beginUnifiedBriefing
 * 호출 중에는 sendTelegramAlert가 메시지를 버퍼에 적재하고, endUnifiedBriefing이
 * 섹션 구분자로 조립하여 단일 메시지로 발송한다.
 *
 * T1 ALARM / CRITICAL 은 캡처 우회 — 긴급 경보가 브리핑에 갇혀 지연되는 사고 방지.
 */
import type { TelegramAlertOptions } from './telegramClient.js';

export interface UnifiedBriefingSession {
  header: string;
  tier: 'T2_REPORT' | 'T3_DIGEST';
  startedAt: number;
  /** 각 피보고 함수의 메시지를 섹션별로 누적 */
  sections: { from: string; body: string }[];
}

let current: UnifiedBriefingSession | null = null;

export function isUnifiedBriefingActive(): boolean {
  return current !== null;
}

/**
 * 캡처 모드 개시. 이후 sendTelegramAlert 호출은 버퍼로 흡수된다.
 * T1/CRITICAL 은 아래 `shouldBypassCapture()` 로 즉시 발송.
 */
export function beginUnifiedBriefing(header: string, tier: 'T2_REPORT' | 'T3_DIGEST' = 'T2_REPORT'): void {
  if (current) {
    console.warn('[UnifiedBriefing] 이미 활성 세션이 있어 새 브리핑으로 덮어쓴다:', header);
  }
  current = { header, tier, startedAt: Date.now(), sections: [] };
}

/** 캡처 중 메시지 1건 흡수. 호출자는 sendTelegramAlert 내부에서 사용. */
export function captureToUnifiedBriefing(body: string, from: string): boolean {
  if (!current) return false;
  current.sections.push({ from, body });
  return true;
}

/**
 * T1/CRITICAL은 브리핑 창을 우회해 즉시 발송 — 긴급 경보가 지연되면 안 된다.
 */
export function shouldBypassCapture(opts?: TelegramAlertOptions): boolean {
  if (opts?.tier === 'T1_ALARM') return true;
  if (opts?.priority === 'CRITICAL') return true;
  return false;
}

/**
 * 세션 종료 — 버퍼를 하나의 composite 메시지로 조립해 반환.
 * 실제 발송은 호출자(cron 래퍼)가 sendTelegramAlert 로 처리한다.
 * 세션이 없거나 섹션이 비면 null.
 */
export function endUnifiedBriefing(): { message: string; tier: 'T2_REPORT' | 'T3_DIGEST' } | null {
  const session = current;
  current = null;
  if (!session || session.sections.length === 0) return null;

  const divider = '━━━━━━━━━━━━━━━━━━━━';
  const parts: string[] = [`<b>${session.header}</b>`, divider];
  for (let i = 0; i < session.sections.length; i++) {
    const s = session.sections[i];
    parts.push(s.body.trim());
    if (i < session.sections.length - 1) parts.push(divider);
  }
  parts.push(divider);
  parts.push(`<i>${session.sections.length}개 섹션 통합 · ${formatKst(session.startedAt)}</i>`);
  return { message: parts.join('\n'), tier: session.tier };
}

function formatKst(ms: number): string {
  const kst = new Date(ms + 9 * 60 * 60 * 1000);
  const hh = kst.getUTCHours().toString().padStart(2, '0');
  const mm = kst.getUTCMinutes().toString().padStart(2, '0');
  return `${hh}:${mm} KST`;
}
