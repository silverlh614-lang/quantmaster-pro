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

export function startScheduler(): void {
  registerOrchestratorJobs();
  registerAlertJobs();
  registerReportJobs();
  registerScreenerJobs();
  registerShadowResolverJob();
  registerHealthCheckJobs();
  registerKisStreamJobs();
  registerLearningJobs();
  registerTradeFlowJobs();
  registerMaintenanceJobs();
  registerCommandUsageJobs();

  console.log('[Scheduler] cron 작업 등록 완료 (장중 Intraday Watchlist는 Orchestrator INTRADAY tick 내부에서 처리)');
}
