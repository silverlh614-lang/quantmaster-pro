// @responsibility 15:19 KST market-close replay snapshot 자동 capture cron (Patch-MARKET-CLOSE-SNAPSHOT-001).

import { scheduledJob } from './scheduleGuard.js';
import {
  captureMarketCloseSnapshot,
  isMarketCloseSnapshotCaptureDisabled,
} from '../replay/marketCloseSnapshotCapture.js';

const JOB_NAME = 'market_close_snapshot_capture';

/**
 * cron entry — 매 평일 15:19 KST = UTC 06:19 (평일 1-5).
 *
 * 사용자 명시 capture 시간 (절대 변경 금지):
 *   - 15:19 KST — SELL_ONLY 윈도우 (15:21~15:30) 직전, 매수 허용 정규장 후반
 *   - 다음 거래일 개장 시 초기화 안 함 (snapshot 은 다음 거래일 09:00 ~ 15:19 유지)
 *   - 다음 거래일 15:19 capture 가 이전 일자 cleanup (intradaySnapshotRepo 위임)
 *
 * ScheduleClass='TRADING_DAY_ONLY' — KRX 휴장일 자동 silent skip
 * (ADR-0045 정합 — 휴장일에는 capture 미실행, 직전 영업일 snapshot 그대로 유지).
 *
 * ENV `MARKET_CLOSE_SNAPSHOT_DISABLED=true` (ADR-0157 정확 비교) — cron 자체는 발동하지만
 * captureMarketCloseSnapshot 진입부에서 DISABLED skip + warnings 반환.
 *
 * Capture throw 시 매매 흐름 보호 — cron 콜백이 try/catch 격리 (scheduleGuard 가 자체 격리).
 */
export function registerMarketCloseSnapshotJob(): void {
  scheduledJob(
    '19 6 * * 1-5',
    'TRADING_DAY_ONLY',
    JOB_NAME,
    async () => {
      if (isMarketCloseSnapshotCaptureDisabled()) {
        console.log('[MarketCloseSnapshot] DISABLED via ENV — skip');
        return;
      }
      try {
        const result = await captureMarketCloseSnapshot();
        const partial = result.status === 'PARTIAL_CAPTURED';
        const snapshotId = result.snapshot?.snapshotId ?? 'n/a';
        const missingNote =
          result.missingSections.length > 0
            ? ` missing=${result.missingSections.join(',')}`
            : '';
        console.log(
          `[MarketCloseSnapshot] status=${result.status} id=${snapshotId} marketDate=${
            result.snapshot?.marketDate ?? 'n/a'
          } rev=${result.snapshot?.revision ?? '?'}${missingNote}`,
        );
        if (partial && result.warnings.length > 0) {
          for (const w of result.warnings.slice(0, 5)) console.warn(w);
        }
      } catch (err) {
        // try/catch 격리 — capture throw 가 cron 흐름 차단 안 함 (Always-On Trading Kernel 정합).
        console.warn(
          `[MarketCloseSnapshot] capture 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    { timezone: 'UTC' },
  );
}
