/**
 * @responsibility 자동 신호 스캔 오케스트레이터 — preflight→후보→평가→주문→승인→진단 6단계 조율
 *
 * ADR-0001 (개정 2026-04-25) 의 7모듈 구조 진입점. 본 파일은 기존
 * `server/trading/signalScanner.ts` 의 `runAutoSignalScan` 본체를 6단계 조율
 * 코드(200줄 이내 목표) 로 축약하여 받아들이는 위치다.
 *
 * Phase 2 (스캐폴딩) 단계에서는 시그니처만 정의하고 구현은 후속 Phase 3 에서
 * 단계별로 채워진다. 외부 importer 9개의 import 경로(`server/trading/signalScanner.js`)
 * 는 barrel 로 유지되며 본 파일은 그 barrel 의 단일 진입 export 만 담당한다.
 */

import { runPreflight } from './preflight.js';
import { selectCandidates } from './candidateSelect.js';
import { evaluateMainCandidates, evaluateIntradayCandidates } from './perSymbolEvaluation.js';
import { createApprovalQueueState, flushApprovalQueue } from './approvalQueue.js';
import { dispatchApprovedBuy } from './orderDispatch.js';
import { createScanCounters, persistScanResults } from './scanDiagnostics.js';

export interface RunAutoSignalScanOptions {
  sellOnly?: boolean;
  forceBuyCodes?: string[];
}

export interface RunAutoSignalScanResult {
  positionFull?: boolean;
}

/**
 * 자동 신호 스캔 진입점. Phase 3 마이그레이션 전에는 호출 시 throw 하며,
 * 기존 `server/trading/signalScanner.ts` 의 동일 export 가 활성 경로다.
 */
export async function runAutoSignalScan(
  options?: RunAutoSignalScanOptions,
): Promise<RunAutoSignalScanResult> {
  const counters = createScanCounters();

  // 1. Preflight (거시/시스템 환경 평가 및 게이팅)
  const preflightResult = await runPreflight(options);
  if (preflightResult.shouldAbort) {
    if (!preflightResult.skipPersist) {
      // ADR-0187: preflight abort 경로도 sectorEnergy meta carry-over (정상 경로와 정합).
      const abortMacro = preflightResult.context?.macroState as
        | { sectorEnergyDataQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED'; sectorEnergyValidSectorCount?: number; sectorEnergyReasons?: string[] }
        | undefined;
      await persistScanResults(counters, {
        sellOnly: options?.sellOnly,
        ...preflightResult.diagnosticData,
        ...(abortMacro?.sectorEnergyDataQuality !== undefined ? {
          sectorEnergyQuality: abortMacro.sectorEnergyDataQuality,
          validSectorCount: abortMacro.sectorEnergyValidSectorCount,
          sectorEnergyReasons: abortMacro.sectorEnergyReasons,
        } : {}),
      });
    }
    return { positionFull: preflightResult.positionFull };
  }

  // 2. Candidate Select (관심종목 3섹션 및 Intraday 후보군 선정)
  const candidates = await selectCandidates(preflightResult.context, options);

  // 3. Per-Symbol Evaluation (매수 조건 검증, 큐/포지션/가용현금 상태관리 공유)
  const queueState = createApprovalQueueState(preflightResult.context.orderableCash);
  await evaluateMainCandidates(candidates, preflightResult.context, counters, queueState);

  // 4. Approval Queue (승인 일괄 처리 및 실패한 가용 현금 롤백)
  const approvedTasks = await flushApprovalQueue(queueState);

  // 4.5. Intraday Evaluation (장중 스캔은 환불된 현금을 반영한 후 평가)
  await evaluateIntradayCandidates(candidates, preflightResult.context, counters, queueState, options);

  // 5. Order Dispatch (실 KIS 주문 발송 및 알림)
  await dispatchApprovedBuy(approvedTasks, preflightResult.context);

  // 6. Diagnostics (스캔 이력, 차단 사유 통계 및 영속화)
  // ADR-0187: macroState.sectorEnergy* 3 필드 carry-over → ScanSummary.sectorEnergyQuality/
  // validSectorCount/sectorEnergyReasons 영속 → /scan_blockers 메시지의 §"섹터 에너지 데이터
  // 품질" 섹션 활성. 이전엔 macroState 영속만 있고 read 호출자 0건 (silent dead-read).
  const macro = preflightResult.context?.macroState as
    | { sectorEnergyDataQuality?: 'OK' | 'PARTIAL' | 'STALE' | 'FAILED'; sectorEnergyValidSectorCount?: number; sectorEnergyReasons?: string[] }
    | undefined;
  await persistScanResults(counters, {
    sellOnly: options?.sellOnly,
    ...candidates.lengths,
    macroGateState: preflightResult.macroGateState,
    ...(macro?.sectorEnergyDataQuality !== undefined ? {
      sectorEnergyQuality: macro.sectorEnergyDataQuality,
      validSectorCount: macro.sectorEnergyValidSectorCount,
      sectorEnergyReasons: macro.sectorEnergyReasons,
    } : {}),
  });

  return { positionFull: false };
}
