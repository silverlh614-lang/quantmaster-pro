/**
 * @responsibility 유지보수 cron(스캔 트레이스 정리 · 일일 백업 · 이중 기록 Reconciliation · 주간 KRX 섹터맵 갱신)을 등록한다.
 */
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { cleanupOldTraceFiles } from '../trading/scanTracer.js';
import { runDailyBackup } from '../persistence/dailyBackup.js';
import { runBackupCeremony } from '../persistence/dailyBackupCeremony.js';
import { runDailyReconciliation, reconcileKisVsShadow } from '../trading/reconciliationEngine.js';
import { resetDataCompleteness } from '../screener/dataCompletenessTracker.js';
import { updateKrxSectorMap, type UpdateResult } from '../screener/sectorMapUpdater.js';
import { migrateAttributionRecords } from '../persistence/attributionRepo.js';
import { DATA_DIR } from '../persistence/paths.js';

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

  // KIS 실잔고 vs Shadow DB 정합성 — 15분 간격, 장중 구간 자동 스킵.
  // exitEngine 의 PROVISIONAL fill 선반영이 실제 KIS 잔고와 괴리되는 구간을 조기에
  // 포착한다. KIS 잔고 조회 허용 시간대(KST 07:00~15:59)에서만 실행되며,
  // reconcileKisVsShadow 내부가 SHADOW 모드·점검 시간대를 자동 스킵한다.
  //
  // cron 표현식: 0,15,30,45 * * * * — 매 15분.
  cron.schedule('*/15 * * * *', async () => {
    try {
      await reconcileKisVsShadow();
    } catch (e) {
      console.error('[KisShadowReconcile] cron 실행 오류:', e);
    }
  }, { timezone: 'UTC' });

  // KRX 전종목 섹터맵 갱신 — 매주 월요일 KST 03:00 (UTC 18:00 일요일).
  // data/krx-sector-map.json 을 원자적으로 교체하여 Stage 2 섹터 커버리지를
  // 100%로 유지한다. KRX 장애(HTTP 400/500)시 sectorMapUpdater 내부 폴백 체인
  // (trdDd 역추적 → Yahoo → Gemini) 이 자동 작동하여 최대 커버리지를 보전한다.
  // 폴백 + 기존 파일로도 임계치 미달 시에만 Telegram 경고.
  cron.schedule('0 18 * * 0', () => {
    void runSectorMapUpdate('weekly');
  }, { timezone: 'UTC' });

  // 일일 재시도 — 평일 KST 04:00 (UTC 19:00 전일). 주간 실패/폴백 진입 시에만 발화.
  // 정상(주간) 갱신이 성공한 뒤에는 meta.json 의 updatedAt 나이로 스킵한다.
  cron.schedule('0 19 * * 0-4', () => {
    if (shouldRetrySectorMap()) {
      void runSectorMapUpdate('daily-retry');
    }
  }, { timezone: 'UTC' });
}

// ── KRX 섹터맵 갱신 헬퍼 ─────────────────────────────────────────────────────

const SECTOR_MAP_META_PATH = path.join(DATA_DIR, 'krx-sector-map.meta.json');
// 마지막 갱신으로부터 이 시간 내면 일일 재시도 스킵 — 정상 운영 시엔 주간 1회로 충분.
const SECTOR_MAP_FRESH_MS = 36 * 60 * 60 * 1000; // 36시간

/** 일일 재시도 cron 이 실제로 갱신을 돌릴지 결정. meta 없음/오래됨/carry-over 이면 true. */
function shouldRetrySectorMap(): boolean {
  try {
    if (!fs.existsSync(SECTOR_MAP_META_PATH)) return true;
    const raw   = fs.readFileSync(SECTOR_MAP_META_PATH, 'utf-8');
    const meta  = JSON.parse(raw) as { updatedAt?: string; source?: string };
    const ageMs = Date.now() - new Date(meta.updatedAt ?? 0).getTime();
    // carry-over 는 항상 재시도 — 데이터가 아예 갱신되지 않은 상태.
    if (meta.source === 'carry-over') return true;
    return ageMs > SECTOR_MAP_FRESH_MS;
  } catch {
    // meta 읽기 실패는 보수적으로 재시도.
    return true;
  }
}

/** 섹터맵 갱신 실행 + Telegram 알림. schedule 라벨은 주간/일일 구분용. */
async function runSectorMapUpdate(schedule: 'weekly' | 'daily-retry'): Promise<void> {
  const scheduleLabel = schedule === 'weekly' ? '주간' : '일일 재시도';
  try {
    const result: UpdateResult = await updateKrxSectorMap();
    console.log(
      `[SectorMapUpdater] ✅ ${scheduleLabel} ${result.count}개 갱신 ` +
      `(source=${result.source}, trdDd=${result.trdDd})`,
    );

    // 폴백으로 갱신된 경우 — 성공이지만 원본 소스가 장애 중임을 알린다.
    if (result.source !== 'KRX') {
      const diagTail = result.diagnostics.slice(-4).join('\n• ');
      await sendTelegramAlert(
        `ℹ️ <b>[KRX 섹터맵 — 폴백 갱신 성공]</b>\n` +
        `Source: <code>${result.source}</code>\n` +
        `종목 수: ${result.count}\n` +
        `KRX 본선 장애 중 — Yahoo/Gemini 폴백으로 커버리지 보전.\n` +
        `진단:\n• ${diagTail}`,
        { priority: 'LOW', dedupeKey: 'krx_sector_map_fallback_ok', cooldownMs: 12 * 60 * 60 * 1000 },
      ).catch(console.error);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[SectorMapUpdater] ${scheduleLabel} 갱신 실패:`, msg);
    const nextRetry = schedule === 'weekly'
      ? '내일 04:00 일일 재시도 예정'
      : '다음 주 월요일 03:00 재시도 예정';
    await sendTelegramAlert(
      `⚠️ <b>[KRX 섹터맵 갱신 실패 — ${scheduleLabel}]</b>\n${msg}\n` +
      `기존 파일이 유지됩니다. ${nextRetry}.`,
      { priority: 'NORMAL', dedupeKey: 'krx_sector_map_fail', cooldownMs: 6 * 60 * 60 * 1000 },
    ).catch(console.error);
  }
}
