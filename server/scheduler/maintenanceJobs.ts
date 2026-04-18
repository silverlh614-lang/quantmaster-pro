/**
 * @responsibility 유지보수 cron(스캔 트레이스 정리 · 일일 백업 · 이중 기록 Reconciliation)을 등록한다.
 */
import cron from 'node-cron';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { cleanupOldTraceFiles } from '../trading/scanTracer.js';
import { runDailyBackup } from '../persistence/dailyBackup.js';
import { runDailyReconciliation } from '../trading/reconciliationEngine.js';
import { resetDataCompleteness } from '../screener/dataCompletenessTracker.js';

const BACKUP_RETENTION_DAYS = 7;

export function registerMaintenanceJobs(): void {
  // 스캔 트레이스 파일 정리 — 매주 일요일 KST 03:00 (UTC 18:00 토요일).
  // 7일 이상 된 파일 삭제.
  cron.schedule('0 18 * * 6', () => {
    cleanupOldTraceFiles();
  }, { timezone: 'UTC' });

  // 일일 데이터 백업 — 매일 KST 03:00 (UTC 18:00).
  // Railway Volume의 shadow-trades·watchlist·dart·fss 등 주요 JSON을
  // /backups/YYYY-MM-DD/ 로 복사. 7일 초과 백업은 자동 삭제 (로테이션).
  cron.schedule('0 18 * * *', async () => {
    try {
      const result = runDailyBackup(BACKUP_RETENTION_DAYS);
      console.log(
        `[Backup] ✅ ${result.copied.length}개 파일 백업 → ${result.backupDir}` +
        (result.pruned.length > 0 ? ` | 삭제 ${result.pruned.length}일치` : '') +
        (result.missing.length > 0 ? ` | 누락 ${result.missing.length}건` : ''),
      );
    } catch (e) {
      console.error('[Backup] 일일 백업 실패:', e);
      await sendTelegramAlert(
        `🚨 <b>[일일 백업 실패]</b>\n오류: ${e instanceof Error ? e.message : String(e)}`,
        { priority: 'HIGH', dedupeKey: 'daily_backup_fail' },
      ).catch(console.error);
    }
  }, { timezone: 'UTC' });

  // 데이터 완성도 트래커 리셋 — 평일 KST 08:00 (UTC 23:00 일~목).
  // 장 시작 전 전일 표본을 지워 새로운 장의 데이터 빈곤 여부만 측정하도록 한다.
  cron.schedule('0 23 * * 0-4', () => {
    try { resetDataCompleteness(); console.log('[DataCompleteness] 일일 리셋 완료 (08:00 KST)'); }
    catch (e) { console.error('[DataCompleteness] 리셋 실패:', e); }
  }, { timezone: 'UTC' });

  // 이중 기록 Reconciliation — 매일 KST 23:30 (UTC 14:30).
  // shadow-log ↔ TradeEvent ↔ shadow-trades 정합성 자동 대조.
  // 불일치 > 임계치 시 Critical 텔레그램 알림 + DATA_INTEGRITY_BLOCKED 게이팅.
  cron.schedule('30 14 * * *', async () => {
    try {
      await runDailyReconciliation();
    } catch (e) {
      console.error('[Reconciliation] cron 실행 오류:', e);
    }
  }, { timezone: 'UTC' });
}
