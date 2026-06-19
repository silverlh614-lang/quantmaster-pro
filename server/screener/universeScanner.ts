// @responsibility universeScanner 스크리너 모듈
/**
 * universeScanner.ts — 자동 발굴 3단계 파이프라인
 *
 * Stage 1: 전체 종목 풀 양적 1차 필터 → 상위 60개
 *   - KIS 실계좌: 거래량 상위 + 상승률 상위 병렬 조회
 *   - VTS/공통:  STOCK_UNIVERSE ~220개 Yahoo 5개씩 병렬 배치 스캔
 *   - 5개 수치 관문: 상승률, 거래량배수, 가격, PER, MA20
 *
 * Stage 2: 주도 섹터 우선 + 서버 Gate 8조건 → 상위 15개
 *   - 레짐별 주도 섹터 1.5× 보너스
 *   - SKIP 신호 제외
 *
 * Stage 3: Gemini 27조건 배치 평가 → 워치리스트 등록
 *   - 15개 한 번에 배치 프롬프트 (비용 최소화)
 *   - 레짐별 손절/목표가 자동 계산
 *   - RRR ≥ 2.0 검증
 *   - 5영업일 후 자동 만료 (expiresAt)
 *
 * 매일 08:35 KST 실행 (scheduler.ts 등록).
 *
 * 도메인 상수 및 유틸리티는 pipelineHelpers.ts 로 분리됨.
 */

import fs from "fs";
import {
  fetchYahooQuote,
  fetchKisQuoteFallback,
  enrichQuoteWithKisMTAS,
  STOCK_UNIVERSE,
} from "./stockScreener.js";
import {
  logKisMtasNoiseSummary,
  resetKisMtasNoiseSummary,
} from "./adapters/kisQuoteAdapter.js";
// ADR-0443 — yahooSymbolResolver SSOT 위임 — `${code}.KS ?? .KQ` brute-force
// 패턴 영구 차단. fetchYahooQuoteByCode 가 마스터 매칭 + ADR-0241 sanity 회복
// 자연 적용 + tryGetYahooSymbol 가 symbol field 격상 (마스터 매칭 시 정확한 시장,
// 부재 시 .KS fallback).
import {
  fetchYahooQuoteByCode,
  tryGetYahooSymbol,
} from "./adapters/yahooSymbolResolver.js";
import { loadConditionWeights } from "../persistence/conditionWeightsRepo.js";
import { evaluateServerGate } from "../quantFilter.js";
import {
  loadMacroState,
  type MacroState,
} from "../persistence/macroStateRepo.js";
import { loadWatchlist, saveWatchlist } from "../persistence/watchlistRepo.js";
import {
  computeFocusCodes,
  assignSection,
  addToWatchlist,
} from "./watchlistManager.js";
import { sendTelegramAlert } from "../alerts/telegramClient.js";
import {
  realDataKisGet,
  HAS_REAL_DATA_CLIENT,
  KIS_IS_REAL,
  fetchKisInvestorTradeByStockDaily,
  hasKisClientOverrides,
} from "../clients/kisClient.js";
import { resolveDartFinancialsForEvaluation } from "../trading/gate2/gate2DartCanonicalSlot.js";
import type { Gate2ExternalCoverageInput } from "../quant/gate2Diagnostics/types.js";
import { recordDartAttempt } from "./dataCompletenessTracker.js";
import {
  calcReliabilityScore,
  sourcesFromGateKeys,
  formatReliabilityBadge,
} from "../learning/reliabilityScorer.js";
import { runConfluenceEngine } from "../trading/confluenceEngine.js";
import { computeEtfSectorBoost } from "../alerts/globalScanAgent.js";
import { evaluateRegretAsymmetry } from "../trading/regretAsymmetryFilter.js";
import { STAGE1_CACHE_FILE, ensureDataDir } from "../persistence/paths.js";
import type { RegimeLevel } from "../../src/types/core.js";
// Patch-STAGE1-RISK-ON-LEADER-CAPTURE-001 — risk-on regime 완화 주입용 canonical regime resolver.
import { resolveCanonicalRegimeLevel } from "../trading/regime/canonicalRegimeAccess.js";
import {
  type CandidateStock,
  STOP_RATES,
  TARGET_RATES,
  addBusinessDays,
  calcStage1Score,
  getLeadingSectors,
  runStage3Screening,
  evaluateStage1FilterTracked,
  resetStage1RejectionCounts,
  getStage1RejectionCounts,
} from "./pipelineHelpers.js";
import { getSectorByCode } from "./sectorMap.js";
import {
  assertProductionMasterUsable,
  formatProductionMasterBlockedMessage,
} from "../dataQuality/productionMasterGuard.js";
import { isEmergencyMasterGuardScanEnabled } from "../dataQuality/emergencyDataQualityGuards.js";
import {
  getAllStockEntries,
  getStockByCode,
  getTradableKrxUniverse,
  updateKrxMasterRuntimeCounts,
} from "../persistence/krxStockMasterRepo.js";
import {
  evaluateKisChartFallbackAllowed,
  formatPreopenKisFallbackSkippedLog,
} from "../trading/kisChartFallbackGuard.js";
// ADR-0614 — 외국인/기관 연속 순매수 관측 전용 ledger. default OFF → append no-op(byte-identical).
import {
  appendConsecutiveNetBuyObservation,
  isConsecutiveNetBuyObservationEnabled,
  todayKst as consecutiveNetBuyTodayKst,
} from "../trading/signalScanner/consecutiveNetBuyLedgerAdr0614.js";
// ADR-0615 — 뉴스시차 진입윈도우 관측 stamp. default OFF → 산출·stamp no-op(byte-identical). 신규 fetch 0.
import {
  isNewsLagEntryWindowObservationEnabled,
  computeNewsLagEntryWindowBySector,
  loadActiveNewsSupplyRecordsForObservation,
} from "../learning/newsLagEntryWindowObservationAdr0615.js";
// ADR-0616 — 유니버스 구성 편향 per-scan aggregate 관측. default OFF → 산출·append no-op(byte-identical). 신규 fetch 0.
import {
  isUniverseCompositionBiasObservationEnabled,
  computeUniverseCompositionBiasObservation,
  appendUniverseCompositionBiasObservation,
} from "./universeCompositionBiasObservationAdr0616.js";
// ADR-0617 — 주도주 Stage1 보존(source carry + top-N union). default OFF → carry 미수행·보존 0·append no-op(byte-identical). 신규 fetch 0.
import {
  isLeaderUniverseInjectionEnabled,
  isLeaderSource,
  carrySourceTags,
  applyLeaderPreservation,
  appendLeaderUniverseInjectionObservation,
} from "./leaderUniverseInjectionAdr0617.js";
// ADR-0638 — 주도주 파이프라인 funnel 관측(캐시 신선도 + Stage1 leader 탈락 사유). default OFF → 카운터·분기·append no-op(byte-identical). 신규 fetch 0(이미 carry 된 source × Stage1 reason 재사용).
import {
  isLeaderPipelineFunnelObservationEnabled,
  computeLeaderCacheFreshness,
  computeLeaderPipelineFunnelObservation,
  appendLeaderPipelineFunnelLedger,
} from "./leaderPipelineFunnelObservationAdr0638.js";
// ADR-0622 — 발굴 적극성: ② Stage1 top-N 상향 + ③ RS percentile 우선 정렬 + dry-run 관측.
//   양 flag default OFF → resolveStage1TopN()===60·정렬 비교자 미주입(현행 byte-identical). 신규 fetch 0.
import {
  resolveStage1TopN,
  isUniverseRsPercentileRankEnabled,
  computeRsPercentiles,
  rsPriorityComparator,
  computeUniverseDiscoveryAggressivenessObservation,
  appendUniverseDiscoveryAggressivenessObservation,
} from "./universeDiscoveryAggressivenessAdr0622.js";

