/**
 * @responsibility 유지보수 cron(스캔 트레이스 정리 · 일일 백업 · 이중 기록 Reconciliation · 주간 KRX 섹터맵 갱신)을 등록한다.
 */
import fs from 'fs';
import path from 'path';
import { scheduledJob } from './scheduleGuard.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { cleanupOldTraceFiles } from '../trading/scanTracer.js';
import { runDailyBackup } from '../persistence/dailyBackup.js';
import { runBackupCeremony } from '../persistence/dailyBackupCeremony.js';
import { runDailyReconciliation, reconcileKisVsShadow } from '../trading/reconciliationEngine.js';
import { reconcileShadowQuantities } from '../persistence/shadowAccountRepo.js';
import { resetDataCompleteness } from '../screener/dataCompletenessTracker.js';
import { updateKrxSectorMap, type UpdateResult } from '../screener/sectorMapUpdater.js';
import { migrateAttributionRecords } from '../persistence/attributionRepo.js';
import { DATA_DIR } from '../persistence/paths.js';
// PR-B-2: scheduledJob 래퍼가 wrapJob 메트릭 기록을 흡수.
import { reloadKrxHolidaySet } from '../trading/krxHolidays.js';
import { runKrxHolidayAudit } from '../trading/krxHolidayAudit.js';

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

  // PR-D ADR-0045 — 부팅 시 KRX 휴장일 patch 1회 reload.
  // 정적 STATIC_HOLIDAYS + data/krx-holiday-patch.json 합산 → 활성 KRX_HOLIDAYS Set.
  try {
    reloadKrxHolidaySet();
  } catch (e) {
    console.error('[KrxHolidays] 부팅 patch reload 실패:', e);
  }

  // 스캔 트레이스 파일 정리 — 매주 일요일 KST 03:00 (UTC 18:00 토요일).
  // PR-B-2: WEEKEND_MAINTENANCE — 일요일 새벽 정비 작업.
  scheduledJob('0 18 * * 6', 'WEEKEND_MAINTENANCE', 'cleanup_trace_files', () => {
    cleanupOldTraceFiles();
  }, { timezone: 'UTC' });

  // Daily Backup Ceremony — 매일 KST 01:00 (UTC 16:00 전일).
  // PR-B-2: ALWAYS_ON — 백업은 365일 무중단.
  scheduledJob('0 16 * * *', 'ALWAYS_ON', 'backup_ceremony', async () => {
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
  // PR-B-2: ALWAYS_ON — 백업은 365일 무중단.
  scheduledJob('0 18 * * *', 'ALWAYS_ON', 'daily_backup', async () => {
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
  // PR-B-2: TRADING_DAY_ONLY — 장 시작 전 리셋이라 KRX 공휴일 무의미.
  scheduledJob('0 23 * * 0-4', 'TRADING_DAY_ONLY', 'data_completeness_reset', () => {
    try { resetDataCompleteness(); console.log('[DataCompleteness] 일일 리셋 완료 (08:00 KST)'); }
    catch (e) { console.error('[DataCompleteness] 리셋 실패:', e); }
  }, { timezone: 'UTC' });

  // 이중 기록 Reconciliation — 평일 KST 23:30 (UTC 14:30, 월~금).
  //
  // 긴급패치(2026-04-26): TRADING_DAY_ONLY 로 격하 + cron 평일 가드 동시 적용.
  // 본 함수의 핵심 로직(loadTradeEventCloses) 이 "오늘 KST 발생한 FULL_SELL" 만 카운트해야
  // 하는데, B(tradeEventCloses)는 yyyymm 월 전체를 읽고 A·C 는 dateKst 필터를 적용해
  // 구조적 날짜 비대칭이 존재. 비영업일에 실행하면 반드시 A=0, B>0 → mismatch 폭발.
  // 1차 방어: TRADING_DAY_ONLY 로 KRX 공휴일·주말 자동 스킵. 2차 방어: loadTradeEventCloses
  // 가 dateKst 필터링 적용 (별도 패치). 한도 위반 알림은 dedupeKey 도 안정 키로 변경.
  scheduledJob('30 14 * * 1-5', 'TRADING_DAY_ONLY', 'daily_reconcile',
    () => runDailyReconciliation(), { timezone: 'UTC' });

  // 장 마감 후 KST 16:05 (UTC 07:05) — fills↔quantity 자동 드라이런.
  // PR-B-2: TRADING_DAY_ONLY — 평일 장 마감 후 정합성 검사.
  scheduledJob('5 7 * * 1-5', 'TRADING_DAY_ONLY', 'shadow_qty_dryrun_broadcast', async () => {
    try {
      const result = reconcileShadowQuantities(undefined, { dryRun: true });
      if (result.fixed === 0) {
        console.log('[ShadowQtyDryRun] drift 없음 — 장부 정합성 정상');
        return;
      }
      const sample = result.details.slice(0, 5).map(d =>
        `• ${d.stockName ?? ''}(${d.stockCode}): ${d.before.qty}주/${d.before.status} → ${d.after.qty}주/${d.after.status}`,
      );
      const more = result.details.length > 5 ? `\n...외 ${result.details.length - 5}건` : '';
      await sendTelegramAlert(
        `🔍 <b>[16:05 Reconcile 점검 — DRY-RUN]</b>\n` +
        `검사 ${result.checked}건 | 교정 후보 <b>${result.fixed}건</b>\n` +
        `${sample.join('\n')}${more}\n\n` +
        `💡 적용하려면: <code>/reconcile apply</code>`,
        { priority: 'HIGH', dedupeKey: 'shadow-dryrun-broadcast', cooldownMs: 60 * 60 * 1000 },
      ).catch(console.error);
    } catch (e) {
      console.error('[ShadowQtyDryRun] 실행 오류:', e);
    }
  }, { timezone: 'UTC' });

  // KIS 실잔고 vs Shadow DB 정합성 — 15분 간격, 장중 구간 자동 스킵.
  // PR-B-2: ALWAYS_ON — reconcileKisVsShadow 내부가 SHADOW 모드·점검 시간대 자동 스킵.
  scheduledJob('*/15 * * * *', 'ALWAYS_ON', 'kis_shadow_reconcile',
    () => reconcileKisVsShadow(), { timezone: 'UTC' });

  // KRX 전종목 섹터맵 갱신 — 매주 월요일 KST 03:00 (UTC 18:00 일요일).
  // PR-B-2: WEEKEND_MAINTENANCE — 일요일 정비 작업.
  scheduledJob('0 18 * * 0', 'WEEKEND_MAINTENANCE', 'sector_map_weekly', () => {
    void runSectorMapUpdate('weekly');
  }, { timezone: 'UTC' });

  // 일일 재시도 — 평일 KST 04:00 (UTC 19:00 전일).
  // PR-B-2: TRADING_DAY_ONLY — 평일 새벽 재시도.
  scheduledJob('0 19 * * 0-4', 'TRADING_DAY_ONLY', 'sector_map_daily_retry', () => {
    if (shouldRetrySectorMap()) {
      void runSectorMapUpdate('daily-retry');
    }
  }, { timezone: 'UTC' });

  // PR-D ADR-0045 — KRX 차년도 휴장일 등록 감사. 매년 12/1 09:00 KST = UTC 12/1 00:00.
  // PR-B-2: ALWAYS_ON — 12/1 이 KRX 공휴일이어도 발송 (감사 자체는 휴장과 무관).
  scheduledJob('0 0 1 12 *', 'ALWAYS_ON', 'krx_holiday_audit',
    () => runKrxHolidayAudit(), { timezone: 'UTC' });
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
