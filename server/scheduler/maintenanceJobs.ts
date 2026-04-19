/**
 * @responsibility 유지보수 cron(스캔 트레이스 정리 · 일일 백업 · 이중 기록 Reconciliation · 주간 KRX 섹터맵 갱신)을 등록한다.
 */
import cron from 'node-cron';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { cleanupOldTraceFiles } from '../trading/scanTracer.js';
import { runDailyBackup } from '../persistence/dailyBackup.js';
import { runBackupCeremony } from '../persistence/dailyBackupCeremony.js';
import { runDailyReconciliation } from '../trading/reconciliationEngine.js';
import { resetDataCompleteness } from '../screener/dataCompletenessTracker.js';
import { updateKrxSectorMap } from '../screener/sectorMapUpdater.js';
import { migrateAttributionRecords } from '../persistence/attributionRepo.js';

const BACKUP_RETENTION_DAYS = 7;

export function registerMaintenanceJobs(): void {
  // Phase 1 B5: 부팅 시점에 한 번 귀인 레코드 스키마 마이그레이션.
  // 레거시(v0) 레코드를 현행 v1 스키마로 승격하거나, 불완전 레코드는 집계에서
  // 자동 격리한다. 월말 캘리브레이션 NaN 전염을 사전 차단.
  try {
    const { migrated, quarantined, total } = migrateAttributionRecords();
    if (migrated > 0 || quarantined > 0) {
      console.log(
        `[AttributionMigration] total=${total} migrated=${migrated} quarantined=${quarantined}`,
      );
    }
  } catch (e) {
    console.error('[AttributionMigration] 부팅 마이그레이션 실패:', e);
  }

  // 스캔 트레이스 파일 정리 — 매주 일요일 KST 03:00 (UTC 18:00 토요일).
  // 7일 이상 된 파일 삭제.
  cron.schedule('0 18 * * 6', () => {
    cleanupOldTraceFiles();
  }, { timezone: 'UTC' });

  // Phase 2차 C1 — Daily Backup Ceremony: 매일 KST 01:00 (UTC 16:00 전일).
  // DATA_DIR 의 모든 *.json 을 snapshots/YYYY-MM-DD/ 로 복사 — "어제 자정" 상태
  // 복원의 표준 기준점. 7일 초과분은 자동 삭제.
  cron.schedule('0 16 * * *', async () => {
    try {
      const r = runBackupCeremony(7);
      console.log(
        `[BackupCeremony] ✅ ${r.copied.length}개 파일, ` +
        `${(r.totalBytes / 1024).toFixed(1)}KB → ${r.snapshotDir}` +
        (r.pruned.length > 0 ? ` | 삭제 ${r.pruned.length}일치` : ''),
      );
    } catch (e) {
      console.error('[BackupCeremony] 실패:', e);
      await sendTelegramAlert(
        `⚠️ <b>[Backup Ceremony 실패]</b> ${e instanceof Error ? e.message : String(e)}`,
        { priority: 'HIGH', dedupeKey: 'backup_ceremony_fail' },
      ).catch(console.error);
    }
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

  // KRX 전종목 섹터맵 갱신 — 매주 월요일 KST 03:00 (UTC 18:00 일요일).
  // data/krx-sector-map.json 을 원자적으로 교체하여 Stage 2 섹터 커버리지를
  // 100%로 유지한다. Gemini 섹터 추론이 필요 없어져 토큰 비용과 '미분류'로 인한
  // sectorBonus 손실을 동시에 제거. 실패 시 기존 파일 유지 + Telegram 경고.
  cron.schedule('0 18 * * 0', async () => {
    try {
      const result = await updateKrxSectorMap();
      console.log(`[SectorMapUpdater] ✅ ${result.count}개 종목 갱신 (trdDd=${result.trdDd})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[SectorMapUpdater] 갱신 실패:', msg);
      await sendTelegramAlert(
        `⚠️ <b>[KRX 섹터맵 갱신 실패]</b>\n${msg}\n기존 파일이 유지됩니다. 다음 주 월요일 03:00에 재시도합니다.`,
        { priority: 'NORMAL', dedupeKey: 'krx_sector_map_fail', cooldownMs: 6 * 60 * 60 * 1000 },
      ).catch(console.error);
    }
  }, { timezone: 'UTC' });
}
