/**
 * globalErrorHandlers.ts — process 레벨 전역 에러 포획.
 *
 * Express 미들웨어(`globalErrorHandler`)는 `/api/*` 요청 처리 중 발생한 오류만 잡는다.
 * cron 콜백·orchestrator tick·setInterval 내부에서 터진 오류는 Node의 기본 경로를
 *타고 로그만 찍힌 뒤 소리 없이 사라진다. 본 모듈은 그런 조용한 죽음을 방지한다.
 *
 * 포획 즉시 T1 🚨 경보로 승격하여 참뮌이 실시간으로 인지하고, 에러 스택은
 * 이메일 에스컬레이션 루프가 재발송까지 담당한다. uncaughtException 발생 시
 * process를 죽이지 않는다 — Railway 자동 재시작이 거래 흐름을 더 크게 깰 수 있다.
 */
import { sendTelegramAlert, escapeHtml } from '../alerts/telegramClient.js';

let installed = false;

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  process.on('uncaughtException', (err: Error) => {
    console.error('[GlobalError] uncaughtException:', err);
    const stackHead = (err.stack ?? err.message ?? String(err)).split('\n').slice(0, 6).join('\n');
    sendTelegramAlert(
      `<b>[uncaughtException 감지]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${escapeHtml(err.message ?? String(err))}\n` +
      `<pre>${escapeHtml(stackHead)}</pre>\n` +
      `<i>프로세스는 계속 실행됨 — 원인 수정 후 재배포 권장</i>`,
      {
        priority: 'CRITICAL',
        tier: 'T1_ALARM',
        dedupeKey: `uncaught:${hashOf(err.message ?? String(err))}`,
        category: 'uncaught_exception',
      },
    ).catch(() => { /* 알림 실패는 로깅 이외 방법 없음 */ });
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[GlobalError] unhandledRejection:', err);
    const stackHead = (err.stack ?? err.message ?? String(err)).split('\n').slice(0, 6).join('\n');
    sendTelegramAlert(
      `<b>[unhandledRejection 감지]</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `${escapeHtml(err.message ?? String(err))}\n` +
      `<pre>${escapeHtml(stackHead)}</pre>\n` +
      `<i>Promise 체인에서 catch 누락 — 해당 모듈 리뷰 권장</i>`,
      {
        priority: 'CRITICAL',
        tier: 'T1_ALARM',
        dedupeKey: `unhandled:${hashOf(err.message ?? String(err))}`,
        category: 'unhandled_rejection',
      },
    ).catch(() => { /* noop */ });
  });

  console.log('[GlobalError] uncaughtException / unhandledRejection 핸들러 설치 완료');
}

/** 에러 메시지를 짧은 해시로 압축 — 쿨다운 dedupeKey 내 충돌 최소화. */
function hashOf(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).slice(0, 8);
}
