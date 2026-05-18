/**
 * server/scheduler — cron 스케줄러 엔트리포인트.
 *
 * @responsibility 도메인별 job 모듈을 조립하여 startScheduler() 한 호출로 전체 cron 파이프라인을 기동한다.
 *
 * 원래 단일 scheduler.ts(655 LOC, 30+ cron 인라인)는 Shadow 청산 + 서킷브레이커,
 * 헬스체크 요약 등 수십 줄의 비즈니스 로직이 cron 콜백 안에 박혀 있어 확장/테스트가
 * 어려웠다. 도메인(orchestrator · alerts · reports · screener · shadow resolver ·
 * health check · KIS stream · learning · trade flow · maintenance) 단위로 쪼개
 * 각 파일이 "자기 cron만 등록" 하도록 했다.
 */

import { emitDiagnosticWarn } from '../observability/diagnosticWarn.js';
import { registerOrchestratorJobs } from './orchestratorJobs.js';
import { registerAlertJobs } from './alertJobs.js';
import { registerReportJobs } from './reportJobs.js';
import { registerScreenerJobs } from './screenerJobs.js';
import { registerShadowResolverJob } from './shadowResolverJob.js';
import { registerHealthCheckJobs } from './healthCheckJob.js';
import { registerKisStreamJobs } from './kisStreamJobs.js';
import { registerLearningJobs } from './learningJobs.js';
import { registerTradeFlowJobs } from './tradeFlowJobs.js';
import { registerMaintenanceJobs } from './maintenanceJobs.js';
import { registerCommandUsageJobs } from './commandUsageJobs.js';
import { registerBugLedgerSummaryJob } from './bugLedgerSummaryJob.js';
import { registerBugCandidateJob } from './bugCandidateJob.js';
import { registerRuntimeDebugSnapshotJob } from './runtimeDebugSnapshotJob.js';
import { registerHealthLoop } from './healthLoop.js';
import { registerPostHolidayKickstart } from './postHolidayKickstart.js';
import { registerInvestorFlowWarmupJobs } from './investorFlowWarmupJob.js';
import { registerProgramAutoCaptureJobs } from './programAutoCaptureJob.js';
import { registerCredentialExpiryWatchdog } from '../health/credentialExpiryWatchdog.js';
import { sendStartupExecutionContextAlert } from '../alerts/startupExecutionContext.js';
import { getRegisteredJobNames } from './scheduleGuard.js';
import { SCHEDULE_CATALOG, getAllJobMetrics } from './scheduleCatalog.js';

// PR-598: investor-flow warm-up cron 은 PR-597 에서 실제 scheduledJob 등록이 먼저 들어갔다.
// scheduleCatalog.ts 는 대형 SSOT 파일이라 별도 리팩터 전까지 boot catalog 검증에서
// 확장 catalog 로 합산해 "등록됐으나 catalog 없음" 오탐을 제거한다.
const SCHEDULE_CATALOG_EXTENSION_JOB_NAMES = [
  'investor_flow_warmup_open',
  'investor_flow_warmup_lunch',
  'investor_flow_warmup_preclose',
  'system_daily_flush',
  'program_auto_capture_morning',
  'program_auto_capture_afternoon',
];

export function startScheduler(): void {
  registerOrchestratorJobs();
  registerAlertJobs();
  registerReportJobs();
  registerScreenerJobs();
  registerShadowResolverJob();
  registerHealthCheckJobs();
  // ADR-0131 — 자가점검 헬스 루프 + 인증키 만료 + 휴장 후 첫 거래일 가속 점검
  registerHealthLoop();
  registerCredentialExpiryWatchdog();
  registerPostHolidayKickstart();
  registerInvestorFlowWarmupJobs();
  registerProgramAutoCaptureJobs();
  registerKisStreamJobs();
  registerLearningJobs();
  registerTradeFlowJobs();
  registerMaintenanceJobs();
  registerCommandUsageJobs();
  registerBugLedgerSummaryJob();  // PR #669/#670/#671/#672/#673 후속 P2-B — 매월 1일 10:00 KST
  registerBugCandidateJob();       // PR #669~#674 후속 P3 — 매일 09:30 KST CRITICAL 패턴 검출
  registerRuntimeDebugSnapshotJob(); // Patch-AFTER-HOURS-RUNTIME-DEBUG-SNAPSHOT-001/002/003 — 매 평일 15:30 KST market-close runtime debug snapshot capture (장후 KIS/KRX 400/500 회피, ESM-safe, 15:19 시스템 폐기)

  // PATCH-OPS: startup execution context clarification.
  // 기존 부팅 메시지의 "KIS: 실거래" 문구가 실주문 허용으로 오해되지 않도록
  // 실행 모드 / 주문 실행 / KIS 환경을 분리해 추가 보고한다. read-only, best-effort.
  sendStartupExecutionContextAlert().catch((e) => {
    emitDiagnosticWarn({ code: 'P2_SCHEDULER_DIAGNOSTIC_DEGRADED', message: 'Scheduler startup execution context alert failed.', dedupKey: 'p2:scheduler:startup-context-alert', error: e });
  });

  // ── 부팅 검증 (cron 미실행 결함 식별 도구) ─────────────────────────────────
  // scheduledJob() 통과 jobName + JobMetrics 영속 복원 entry + SCHEDULE_CATALOG.
  // 1) scheduledJob 통과 갯수 = 코드 실제 등록 수 (registerXxxJobs throw 시 부족)
  // 2) JobMetrics restored = 직전 배포까지 한 번이라도 트리거된 cron 수
  // 3) SCHEDULE_CATALOG = 사람이 읽는 시간표 SSOT (jobName 보유 항목만)
  // 셋 사이 갭이 결함 위치를 정확히 가리킨다.
  const registered = getRegisteredJobNames();
  const restoredMetrics = getAllJobMetrics().map((m) => m.jobName);
  const catalogJobs = [
    ...SCHEDULE_CATALOG.filter((e) => e.jobName).map((e) => e.jobName as string),
    ...SCHEDULE_CATALOG_EXTENSION_JOB_NAMES,
  ];
  console.log(`[Scheduler] cron 작업 등록 완료 — scheduledJob 통과: ${registered.length}개 / JobMetrics 복원: ${restoredMetrics.length}개 / SCHEDULE_CATALOG: ${catalogJobs.length}개`);

  const catalogMissingFromRegistered = catalogJobs.filter((n) => !registered.includes(n));
  if (catalogMissingFromRegistered.length > 0) {
    emitDiagnosticWarn({ priority: 'P3', code: 'P3_SCHEDULER_CATALOG_DRIFT', message: 'Schedule catalog contains jobs not registered at runtime.', dedupKey: 'p3:scheduler:catalog-missing-registered', details: { missing: catalogMissingFromRegistered } });
  }
  const registeredMissingFromCatalog = registered.filter((n) => !catalogJobs.includes(n));
  if (registeredMissingFromCatalog.length > 0) {
    emitDiagnosticWarn({ priority: 'P3', code: 'P3_SCHEDULER_CATALOG_DRIFT', message: 'Schedule runtime has jobs missing from catalog.', dedupKey: 'p3:scheduler:registered-missing-catalog', details: { unknownJobCount: registeredMissingFromCatalog.length, sample: registeredMissingFromCatalog.slice(0, 5) } });
  }
}
