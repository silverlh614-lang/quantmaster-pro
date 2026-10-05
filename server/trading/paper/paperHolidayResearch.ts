// @responsibility Refresh holiday research from stored evidence.
import { isKrxTradingDay, toKstDateKey } from '../../calendar/krxTradingCalendar.js';
import { loadPaperExperimentLedger } from '../../persistence/paperExperimentRepo.js';
import { runPaperStorageMaintenance } from '../../persistence/paperStorageMaintenance.js';
import { getPaperResearchView, refreshPaperResearch } from './paperResearchRuntime.js';
import { loadPaperStrategyState } from './paperStrategyRuntime.js';
import { queuePaperProgramResearch } from './paperProgramResearch.js';

let lastAttempt: number | undefined;
let running: Promise<void> | undefined;
let pendingResearch = false;

/** Check stored input changes hourly; unchanged evidence also reuses its persisted report across restarts and holidays. */
export function runPaperHolidayResearch(now = new Date()): Promise<void> {
  const day = toKstDateKey(now);
  if (!day) return Promise.reject(new Error('휴장일 연구 기준 시각을 확인할 수 없습니다.'));
  if (isKrxTradingDay(day)) return Promise.resolve();
  if (running) return running;
  if (lastAttempt !== undefined && now.getTime() - lastAttempt < 3_600_000) return Promise.resolve();
  lastAttempt = now.getTime();
  running = Promise.resolve().then(async () => {
    // This reads archived prices and news only; it neither refreshes index providers nor fabricates a new snapshot.
    const changed = refreshPaperResearch();
    pendingResearch = pendingResearch || changed;
    const research = getPaperResearchView();
    if (!research || research.error) throw new Error(research?.error ?? '저장 자료 연구 결과를 확인할 수 없습니다.');
    if (!pendingResearch) return;
    const baseline = loadPaperExperimentLedger();
    const strategy = loadPaperStrategyState();
    if (!strategy.ledger) throw new Error(strategy.error ?? '전략 기록을 읽을 수 없습니다.');
    runPaperStorageMaintenance(baseline, strategy.ledger, now, false);
    if (strategy.ledger.adaptive) {
      await queuePaperProgramResearch(strategy.ledger.adaptive, { asOf: now.toISOString(), marketOpen: false });
    }
    pendingResearch = false;
  }).finally(() => { running = undefined; });
  return running;
}