// ─── ADR-0184 (PR-B12-A) — scanner start master guard SSOT ─────────────────
//
// universeScanner 의 3 진입점 (runStage1PreScreening / runStage2_3FinalScreening /
// runFullDiscoveryPipeline) 이 *cron 직접 호출* 경로에서 productionMasterGuard 를
// 거치지 않던 갭 차단. ENV `EMERGENCY_MASTER_GUARD_SCAN_ENABLED=true` 명시 활성 시
// 진입부에서 `assertProductionMasterUsable('SCANNER')` 호출 → master 결손 시
// SCAN_ABORTED telegram + early return.
//
// default OFF (회귀 위험 격리) — 운영자가 productionMasterGuard SSOT 와의 일관성을
// 검증한 후 ENV 활성화 결정. ADR-0173 Phase 3 패턴 정합 (P1 SLA 만기 2026-06-19).
//
// 호출자 측 try/catch 격리로 fatal throw 가 cron 흐름을 차단 안 함.
async function ensureScannerMasterUsable(jobLabel: string): Promise<boolean> {
  if (!isEmergencyMasterGuardScanEnabled()) return true;
  try {
    assertProductionMasterUsable("SCANNER");
    return true;
  } catch (err) {
    const reason = formatProductionMasterBlockedMessage(err);
    console.error(`[Pipeline/${jobLabel}] ${reason}`);
    await sendTelegramAlert(
      `🚨 <b>[${jobLabel}] Scan aborted</b>\n` +
        `${reason}\n` +
        `Action:\n` +
        `- /kmr 강제 갱신\n` +
        `- /kms master total/TTL 확인\n` +
        `- /health KRX Master 상태 확인`,
      {
        priority: "HIGH",
        dedupeKey: `scan_aborted_master_unusable:${jobLabel}`,
        cooldownMs: 10 * 60 * 1000,
      },
    ).catch(console.error);
    return false;
  }
}


function buildKrxFullMasterScannerUniverse(): Array<{ symbol: string; code: string; name: string }> {
  const raw = getAllStockEntries();
  const tradable = getTradableKrxUniverse(raw);
  if (tradable.length === 0) return [];
  return tradable.map((entry) => ({
    code: entry.code,
    name: entry.name,
    symbol: entry.market === "KOSDAQ" ? `${entry.code}.KQ` : `${entry.code}.KS`,
  }));
}

// ── GateEvaluation snapshot refresh helper ────────────────────────────────────
//
// KIS 수급 / DART 재무 hydration 이후 evaluateServerGate() 재호출 결과를
// CandidateStock 의 Gate raw snapshot 필드에 반영한다.
//
// 주의:
//   - candidate.gateScore 는 호출부 정책(ETF boost / Gemini totalGateScore 등)에
//     따라 boosted 값이 있을 수 있으므로 여기서 덮지 않는다. 필요 시 호출부에서
//     명시적으로 candidate.gateScore 를 갱신한다.
//   - gateEvaluation / gateLayerSummary / gateRawScore / availableMaxScore /
//     normalizedGateScore / gateOutputs / gateCondKeys 는 refreshedGate 기준 snapshot.
//   - gateEvaluation 은 conditionKeys.includes(...) 재계산 없이 gate.gateEvaluation
//     그대로 사용한다 (gateLayerSummary 파생 SSOT 유지).
function applyGateSnapshotToCandidate(
  candidate: CandidateStock,
  gate: ReturnType<typeof evaluateServerGate>,
): void {
  candidate.gateCondKeys = gate.conditionKeys;
  candidate.gateDetails = gate.details;
  candidate.gateSignal = gate.signalType;

  // 기존 gateScore는 호출부 정책에 따라 boosted 값이 있을 수 있으므로 여기서 덮지 않는다.
  // gateRawScore는 evaluateServerGate 원점수 snapshot.
  candidate.gateEvaluation = gate.gateEvaluation;
  candidate.gateLayerSummary = gate.gateLayerSummary;
  candidate.gateRawScore = gate.rawScore;
  candidate.availableMaxScore = gate.availableMaxScore;
  candidate.normalizedGateScore = gate.normalizedGateScore;
  candidate.gateOutputs = gate.outputs;
}

function resolveKisInvestorFlowFetchTargets(
  candidates: CandidateStock[],
  kisLoadState: string,
): CandidateStock[] {
  if (kisLoadState === "RED") return [];

  const maxCount = kisLoadState === "YELLOW" ? 15 : 25;
  const watchlist = loadWatchlist();
  const focusCodes = computeFocusCodes(watchlist);
  const sectionMap = new Map<string, string>();
  for (const w of watchlist) {
    sectionMap.set(w.code, assignSection(w, focusCodes));
  }

  const swing: CandidateStock[] = [];
  const catalyst: CandidateStock[] = [];
  const momentum: CandidateStock[] = [];

  for (const c of candidates) {
    const section = sectionMap.get(c.code) ?? "MOMENTUM";
    if (section === "SWING") swing.push(c);
    else if (section === "CATALYST") catalyst.push(c);
    else momentum.push(c);
  }

  const targets: CandidateStock[] = [...swing, ...catalyst];
  if (kisLoadState === "GREEN") {
    const remaining = maxCount - targets.length;
    if (remaining > 0) targets.push(...momentum.slice(0, remaining));
  }

  return targets.slice(0, maxCount);
}

// ── Stage 1 ───────────────────────────────────────────────────────────────────

/**
 * 전체 종목 풀 양적 1차 필터.
 * KIS 실계좌: 거래량 상위 + 상승률 상위 병렬 조회 후 Yahoo로 상세 보완.
 * VTS/공통: STOCK_UNIVERSE Yahoo 스캔.
 * 반환: stage1Score 내림차순 상위 60개.
 */
