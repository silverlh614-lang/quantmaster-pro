// @responsibility 18:00 KST after-hours runtime debug snapshot 자동 capture cron (Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-003 — 17:00 → 18:00 격상).

import { scheduledJob } from './scheduleGuard.js';
import {
  captureRuntimeDebugSnapshot,
  isRuntimeDebugSnapshotCaptureDisabled,
} from '../replay/runtimeDebugSnapshotCapture.js';

const JOB_NAME = 'runtime_debug_snapshot_capture';

/**
 * cron entry — 매 평일 18:00 KST = UTC 09:00 (평일 1-5).
 *
 * 사용자 명시 capture 시간 (Patch-003 격상 — 17:00 → 18:00 으로 변경):
 *   - 18:00 KST — 장 종료(15:30) + 2.5h 후, scan + learning + reflection cron 모두 완료 후
 *     getLastScanSummary() / forensic / supply 영속 모두 안정화 시점
 *   - 17:00 KST 변경 사유: 일부 평일에 17:00 시점에 직전 scan 미완료로
 *     `getLastScanSummary() null — 부팅 후 첫 스캔 전 또는 cron 비활성` 경고 빈도 ↑
 *   - replay 에서 SELL_ONLY 의미 부여 금지 (sessionInterpretation='INTRADAY_REPLAY_EQUIVALENT')
 *   - 다음 거래일 09:00 개장 시 초기화 절대 금지 — 본 cron 만이 single latest overwrite 트리거
 *   - 금요일 snapshot 은 주말 유지 → 월요일 18:00 성공 시 overwrite
 *
 * ScheduleClass='TRADING_DAY_ONLY' — KRX 휴장일 자동 silent skip
 * (ADR-0045 정합 — 휴장일에는 capture 미실행, 직전 영업일 snapshot 그대로 유지).
 *
 * ENV `RUNTIME_DEBUG_SNAPSHOT_DISABLED=true` (ADR-0157 정확 비교) — cron 자체는 발동하지만
 * captureRuntimeDebugSnapshot 진입부에서 DISABLED skip + warnings 반환.
 *
 * Always-On Trading Kernel 정합 — capture throw 시 매매 흐름 절대 차단 안 함
 * (scheduleGuard 가 자체 격리 + 본 함수 try/catch 격리).
 *
 * ESM-safe — `await import()` 만 사용. 15:19 마켓-클로즈 시스템 (CommonJS require()
 * 사용으로 ESM 프로덕션 실패) 폐기 후 신설, 17:00 → 18:00 격상.
 */
export function registerRuntimeDebugSnapshotJob(): void {
  scheduledJob(
    '0 9 * * 1-5',
    'TRADING_DAY_ONLY',
    JOB_NAME,
    async () => {
      if (isRuntimeDebugSnapshotCaptureDisabled()) {
        console.log('[RuntimeDebugSnapshot] DISABLED via ENV — skip');
        return;
      }
      try {
        const result = await captureRuntimeDebugSnapshot();
        const snapshotId = result.snapshot?.snapshotId ?? 'n/a';
        const marketDate = result.snapshot?.marketDate ?? 'n/a';
        const missingNote =
          result.missingSections.length > 0
            ? ` missing=${result.missingSections.join(',')}`
            : '';
        const frozenCount = result.snapshot?.frozenSupplyRows?.length ?? 0;
        const adapterNote = result.snapshot?.snapshotReplayAdapter
          ? ` adapter=ON frozenRows=${frozenCount}`
          : ' adapter=OFF';
        console.log(
          `[RuntimeDebugSnapshot] status=${result.status} id=${snapshotId} marketDate=${marketDate}${adapterNote}${missingNote}`,
        );
        if (result.status === 'PARTIAL_CAPTURED' && result.warnings.length > 0) {
          for (const w of result.warnings.slice(0, 5)) console.warn(w);
        }
        if (result.status === 'PERSIST_FAILED' && result.warnings.length > 0) {
          for (const w of result.warnings.slice(0, 5)) console.warn(w);
        }
      } catch (err) {
        // try/catch 격리 — capture throw 가 cron 흐름 차단 안 함 (Always-On Trading Kernel 정합).
        console.warn(
          `[RuntimeDebugSnapshot] capture 실패: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
    { timezone: 'UTC' },
  );
}