export async function stage1QuantFilter(): Promise<CandidateStock[]> {
  const candidates: CandidateStock[] = [];
  const seenCodes = new Set<string>();
  const BATCH_SIZE = 5; // 병렬 배치 크기 (Yahoo rate limit 고려, 500개 확장 대비)
  // BUG #1 — Stage 1 탈락 사유 카운터 초기화. evaluateStage1FilterTracked 가 자동 증가.
  resetStage1RejectionCounts();
  // Patch-STAGE1-RISK-ON-LEADER-CAPTURE-001 — risk-on regime 완화용 canonical regime 1회 조회.
  //   ENV flag OFF(기본)면 evaluateStage1Filter 내부에서 무시 → 기존 동작 byte-identical.
  const stage1MacroState = loadMacroState();
  const stage1Regime = resolveCanonicalRegimeLevel(stage1MacroState);
  // UNIVERSE_RS_GATE_ENABLED ON + risk-on 분기일 때 calcStage1Score RS 0-floor 보너스 벤치마크.
  //   kospi20dReturn 은 *퍼센트*(macroState SSOT) — q.return20d 와 동일 단위(정규화 불필요).
  //   flag OFF / benchmark 부재 시 calcStage1Score 가 보너스 0 → 기존 점수 byte-identical.
  const stage1BenchmarkReturn20d = stage1MacroState?.kospi20dReturn;

  // ─ KIS 실계좌 데이터: 거래량 + 상승률 순위 병렬 조회 ─
  // 실계좌 데이터 키(KIS_REAL_DATA_APP_KEY) 또는 실계좌 모드(KIS_IS_REAL)일 때 실행
  // VTS mock override가 설치된 경우에도 허용 (mock client가 ranking TR 응답을 생성)
  const hasMockOverride = hasKisClientOverrides();
  const stage1KisFallbackDecision = evaluateKisChartFallbackAllowed(new Date(), "STAGE1_DISCOVERY");
  if (!stage1KisFallbackDecision.allowed) {
    console.log(formatPreopenKisFallbackSkippedLog({
      stage: "Stage1",
      reason: stage1KisFallbackDecision.reason,
      fallback: "YAHOO_KRX_ONLY",
    }));
  }

  if (
    stage1KisFallbackDecision.allowed &&
    (HAS_REAL_DATA_CLIENT || KIS_IS_REAL || hasMockOverride) &&
    (process.env.KIS_REAL_DATA_APP_KEY ||
      process.env.KIS_APP_KEY ||
      hasMockOverride)
  ) {
    const [volResult, riseResult] = await Promise.allSettled([
      realDataKisGet(
        "FHPST01710000",
        "/uapi/domestic-stock/v1/ranking/volume",
        {
          fid_cond_mrkt_div_code: "J",
          fid_cond_scr_div_code: "20171",
          fid_input_iscd: "0000",
          fid_div_cls_code: "0",
          fid_blng_cls_code: "0",
          fid_trgt_cls_code: "111111111",
          fid_trgt_exls_cls_code: "000000",
          fid_input_price_1: "3000",
          fid_input_price_2: "999999",
          fid_vol_cnt: "50000",
          fid_input_date_1: "",
        },
      ),
      realDataKisGet(
        "FHPST01700000",
        "/uapi/domestic-stock/v1/ranking/fluctuation",
        {
          fid_cond_mrkt_div_code: "J",
          fid_cond_scr_div_code: "20170",
          fid_input_iscd: "0000",
          fid_rank_sort_cls_code: "0",
          fid_input_price_1: "3000",
          fid_vol_cnt: "50000",
          fid_trgt_cls_code: "111111111",
          fid_trgt_exls_cls_code: "000000",
          fid_input_date_1: "",
        },
      ),
    ]);

    type KisOutput = { output?: Record<string, string>[] };
    const rawRows: Record<string, string>[] = [
      ...((volResult.status === "fulfilled"
        ? (volResult.value as KisOutput)?.output
        : null) ?? []),
      ...((riseResult.status === "fulfilled"
        ? (riseResult.value as KisOutput)?.output
        : null) ?? []),
    ];

    // 관리종목 · 거래정지 · 정리매매 · 투자경고/위험 사전 제외 (부실기업 필터)
    const isRiskyKisRow = (s: Record<string, string>): boolean => {
      if ((s.trht_yn ?? "").toUpperCase() === "Y") return true;
      if ((s.sltr_yn ?? "").toUpperCase() === "Y") return true;
      if ((s.mang_issu_yn ?? "").toUpperCase() === "Y") return true;
      if ((s.mang_issu_cls_code ?? "").toUpperCase() === "Y") return true;
      const warnCode = s.mrkt_warn_cls_code ?? "";
      if (warnCode === "02" || warnCode === "03") return true;
      const statCode = s.iscd_stat_cls_code ?? "";
      if (statCode === "51" || statCode === "52" || statCode === "58")
        return true;
      return false;
    };
    const kisRows = rawRows.filter((r) => !isRiskyKisRow(r));
    if (rawRows.length !== kisRows.length) {
      console.log(
        `[Pipeline/Stage1] 관리·거래정지 등 부실기업 ${rawRows.length - kisRows.length}개 제외`,
      );
    }

    // ─ 5개씩 병렬 배치 처리 (순차 대비 ~5× 속도 향상) ─
    // ADR-0622 ② — top-N 랭킹 raw 컷. flag OFF → resolveStage1TopN()===60(현행 byte-identical).
    //   ON → 90(budget lazy: 컷 후 fetch 유지·eager 전수 금지, KIS quote +30/스캔). 변수명은 컷 크기 가변.
    const kisTopN = kisRows.slice(0, resolveStage1TopN());
    for (let i = 0; i < kisTopN.length; i += BATCH_SIZE) {
      const batch = kisTopN.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (row) => {
          const code = row.stck_shrn_iscd ?? "";
          const name = row.hts_kor_isnm ?? "";
          if (!code || seenCodes.has(code)) return null;

          // ADR-0443 — SSOT 위임 (양 시장 fallback + ADR-0241 sanity 자동).
          const quote = await fetchKisQuoteFallback(code).catch(() => null);
          if (!quote) return null;
          if (!evaluateStage1FilterTracked(quote, stage1Regime).pass) return null;

          return {
            code,
            name,
            // ADR-0443 — 마스터 매칭 시 정확한 시장 표기, 부재 시 legacy .KS fallback.
            symbol: tryGetYahooSymbol(code) ?? `${code}.KS`,
            sector: getSectorByCode(code),
            quote,
            stage1Score: calcStage1Score(quote, stage1Regime, stage1BenchmarkReturn20d),
          } as CandidateStock;
        }),
      );
      for (const r of batchResults) {
        if (r && !seenCodes.has(r.code)) {
          seenCodes.add(r.code);
          candidates.push(r);
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // ─ Yahoo 유니버스 스캔 (VTS 보완 + KIS 미제공 종목) — 5개씩 병렬 배치 ─
  // 아이디어 6: 동적 확장 유니버스 사용 (정적 + 주간 52주신고가/외국인순매수)
  const { getExpandedUniverse, getExpandedUniverseSourceMap, loadDynamicUniverse, purgeExpired } = await import("./dynamicUniverseExpander.js");
  const expandedUniverse = getExpandedUniverse();
  const krxFullMasterUniverse = buildKrxFullMasterScannerUniverse();
  const baseScanUniverse = krxFullMasterUniverse.length > expandedUniverse.length
    ? krxFullMasterUniverse
    : expandedUniverse;
  // ADR-0617 — 주도주 source carry. flag OFF → source 전건 undefined(기존 {symbol,code,name} 동치).
  //   신규 fetch 0(getExpandedUniverseSourceMap 은 cron 영속 read). enabled 일 때만 source map read.
  const leaderInjectionEnabled = isLeaderUniverseInjectionEnabled();
  const leaderSourceMap = leaderInjectionEnabled ? getExpandedUniverseSourceMap() : new Map();
  const scanUniverse = carrySourceTags(baseScanUniverse, leaderSourceMap, leaderInjectionEnabled);
  console.log(
    `[Pipeline/Stage1] KRX_FULL_MASTER raw=${getAllStockEntries().length} ` +
      `tradable=${krxFullMasterUniverse.length} scannerUniverse=${scanUniverse.length}`
  );
  // ADR-0638 — 주도주 파이프라인 funnel 관측. flag OFF → 카운터·분기·산출 전부 미실행(:420-449 byte-identical).
  //   leaderSourceMap(:414, 영속 read) × evaluateStage1FilterTracked().reason 교집합 — 신규 fetch 0.
  const funnelEnabled = isLeaderPipelineFunnelObservationEnabled();
  let funnelLeaderEntered = 0;
  let funnelLeaderPassed = 0;
  let funnelCutOverextended = 0;
  let funnelCutOverheat = 0;
  let funnelCutOther = 0;
  for (let i = 0; i < scanUniverse.length; i += BATCH_SIZE) {
    const batch = scanUniverse.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (stock) => {
        if (seenCodes.has(stock.code)) return null;

        const quote = await fetchKisQuoteFallback(stock.code).catch(() => null);
        if (!quote || quote.price <= 0) return null;
        // ADR-0638 — flag ON 시에만 reason 재사용 관측(컷 동작 0줄 변경 — result 로 한 번 받아 reason 만 추가).
        if (funnelEnabled) {
          const result = evaluateStage1FilterTracked(quote, stage1Regime);
          if (isLeaderSource(stock.source)) {
            funnelLeaderEntered += 1;
            if (result.pass) funnelLeaderPassed += 1;
            else if (result.reason === "OVEREXTENDED") funnelCutOverextended += 1;
            else if (result.reason === "OVERHEAT") funnelCutOverheat += 1;
            else funnelCutOther += 1;
          }
          if (!result.pass) return null;
        } else if (!evaluateStage1FilterTracked(quote, stage1Regime).pass) {
          return null;
        }

        return {
          code: stock.code,
          name: stock.name,
          symbol: stock.symbol,
          sector: getSectorByCode(stock.code),
          quote,
          stage1Score: calcStage1Score(quote, stage1Regime, stage1BenchmarkReturn20d),
          // ADR-0617 — carry 된 주도주 source(flag OFF → undefined, 기존 동작 동치).
          source: stock.source,
        } as CandidateStock;
      }),
    );
    for (const r of batchResults) {
      if (r && !seenCodes.has(r.code)) {
        seenCodes.add(r.code);
        candidates.push(r);
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // ADR-0622 ③ — RS percentile 우선 정렬 비교자(flag ON 시만 주입, 직교 layer — 주도주 union 보존 무영향).
  //   RS=quote.return20d − stage1BenchmarkReturn20d(ADR-0616 정의 재사용·두 번째 공식 0). 신규 fetch 0.
  //   flag OFF → 비교자 undefined → applyLeaderPreservation 이 stage1Score 단독 정렬(byte-identical).
  const rsPercentileEnabled = isUniverseRsPercentileRankEnabled();
  const rsRanks = computeRsPercentiles(candidates, stage1BenchmarkReturn20d);
  const topNComparator = rsPercentileEnabled
    ? rsPriorityComparator(rsRanks)
    : undefined;
  // ADR-0617 — top-N 점수컷에서 주도주 강제 보존(union). flag OFF → result === 현행 slice(byte-identical).
  //   carry 미수행 시 source 전건 undefined → leadersInPool 0 → preserved 0 → topN 그대로.
  //   ADR-0622 ② — limit 은 resolveStage1TopN()(OFF=60 byte-identical). ③ 비교자는 직교 주입.
  const { result, observation: leaderInjectionObservation } = applyLeaderPreservation(
    candidates,
    resolveStage1TopN(),
    new Date(),
    leaderInjectionEnabled,
    topNComparator,
  );
  // 관측 ledger append — flag ON 만(opt-in 영속 I/O). try/catch 격리(불변식 #1 — scan 본체 보호).
  if (leaderInjectionEnabled) {
    try {
      appendLeaderUniverseInjectionObservation(leaderInjectionObservation);
    } catch (e) {
      // SDS-ignore: 관측 ledger append 실패는 scan 본체에 영향 없음(불변식 #1, ADR-0617). 진단 로그만.
      console.warn(
        "[Pipeline/Stage1] ADR-0617 leader injection ledger append 실패(무시):",
        e instanceof Error ? e.message : e,
      );
    }
  }

  // ADR-0638 — 주도주 파이프라인 funnel 관측 append. flag ON 만(opt-in 영속 I/O).
  //   leadersInPoolCount 는 ADR-0617 observation 재사용(중복 산출 0). cacheFreshness 는 영속 read(신규 fetch 0).
  //   try/catch 격리(불변식 #1 — scan 본체 보호). 관측 실패가 scan 을 막지 않는다.
  if (funnelEnabled) {
    try {
      const cacheFreshness = computeLeaderCacheFreshness(purgeExpired(loadDynamicUniverse()));
      const funnelObservation = computeLeaderPipelineFunnelObservation({
        cacheFreshness,
        cacheLeaderCodeCount: [...leaderSourceMap.values()].filter(isLeaderSource).length,
        leaderCodesEnteredStage1: funnelLeaderEntered,
        leaderCodesPassedStage1: funnelLeaderPassed,
        leaderStage1Cut: {
          byOverextended: funnelCutOverextended,
          byOverheat: funnelCutOverheat,
          byOther: funnelCutOther,
        },
        leaderPreservedIntoPool: leaderInjectionObservation.leadersInPoolCount,
        enabled: true,
      });
      appendLeaderPipelineFunnelLedger(funnelObservation);
    } catch (e) {
      // SDS-ignore: ADR-0638 funnel 관측 ledger append 실패는 scan 본체에 영향 없음(불변식 #1). 진단 로그만.
      console.warn(
        "[Pipeline/Stage1] ADR-0638 leader pipeline funnel 관측 실패(무시):",
        e instanceof Error ? e.message : e,
      );
    }
  }

  // ADR-0622 dry-run — "적극 발굴(top-N 90 / RS percentile)이었다면 후보 집합이 어떻게 달라졌을지" 산출.
  //   flag 무관 산출(OFF baseline 도 delta 노출). append 만 어느 한쪽 flag ON 시(opt-in 영속 I/O).
  //   try/catch 격리(불변식 #1 — scan 본체 보호). 신규 fetch 0(rsRanks·candidates 재사용).
  try {
    const aggressivenessObservation = computeUniverseDiscoveryAggressivenessObservation(
      candidates,
      rsRanks,
      stage1BenchmarkReturn20d,
      new Date(),
    );
    if (!aggressivenessObservation.observationOnly) {
      appendUniverseDiscoveryAggressivenessObservation(aggressivenessObservation);
    }
  } catch (e) {
    // SDS-ignore: ADR-0622 dry-run 관측 실패는 scan 본체에 영향 없음(불변식 #1). 진단 로그만.
    console.warn(
      "[Pipeline/Stage1] ADR-0622 발굴 적극성 dry-run 관측 실패(무시):",
      e instanceof Error ? e.message : e,
    );
  }

  // BUG #1 — 탈락 사유 분포 로깅 (상위 3개 집중 원인 노출).
  const stats = getStage1RejectionCounts();
  const topReasons = Object.entries(stats.byReason)
    .filter(([, n]) => n > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([k, n]) => `${k}=${n}`)
    .join(", ");
  updateKrxMasterRuntimeCounts({ scannerCandidateTotal: result.length, watchlistTotal: loadWatchlist().length });
  console.log(
    `[Pipeline/Stage1] 스캔 ${candidates.length}개 → 상위 ${result.length}개 추출 ` +
      `· 평가 ${stats.totalEvaluated} · 탈락 ${stats.totalRejected}` +
      (topReasons ? ` · top ${topReasons}` : ""),
  );
  return result;
}

// ── Stage 2 ───────────────────────────────────────────────────────────────────

/**
 * 주도 섹터 우선 + 서버 Gate 8조건 필터.
 * SKIP 신호 제외 → stage2Score 내림차순 상위 15개.
 */
export async function stage2SectorGateFilter(
  candidates: CandidateStock[],
  regime: RegimeLevel,
  macroState: MacroState | null,
): Promise<CandidateStock[]> {
  const leadingSectors = getLeadingSectors(regime);
  const weights = loadConditionWeights();
  const results: CandidateStock[] = [];
  resetKisMtasNoiseSummary();

  const kospi20dReturn = macroState?.kospi20dReturn;

  const stage2KisFallbackDecision = evaluateKisChartFallbackAllowed(new Date(), "STAGE2_DISCOVERY");
  if (!stage2KisFallbackDecision.allowed) {
    console.log(formatPreopenKisFallbackSkippedLog({
      stage: "Stage2",
      reason: stage2KisFallbackDecision.reason,
      fallback: "YAHOO_KRX_ONLY",
    }));
  }

  for (const c of candidates) {
    // 아이디어 9: KIS API 월봉/주봉 데이터로 MTAS 보강
    const enrichedQuote = stage2KisFallbackDecision.allowed
      ? await enrichQuoteWithKisMTAS(c.quote, c.code)
      : c.quote;
    const gate = evaluateServerGate(
      enrichedQuote,
      weights,
      kospi20dReturn,
      null,
      null,
      regime,
      undefined,
      // ADR-0568: sectorEnergyResult thread. 소비는 SECTOR_ENERGY_GATE2_WIRING_ENABLED gate — OFF 면 byte-identical.
      { sectorEnergyResult: macroState?.sectorEnergyResult },
    );

    // 아이디어 #5 rate limit 방지: 종목당 월봉+주봉 2회 호출 후 인터벌 확보
    // 내부 100ms(월봉→주봉) + 외부 60ms = 종목간 총 ~160ms → 약 6종목/초로 KIS 20건/초 한도 내 유지
    await new Promise((r) => setTimeout(r, 60));

    if (gate.signalType === "SKIP") continue;

    const sectorBonus = leadingSectors.some((s) => c.sector.includes(s))
      ? 1.5
      : 1.0;

    // Layer 14 ETF 선행 수급 부스트 — EWY/ITA/SOXX/XLE 5일 수익률 양수 시 gateScore에 가산
    const etfBoost = computeEtfSectorBoost(c.sector);
    const boostedGateScore = gate.gateScore + etfBoost.boost;
    const boostedDetails =
      etfBoost.reasons.length > 0
        ? [...gate.details, ...etfBoost.reasons]
        : gate.details;

    const stage2Score = boostedGateScore * sectorBonus + c.stage1Score * 0.3;

    results.push({
      ...c,
      quote: enrichedQuote, // KIS 보강된 quote 사용
      gateScore: boostedGateScore,
      gateSignal: gate.signalType,
      gateDetails: boostedDetails,
      gateCondKeys: gate.conditionKeys,
      gateEvaluation: gate.gateEvaluation,
      gateLayerSummary: gate.gateLayerSummary,
      gateRawScore: gate.rawScore,
      availableMaxScore: gate.availableMaxScore,
      normalizedGateScore: gate.normalizedGateScore,
      gateOutputs: gate.outputs,
      sectorBonus,
      stage2Score,
    });
  }

  // 1차 정렬 — kisFlow 반영 전 stage2Score 기준
  results.sort((a, b) => (b.stage2Score ?? 0) - (a.stage2Score ?? 0));

  // ── KIS 투자자 수급 실데이터 조회 — budgeted tier-aware (ADR-P0-2) ──
  // top15 고정 제거, KIS_LOAD_STATE와 섹션 정책 기반 최대 25개 선정
  // kisRateLimiter LOW 우선순위 + 200ms 간격으로 초당 15건 한도 내 유지
  if (stage2KisFallbackDecision.allowed && (KIS_IS_REAL || hasKisClientOverrides())) {
    const kisLoadState = (process.env.KIS_LOAD_STATE ?? "GREEN").toUpperCase();
    const kisFlowTargets = resolveKisInvestorFlowFetchTargets(results, kisLoadState);

    console.log(
      `[Pipeline/Stage2] KIS investor flow fetch: ` +
        `state=${kisLoadState} target=${kisFlowTargets.length}/${results.length}개`,
    );

    for (const c of kisFlowTargets) {
      const flow = await fetchKisInvestorTradeByStockDaily(c.code).catch(() => null);
      if (flow) {
        c.kisFlow = {
          foreignNetBuy: flow.foreignNetBuy,
          institutionalNetBuy: flow.institutionalNetBuy,
          individualNetBuy: flow.individualNetBuy,
          actualRows: flow.actualRows ?? flow.actualInvestorFlowRowCarrier?.actualRows ?? [],
          actualInvestorFlowRowCarrier: flow.actualInvestorFlowRowCarrier,
        };
        // 외국인 순매수 보너스: stage2Score에 반영
        const flowBonus =
          (flow.foreignNetBuy > 0 ? 0.3 : 0) +
          (flow.institutionalNetBuy > 0 ? 0.2 : 0);
        c.stage2Score = (c.stage2Score ?? 0) + flowBonus;

        // ── KIS 수급 hydration 이후 GateEvaluation refresh ────────────────────
        // 최초 evaluateServerGate 는 kisFlow=null 상태였다. 수급 실데이터가
        // 채워졌으므로 재호출해 supply_confluence 를 GateEvaluation 에 반영한다.
        // dartFin 은 Stage3 에서 조회되므로 여기서는 null 유지.
        // discovery 진단 / watchlist snapshot 품질 향상 목적 — live threshold /
        // 주문 / Kelly sizing / Shadow execution 은 변경하지 않는다.
        const refreshedGate = evaluateServerGate(
          c.quote,
          weights,
          kospi20dReturn,
          null,
          flow,
          regime,
          undefined,
          // ADR-0568: sectorEnergyResult thread. 소비는 SECTOR_ENERGY_GATE2_WIRING_ENABLED gate — OFF 면 byte-identical.
          { sectorEnergyResult: macroState?.sectorEnergyResult },
        );
        applyGateSnapshotToCandidate(c, refreshedGate);

        // 기존 gateScore 에는 ETF boost 가 반영되어 있었으므로 정책 유지:
        // refreshedGate 원점수 + ETF boost 를 재적용한다.
        const etfBoost = computeEtfSectorBoost(c.sector);
        c.gateScore = refreshedGate.gateScore + etfBoost.boost;
        if (etfBoost.reasons.length > 0) {
          c.gateDetails = [...refreshedGate.details, ...etfBoost.reasons];
        }

        console.log(
          `[GateRefresh/Stage2] ${c.name}(${c.code}) ` +
            `kisFlow=${c.kisFlow ? "OK" : "null"} ` +
            `gate2=${c.gateEvaluation?.gate2Passed ? "PASS" : "NO"} ` +
            `unavailable=${c.gateEvaluation?.unavailableKeys?.join("|") || "none"}`,
        );
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // kisFlow 반영 후 재정렬 → top15 산출
  const top15 = results
    .sort((a, b) => (b.stage2Score ?? 0) - (a.stage2Score ?? 0))
    .slice(0, 15);

  // ── Phase 2 컨플루언스 스코어링 ────────────────────────────────────────────
  // DART는 Stage 3에서 조회하므로 여기선 null 전달 (기술·수급·매크로 3축 평가)
  for (const c of top15) {
    c.confluenceResult = runConfluenceEngine({
      quote: c.quote,
      kisFlow: c.kisFlow ?? null,
      dartFin: null, // Stage 3에서 DART 조회 후 재평가
      macroState,
      regime,
      gateScore: c.gateScore ?? 0,
      kospiDayReturn: macroState?.kospiDayReturn,
    });
  }

  // HOLD 신호 제거 (3축 미만 BULLISH) — Gemini 호출 전 사전 필터링
  const confluenceFiltered = top15.filter(
    (c) => c.confluenceResult?.signal !== "HOLD",
  );
  const holdCount = top15.length - confluenceFiltered.length;

  logKisMtasNoiseSummary();

  console.log(
    `[Pipeline/Stage2] Gate통과 ${results.length}개 (macroState=${macroState ? "OK" : "null"})` +
      ` → 상위 ${top15.length}개 (KIS수급=${KIS_IS_REAL ? "조회" : "생략"})` +
      ` → 컨플루언스 HOLD ${holdCount}개 제거 → ${confluenceFiltered.length}개`,
  );
  return confluenceFiltered;
}

// ── Stage 3 ───────────────────────────────────────────────────────────────────

/**
 * Gemini 27조건 배치 평가 → 워치리스트 등록.
 * 레짐별 손절/목표가 자동 계산, RRR ≥ 2.0 검증, 5영업일 만료.
 */
export async function stage3AIScreenAndRegister(
  candidates: CandidateStock[],
  regime: RegimeLevel,
): Promise<number> {
  if (candidates.length === 0) return 0;

  // ── DART 펀더멘털 실데이터 병렬 조회 ────────────────────────────────────────
  // dartFinByCode: GateEvaluation refresh 에 쓸 full DartFinancials snapshot 보관.
  // CandidateStock.dartFin 은 narrow 타입(roe/opm/debtRatio/ocfRatio)이므로 별도 보관.
  const dartFinByCode = new Map<string, NonNullable<Gate2ExternalCoverageInput['dartFin']>>();
  await Promise.all(
    candidates.map(async (c) => {
      // ADR-0529: 정본 read 단일 진입점. 이 경로는 정본 snapshot 미threaded — 슬롯 부재 → 기존 cache-first fallback (byte-equivalent, 회귀 0).
      const fin = await resolveDartFinancialsForEvaluation(c.code).catch(() => null);
      const finAny = fin as Record<string, unknown> | null;
      const totalDebt = typeof finAny?.totalDebt === 'number' ? finAny.totalDebt : null;
      const totalEquity = typeof finAny?.totalEquity === 'number' ? finAny.totalEquity : null;
      const derivedDebtRatio = totalDebt != null && totalEquity && totalEquity !== 0 ? totalDebt / totalEquity : null;
      const hasData = !!(finAny && finAny.ocfRatio != null);
      recordDartAttempt(c.code, hasData);
      if (fin) {
        dartFinByCode.set(c.code, fin);
        c.dartFin = {
          roe: typeof finAny?.roe === 'number' ? finAny.roe : null,
          opm: typeof finAny?.opm === 'number' ? finAny.opm : null,
          debtRatio: typeof finAny?.debtRatio === 'number' ? finAny.debtRatio : derivedDebtRatio,
          ocfRatio: typeof finAny?.ocfRatio === 'number' ? finAny.ocfRatio : null,
        };
      }
    }),
  );

  const macroState = loadMacroState();

  // ── KIS/DART hydration 이후 GateEvaluation refresh ──────────────────────────
  // 최초 evaluateServerGate(Stage2) 는 dartFin=null 상태였다. DART 재무가 채워졌고
  // KIS 수급도 Stage2 에서 hydrate 됐으므로 재호출해 earnings_quality /
  // supply_confluence 를 GateEvaluation 에 반영한다.
  // gateScore 는 Stage2 ranking semantics(sector/ETF boost) 를 보존하므로 무조건
  // 덮지 않는다 — gateEvaluation / gateRawScore / availableMaxScore /
  // normalizedGateScore / gateOutputs / gateCondKeys refresh 가 핵심.
  // live threshold / 주문 / Kelly sizing / Shadow execution 은 변경하지 않는다.
  const weights = loadConditionWeights();
  for (const c of candidates) {
    const kisFlowForGate = c.kisFlow
      ? { ...c.kisFlow, source: "KIS_API" as const }
      : null;
    const refreshedGate = evaluateServerGate(
      c.quote,
      weights,
      macroState?.kospi20dReturn,
      dartFinByCode.get(c.code) ?? null,
      kisFlowForGate,
      regime,
      'ENTRY_RECHECK_GATE',
    );
    applyGateSnapshotToCandidate(c, refreshedGate);
    // gateScore 가 비어 있을 때만 refreshedGate 원점수로 채운다.
    if (c.gateScore == null) {
      c.gateScore = refreshedGate.gateScore;
    }
    console.log(
      `[GateRefresh/Stage3] ${c.name}(${c.code}) ` +
        `dartFin=${c.dartFin ? "OK" : "null"} kisFlow=${c.kisFlow ? "OK" : "null"} ` +
        `gate2=${c.gateEvaluation?.gate2Passed ? "PASS" : "NO"} ` +
        `unavailable=${c.gateEvaluation?.unavailableKeys?.join("|") || "none"}`,
    );
  }

  // ── DART 조회 후 컨플루언스 재평가 (4축 완전체) ───────────────────────────
  const consecutiveNetBuyEnabled = isConsecutiveNetBuyObservationEnabled();
  // ADR-0615 — flag OFF → null → 산출·stamp no-op(byte-identical). 루프 전 sector별 1회 산출
  // (영속 read 1회, 신규 fetch 0. 동일 sector 후보 중복 산출 회피).
  const newsLagEntryWindowBySector = isNewsLagEntryWindowObservationEnabled()
    ? computeNewsLagEntryWindowBySector(
        candidates.map((c) => c.sector),
        loadActiveNewsSupplyRecordsForObservation(),
      )
    : null;
  for (const c of candidates) {
    c.confluenceResult = runConfluenceEngine({
      quote: c.quote,
      kisFlow: c.kisFlow ?? null,
      dartFin: c.dartFin ?? null,
      macroState,
      regime,
      gateScore: c.gateScore ?? 0,
      kospiDayReturn: macroState?.kospiDayReturn,
    });
    // ADR-0614 — runConfluenceEngine 직후 piggyback append(신규 fetch 0, KIS/KRX quota 0).
    // flag OFF → 진입 자체 skip(byte-identical). semantic OK 일 때만 기록은 ledger 모듈 책임.
    if (consecutiveNetBuyEnabled && c.kisFlow) {
      try {
        appendConsecutiveNetBuyObservation({
          stockCode: c.code,
          kisFlow: c.kisFlow,                 // 이미 fetch 된 값 — 신규 호출 0
          tradingDate: consecutiveNetBuyTodayKst(),
          provider: "KIS_API",
          marketCap: null,                    // 가용 경로 확인 전 null (가짜 비율 금지)
        });
      } catch { /* SDS-ignore: 관측 append 실패 격리, scan 본체 보호 (불변식 #1) */ }
    }
    // ADR-0615 — sector 조인 진입윈도우 관측 stamp(additive). flag OFF → bySector=null → skip(byte-identical).
    if (newsLagEntryWindowBySector) {
      try {
        const obs = newsLagEntryWindowBySector.get(c.sector);
        if (obs) c.newsLagEntryWindow = obs; // additive stamp, Gate/주문 미배선
      } catch { /* SDS-ignore: 관측 stamp 실패 격리, scan 본체 보호 (불변식 #1) */ }
    }
  }
  // ADR-0616 — Stage3 컨플루언스 루프 종료 직후 per-scan aggregate 1회(per-candidate 아님).
  // benchmark=동 스코프 macroState.kospi20dReturn 재사용(신규 read 0). flag OFF → 진입 skip(byte-identical).
  if (isUniverseCompositionBiasObservationEnabled()) {
    try {
      const obs = computeUniverseCompositionBiasObservation(
        candidates,
        macroState?.kospi20dReturn,
      );
      appendUniverseCompositionBiasObservation(obs);
    } catch { /* SDS-ignore: 구성 편향 관측 실패 격리, scan 본체 보호 (불변식 #1) */ }
  }
  // 결정적 평가 + Gemini는 topReasons만 자연어 생성 (Idea 5).
  // Gemini 호출 실패 시에도 결정적 결과는 유지되므로 파이프라인 안정성 향상.
  const results = (
    await runStage3Screening(candidates, regime, macroState)
  ).map((r) => ({
    ...r,
    sector: getSectorByCode(r.code), // 서버측 결정적 조회로 안전 덮어쓰기
  }));
  if (results.length === 0) {
    console.warn("[Pipeline/Stage3] 결정적 스크리닝 결과 없음 — 종료");
    return 0;
  }

  const watchlist = loadWatchlist();
  const existingCodes = new Set(watchlist.map((w) => w.code));
  const stopMap = STOP_RATES[regime] ?? STOP_RATES["R4_NEUTRAL"];
  const targetMap = TARGET_RATES[regime] ?? TARGET_RATES["R4_NEUTRAL"];
  let added = 0;

  for (const result of results) {
    if (result.signal === "SKIP") continue;
    if (existingCodes.has(result.code)) continue;

    const candidate = candidates.find((c) => c.code === result.code);
    const currentPrice = candidate?.quote.price ?? 0;
    if (currentPrice <= 0) continue;

    // 실계산 gate 점수로 필터 (Gemini 추정값 불사용)
    // gateScore 18 이상만 워치리스트 등록: 27조건 기준 약 67% 충족 수준으로
    // Wide Watchlist 품질을 높여 목표 전환율 12~18%를 달성하기 위한 임계값
    const realGateScore = candidate?.gateScore ?? 0;
    if (realGateScore < 18) continue;

    const profile = (
      ["A", "B", "C", "D"].includes(result.profile) ? result.profile : "B"
    ) as "A" | "B" | "C" | "D";
    const stopRate = stopMap[profile] ?? -0.1;
    const targetRate = targetMap[profile] ?? 0.15;

    const sl = Math.round(currentPrice * (1 + stopRate));
    const tp = Math.round(currentPrice * (1 + targetRate));
    const rrr = (tp - currentPrice) / Math.max(currentPrice - sl, 1);
    if (rrr < 2.0) continue;

    // 실계산 conditionKeys + Gemini 질적 조건 키 병합
    const realKeys = candidate?.gateCondKeys ?? [];
    const qualKeys = (result.passedConditionKeys ?? []).filter(
      (k) => !realKeys.includes(k),
    );

    // DART OPM 음수 → 적자기업 경고 (SKIP하지는 않지만 profile 강제 강등)
    const dartOPMNeg =
      candidate?.dartFin?.opm != null && candidate.dartFin.opm < 0;
    const finalProfile = dartOPMNeg && profile === "A" ? "B" : profile;

    // 신뢰도 스코어 계산
    const reliability = calcReliabilityScore(
      sourcesFromGateKeys(realKeys, {
        hasForeignNetBuy: (candidate?.kisFlow?.foreignNetBuy ?? 0) !== 0,
        hasInstitutionalNetBuy:
          (candidate?.kisFlow?.institutionalNetBuy ?? 0) !== 0,
        hasDartROE: candidate?.dartFin?.roe != null,
        hasDartOPM: candidate?.dartFin?.opm != null,
        hasDartDebtRatio: candidate?.dartFin?.debtRatio != null,
        hasDartOCFRatio: candidate?.dartFin?.ocfRatio != null,
        hasGeminiProfile: true,
        hasGeminiQual: true,
      }),
    );

    // 컨플루언스 신호 레이블
    const cf = candidate?.confluenceResult;
    const cfSignal = cf ? `${cf.signal} ${cf.bullishAxes}/4축` : "";
    const cycleEmoji =
      cf?.cyclePosition === "EARLY"
        ? "🌱"
        : cf?.cyclePosition === "LATE"
          ? "⚠️"
          : "📈";
    const catalystTag = cf ? `촉매${cf.catalystGrade}` : "";
    const confPart = cf
      ? `${cfSignal} ${cycleEmoji}${cf.cyclePosition} ${catalystTag}`
      : "";

    // ── Regret Asymmetry Filter — 직전 5거래일 급등 시 쿨다운 설정 ────────────
    const return5d = candidate?.quote.return5d ?? 0;
    const regretFilter = evaluateRegretAsymmetry(return5d, currentPrice);

    // Discovery Pipeline 종목: STRONG_BUY → SWING(즉시 매수대상), BUY → MOMENTUM(관찰 후 승격 대기)
    const section =
      result.signal === "STRONG_BUY"
        ? ("SWING" as const)
        : ("MOMENTUM" as const);

    const addResult = addToWatchlist(watchlist, {
      code: result.code,
      name: result.name,
      entryPrice: currentPrice,
      stopLoss: sl,
      targetPrice: tp,
      rrr: parseFloat(rrr.toFixed(2)),
      addedAt: new Date().toISOString(),
      addedBy: "AUTO",
      entryRegime: regime,
      profileType: finalProfile,
      gateScore: result.totalGateScore,
      stage1Score: candidate?.stage1Score,
      stage2Score: candidate?.stage2Score,
      totalGateScore: result.totalGateScore,
      watchlistPriorityScore: result.totalGateScore,
      gateEvaluation: candidate?.gateEvaluation
        ? {
          ...candidate.gateEvaluation,
          conditionKeys: candidate.gateCondKeys,
          outputs: candidate.gateOutputs,
        }
        : undefined,
      gateRawScore: candidate?.gateRawScore,
      availableMaxScore: candidate?.availableMaxScore,
      normalizedGateScore: candidate?.normalizedGateScore,
      symbolFeatures: {
        price: currentPrice || undefined,
        ma20: candidate?.quote.ma20,
        ma60: candidate?.quote.ma60,
        return5d: candidate?.quote.return5d,
        return20d: candidate?.quote.return20d,
        volume: candidate?.quote.volume,
        avgVolume: candidate?.quote.avgVolume,
        rsi14: candidate?.quote.rsi14,
        atr: candidate?.quote.atr,
        atr20avg: candidate?.quote.atr20avg,
        kospi20dReturn: macroState?.kospi20dReturn,
        // ADR-0621 — KOSDAQ 벤치마크 source + market 구분 carry (Gate2 RS 이원화).
        kosdaq20dReturn: macroState?.kosdaq20dReturn,
        market: getStockByCode(result.code)?.market,
        sector: result.sector,
        gateScore: candidate?.gateScore,
        stage1Score: candidate?.stage1Score,
        stage2Score: candidate?.stage2Score,
        totalGateScore: result.totalGateScore,
        watchlistPriorityScore: result.totalGateScore,
      },
      sector: result.sector, // runStage3Screening 후처리 단계에서 getSectorByCode로 확정됨
      memo: `${formatReliabilityBadge(reliability)} | ${confPart} | ${result.topReasons.slice(0, 2).join(", ")}`,
      expiresAt: addBusinessDays(
        new Date(),
        section === "SWING" ? 7 : 2,
      ).toISOString(),
      conditionKeys: [...realKeys, ...qualKeys],
      section,
      track: section === "MOMENTUM" ? "A" : "B",
      ...(regretFilter.isCooldown && {
        cooldownUntil: regretFilter.cooldownUntil,
        recentHigh: regretFilter.recentHigh,
      }),
    });
    if (!addResult.added) continue;
    existingCodes.add(result.code);
    added++;

    if (regretFilter.isCooldown) {
      console.log(
        `[Regret Asymmetry] ${result.name}(${result.code}) ${regretFilter.reason}`,
      );
    }
  }

  if (added > 0) {
    // section + isFocus 즉시 갱신 — cleanupWatchlist(16:00)까지 기다리지 않고 등록 직후 반영
    const focusCodes = computeFocusCodes(watchlist);
    const withSection = watchlist.map((w) => {
      const sec = assignSection(w, focusCodes);
      return {
        ...w,
        section: sec,
        isFocus: sec === "SWING",
        track: (sec === "MOMENTUM" ? "A" : "B") as "A" | "B",
      };
    });
    saveWatchlist(withSection);
    // Telegram 알림 — 신뢰도 배지 포함
    const registered = watchlist
      .filter(
        (w) =>
          results.some((r) => r.code === w.code) && !existingCodes.has(w.code),
      )
      .slice(0, 8);
    const summary = registered
      .map(
        (w) =>
          `  • ${w.name}(${w.code}) Gate ${w.gateScore}/27 | ${w.memo ?? ""}`,
      )
      .join("\n");

    // 같은 날 파이프라인이 재시도되거나 Stage1/Stage2/Stage3가 중복 호출돼도
    // Telegram "신규 워치리스트 N개 등록" 메시지는 하루 1회만 발송한다.
    const todayKey = new Date().toISOString().slice(0, 10);
    await sendTelegramAlert(
      `🔍 <b>[AI 파이프라인] 신규 워치리스트 ${added}개 등록</b>\n` +
        `레짐: ${regime} | 후보 ${candidates.length}개 → 등록 ${added}개\n` +
        `데이터: Yahoo OHLCV✅ DART재무${candidates.some((c) => c.dartFin) ? "✅" : "⚠️"} KIS수급${candidates.some((c) => c.kisFlow) ? "✅" : "⚠️"}\n` +
        summary,
      {
        dedupeKey: `pipeline_watchlist:${todayKey}`,
        cooldownMs: 12 * 60 * 60 * 1000,
      },
    ).catch(console.error);
  }

  console.log(
    `[Pipeline/Stage3] Gemini ${results.length}개 평가 → ${added}개 등록`,
  );
  return added;
}

// ── 전체 파이프라인 오케스트레이터 ────────────────────────────────────────────

/**
 * 3단계 자동 발굴 파이프라인 전체 실행 (기존 호환 — fallback용).
 * Stage1 캐시가 없을 때 08:35 cron에서 전체 파이프라인을 한 번에 실행.
 */
export async function runFullDiscoveryPipeline(
  regime: RegimeLevel,
  macroState: MacroState | null,
): Promise<void> {
  const start = Date.now();
  console.log(`[Pipeline] 자동 발굴 파이프라인 시작 (레짐: ${regime})`);

  // ADR-0184 (PR-B12-A) — master health guard. ENV default OFF.
  if (!(await ensureScannerMasterUsable("Pipeline"))) return;

  try {
    // Stage 1 — 양적 1차 필터
    const stage1 = await stage1QuantFilter();
    if (stage1.length === 0) {
      console.log("[Pipeline] Stage1 결과 없음 — 종료");
      return;
    }

    // Stage 2 — 섹터 + Gate 필터
    const stage2 = await stage2SectorGateFilter(stage1, regime, macroState);
    if (stage2.length === 0) {
      console.log("[Pipeline] Stage2 통과 종목 없음 — 종료");
      return;
    }

    // Stage 3 — Gemini 배치 + 워치리스트 등록
    const added = await stage3AIScreenAndRegister(stage2, regime);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Pipeline] 완료 — ${added}개 등록, ${elapsed}초 소요`);
  } catch (e) {
    console.error(
      "[Pipeline] 파이프라인 오류:",
      e instanceof Error ? e.message : e,
    );
    await sendTelegramAlert(
      `⚠️ <b>[AI 파이프라인] 오류 발생</b>\n${e instanceof Error ? e.message : "알 수 없는 오류"}`,
    ).catch(console.error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2단계 분리 파이프라인 — Stage1 전날 16:30, Stage2+3 당일 08:35
// ═══════════════════════════════════════════════════════════════════════════════
//
// Stage1(220개 Yahoo 스캔)이 전체 시간의 80%를 차지.
// 전일 종가 데이터는 15:30 장마감 즉시 확정되므로 16:30에 Stage1을 선행 실행.
// 당일 08:35에는 전날 60개 후보에 대해 간밤 글로벌 신호를 반영한
// Stage2+3만 실행하면 5분 안에 완료.
//
// 이점:
//   - 이른 시간 이동 → 간밤 글로벌 신호 누락 문제 해결
//   - 08:35 실행 → 09:00 장 시작 전 충분한 여유 확보
//   - 16:30 Stage1 + 08:35 Stage2+3 분리 → 양쪽 문제 동시 해결
// ═══════════════════════════════════════════════════════════════════════════════

interface Stage1CacheData {
  cachedAt: string; // ISO — Stage1 실행 시각
  candidates: CandidateStock[];
}

function loadStage1Cache(): Stage1CacheData | null {
  ensureDataDir();
  if (!fs.existsSync(STAGE1_CACHE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STAGE1_CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function saveStage1Cache(data: Stage1CacheData): void {
  ensureDataDir();
  fs.writeFileSync(STAGE1_CACHE_FILE, JSON.stringify(data, null, 2));
}

/**
 * 1차 Pre-screening — 전날 16:30 KST 실행.
 * Stage1만 실행하여 220개 → 상위 60개 후보를 확정하고 캐시에 저장.
 * 전일 종가 데이터 기반이므로 15:30 장마감 직후 실행 가능.
 */
export async function runStage1PreScreening(): Promise<void> {
  const start = Date.now();
  console.log("[Pipeline/PreScreen] 1차 Pre-screening 시작 (Stage1 only)");

  // ADR-0184 (PR-B12-A) — master health guard. ENV default OFF.
  if (!(await ensureScannerMasterUsable("PreScreen"))) return;

  try {
    const stage1 = await stage1QuantFilter();
    if (stage1.length === 0) {
      console.log("[Pipeline/PreScreen] Stage1 결과 없음");
      return;
    }

    saveStage1Cache({
      cachedAt: new Date().toISOString(),
      candidates: stage1,
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `[Pipeline/PreScreen] 완료 — ${stage1.length}개 후보 캐시 저장, ${elapsed}초 소요`,
    );

    await sendTelegramAlert(
      `🔍 <b>[Pre-screening 완료] 16:30</b>\n` +
        `Stage1: ${stage1.length}개 후보 확정 → 캐시 저장\n` +
        `소요: ${elapsed}초 | 내일 08:35 Stage2+3 실행 예정`,
    ).catch(console.error);
  } catch (e) {
    console.error(
      "[Pipeline/PreScreen] 오류:",
      e instanceof Error ? e.message : e,
    );
    await sendTelegramAlert(
      `⚠️ <b>[Pre-screening 오류]</b>\n${e instanceof Error ? e.message : "알 수 없는 오류"}\n` +
        `내일 08:35에 전체 파이프라인으로 fallback 실행됩니다.`,
    ).catch(console.error);
  }
}

/**
 * 2차 Final-screening — 당일 08:35 KST 실행.
 * 전날 Stage1 캐시(60개)에 대해 간밤 글로벌 신호를 반영한 Stage2+3만 실행.
 * 캐시가 없거나 24시간 이상 경과 시 전체 파이프라인으로 fallback.
 */
export async function runStage2_3FinalScreening(
  regime: RegimeLevel,
  macroState: MacroState | null,
): Promise<void> {
  const start = Date.now();

  // ADR-0184 (PR-B12-A) — master health guard. ENV default OFF.
  if (!(await ensureScannerMasterUsable("FinalScreen"))) return;

  const cache = loadStage1Cache();

  // 캐시 유효성 검증: 존재 + 24시간 이내
  const cacheMaxAgeMs = 24 * 60 * 60 * 1000;
  const cacheValid =
    cache &&
    cache.candidates.length > 0 &&
    Date.now() - new Date(cache.cachedAt).getTime() < cacheMaxAgeMs;

  if (!cacheValid) {
    const finalFallbackDecision = evaluateKisChartFallbackAllowed(new Date(), "FINAL_SCREEN_FALLBACK");
    if (!finalFallbackDecision.allowed) {
      console.log(formatPreopenKisFallbackSkippedLog({
        stage: "FinalScreen",
        reason: finalFallbackDecision.reason,
        fallback: "KRX_CACHE_ONLY",
      }));
    } else {
      console.log(
        "[Pipeline/FinalScreen] Stage1 캐시 없음 또는 만료 — 전체 파이프라인 fallback",
      );
    }
    await runFullDiscoveryPipeline(regime, macroState);
    return;
  }

  console.log(
    `[Pipeline/FinalScreen] 2차 Final-screening 시작 — ` +
      `Stage1 캐시 ${cache.candidates.length}개 (${cache.cachedAt})`,
  );

  try {
    // Stage 2 — 섹터 + Gate 필터 (간밤 글로벌 신호 반영)
    const stage2 = await stage2SectorGateFilter(
      cache.candidates,
      regime,
      macroState,
    );
    if (stage2.length === 0) {
      console.log("[Pipeline/FinalScreen] Stage2 통과 종목 없음 — 종료");
      return;
    }

    // Stage 3 — Gemini 배치 + 워치리스트 등록
    const added = await stage3AIScreenAndRegister(stage2, regime);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(
      `[Pipeline/FinalScreen] 완료 — ${added}개 등록, ${elapsed}초 소요`,
    );

    await sendTelegramAlert(
      `🔍 <b>[Final-screening 완료] 08:35</b>\n` +
        `Stage1 캐시: ${cache.candidates.length}개 → Stage2: ${stage2.length}개 → 등록: ${added}개\n` +
        `소요: ${elapsed}초 (전체 파이프라인 대비 ~80% 단축)`,
    ).catch(console.error);
  } catch (e) {
    console.error(
      "[Pipeline/FinalScreen] 오류:",
      e instanceof Error ? e.message : e,
    );
    await sendTelegramAlert(
      `⚠️ <b>[Final-screening 오류]</b>\n${e instanceof Error ? e.message : "알 수 없는 오류"}`,
    ).catch(console.error);
  }
}
