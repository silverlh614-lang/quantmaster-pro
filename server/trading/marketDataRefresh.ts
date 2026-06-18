// @responsibility marketDataRefresh 매매 엔진 모듈
/**
 * marketDataRefresh.ts — 서버사이드 RegimeVariables 시장데이터 자동 갱신
 *
 * Yahoo Finance에서 4개 지수를 fetch해 classifyRegime()이 필요로 하는
 * 시장 지표를 계산하고 MacroState에 MERGE 저장한다.
 *
 * 커버하는 필드:
 *  ② 거시:   usdKrw, usdKrw20dChange, usdKrwDayChange
 *  ③ 수급:   foreignNetBuy5d, passiveActiveBoth (FSS 레코드에서)
 *  ④ 지수:   kospiAbove20MA, kospiAbove60MA, kospi20dReturn, kospiDayReturn
 *  ⑥ 신용:   shortSellingRatio (KRX 공매도 비율 공개 데이터)
 *  ⑦ 글로벌: spx20dReturn, dxy5dChange
 *
 * 커버하지 않는 필드 (별도 데이터 소스 필요):
 *  ① 변동성: vkospiDayChange, vkospi5dTrend  — regimeBridge가 vkospiRising 대용
 *  ⑤ 사이클: leadingSectorRS, sectorCycleStage — 섹터 데이터 별도 필요
 *  ⑥ 신용:   marginBalance5dChange — KRX 데이터 별도 필요
 */

import { loadMacroState, saveMacroState, type MacroState } from '../persistence/macroStateRepo.js';
import type { FssRecordsAgeInfo } from '../persistence/fssRepo.js';
import { checkAndNotifyRegimeChange } from './regimeBridge.js';
import { defaultWarnTtlSec, emitOperationalWarn } from '../observability/operationalWarn.js';
import { fetchKisMarketSupply } from '../clients/kisClient.js';
import type { MhsDegradeInfo } from '../engines/mhsDegrade.js';
import { deriveSectorCycle } from './sectorCycleClassifier.js';
import type {
  MacroRefreshReason,
  MarketRefreshComputed,
} from './marketDataRefresh/types.js';

// ADR-0580: 타입 선언 (ShortSellingSource/ShortSellingResult/DailyBar/YahooHealthSnapshot 등)
// 은 ./marketDataRefresh/types.js 로 추출됐다. 본 모듈을 통한 기존 import 경로 보존을 위해
// public 타입 표면을 re-export 한다 (byte-equivalent).
export * from './marketDataRefresh/types.js';

// ADR-0595: 시작/성공/실패/스킵 로깅 + P1 운영 경고 emit 은
// ./marketDataRefresh/refreshObservability.js 로 이동됐다 (순수 텍스트 move).
import {
  logMacroRefreshStarted,
  logMacroRefreshSuccess,
  logMacroRefreshFailed,
  logMacroRefreshSkipped,
  emitMacroDataHealthSummary,
  emitMarketDataProviderWarn,
} from './marketDataRefresh/refreshObservability.js';

// ADR-0595: 지수·거시 섹션(KOSPI/VKOSPI/USD-KRW/SPX/DXY/FRED/MHS) + Yahoo 차트 클라이언트는
// ./marketDataRefresh/indexMacroSections.js 로 이동됐다 (순수 텍스트 move).
// 기존 public API(fetchDailyBars 등)는 본 모듈에서 re-export 로 보존한다.
import {
  YF_HEADERS,
  refreshKospiSection,
  refreshKosdaqSection,
  refreshVkospiSection,
  refreshUsdKrwSection,
  refreshSpxSection,
  refreshDxySection,
  refreshFredSection,
  resolveMhsSection,
} from './marketDataRefresh/indexMacroSections.js';
export { getYahooHealthSnapshot, fetchDailyBars, fetchCloses, fetchLatestBar, computeVkospiDayChangeFromBars } from './marketDataRefresh/indexMacroSections.js';

// ADR-0595: 수급·신용 섹션(FSS 수급/KRX 공매도 폴백 체인/ECOS 신용잔고/FSS 11분류 raw)은
// ./marketDataRefresh/supplyCreditSections.js 로 이동됐다 (순수 텍스트 move).
// 기존 public API(fetchKrxShortSelling 등)는 본 모듈에서 re-export 로 보존한다.
import {
  computeFssVars,
  refreshShortSellingSection,
  refreshMarginBalanceSection,
  refreshFssDetailSection,
} from './marketDataRefresh/supplyCreditSections.js';
export { fetchKrxShortSelling, tallyConsecutiveForeignFlowDays, computeFssVars } from './marketDataRefresh/supplyCreditSections.js';

// ADR-0595: 섹터 에너지 resolve 섹션(입력 meta 해석·4-axis 품질 진단)은
// ./marketDataRefresh/sectorEnergySection.js 로 이동됐다 (순수 텍스트 move). 영속은 본체 merge 잔류.
import { resolveSectorEnergySection, type SectorEnergyResolved } from './marketDataRefresh/sectorEnergySection.js';

// ADR-0595: KIS 시장 프로그램 매매 섹션(스냅샷 조립·불변식 판정 포함)은
// ./marketDataRefresh/programMarketSection.js 로 이동됐다 (순수 텍스트 move).
import { refreshProgramMarketSection } from './marketDataRefresh/programMarketSection.js';

// ── MacroState MERGE 저장 객체 build SSOT — 조건부 spread 모음. ─────────────
function buildUpdatedMacroState(input: {
  existing: MacroState;
  computed: MarketRefreshComputed;
  updatedAt: string;
  updatedAtChanged: boolean;
  refreshAttemptAt: string;
  fssRecordsAgeSnapshot: FssRecordsAgeInfo;
  cycleClassification: ReturnType<typeof deriveSectorCycle>;
  mhsAxisSnapshot: { interestRate: number; liquidity: number; economy: number; risk: number } | undefined;
  mhsAxisSnapshotAt: string | undefined;
  mhsDegradeSnapshot: MhsDegradeInfo | undefined;
  sectorEnergy: SectorEnergyResolved;
}) {
  const {
    existing, computed, updatedAt, updatedAtChanged, refreshAttemptAt, fssRecordsAgeSnapshot,
    cycleClassification, mhsAxisSnapshot, mhsAxisSnapshotAt, mhsDegradeSnapshot,
  } = input;
  const {
    sectorEnergyResult, sectorEnergyUpdatedAt, sectorEnergyInputsResolved, sectorEnergyDataQuality,
    sectorEnergyValidSectorCount, sectorEnergyReasons, sectorEnergySourceTier, sectorEnergyFreshness,
    sectorEnergyCoverage, sectorEnergyConfidence, sectorEnergyDiagnostics, sectorEnergyQualityDiagnostic,
  } = input.sectorEnergy;
  return {
    ...existing,
    ...computed,
    updatedAt,
    lastRefreshAttemptAt: refreshAttemptAt,
    lastRefreshSuccessAt: new Date().toISOString(),
    lastRefreshError: undefined,
    refreshJobEnabled: true,
    refreshJobLastRunAt: refreshAttemptAt,
    refreshBlockedReason: 'NONE',
    writeSucceeded: true,
    updatedAtChanged,
    providerUsed: 'MARKET_DATA_REFRESH',
    fallbackUsed: sectorEnergyQualityDiagnostic?.fallbackUsed && sectorEnergyQualityDiagnostic.fallbackUsed !== 'NONE' ? sectorEnergyQualityDiagnostic.fallbackUsed : false,
    // sectorEnergyResult 가 갱신됐을 때만 덮어쓰기 — 실패 시 이전 값 보존.
    ...(sectorEnergyResult ? { sectorEnergyResult, sectorEnergyUpdatedAt } : {}),
    // ADR-0454: sectorEnergyInputs writer wiring — ADR-0343 L3 CACHE fallback 의 입력 데이터.
    // 본 PR 이전엔 reader (sectorEnergyProvider:1065) 만 있고 writer 0건이라 영구 dead code
    // 였음 (SilentDegradation 1건). sectorEnergyInputsResolved 가 채워진 사이클에만 영속 —
    // meta.inputs.length===0 또는 throw 시 이전 cache 보존.
    ...(sectorEnergyInputsResolved && sectorEnergyUpdatedAt
      ? {
          sectorEnergyInputs: sectorEnergyInputsResolved,
          sectorEnergyInputsUpdatedAt: sectorEnergyUpdatedAt,
        }
      : {}),
    // ADR-0125: dataQuality 메타는 항상 영속 (이전 캐시 reference 활용 시 STALE 판정 입력).
    // ADR-0399 (= 사용자 명시 ADR-0374): 4-axis (sourceTier/freshness/coverage/confidence)
    // + diagnostics 동시 영속 — `/sector_energy_diag` 명령 처음 실제 데이터 표시.
    ...(sectorEnergyDataQuality !== undefined
      ? {
          sectorEnergyDataQuality,
          sectorEnergyValidSectorCount,
          sectorEnergyReasons,
          ...(sectorEnergySourceTier !== undefined ? { sectorEnergySourceTier } : {}),
          ...(sectorEnergyFreshness !== undefined ? { sectorEnergyFreshness } : {}),
          ...(sectorEnergyCoverage !== undefined ? { sectorEnergyCoverage } : {}),
          ...(sectorEnergyConfidence !== undefined ? { sectorEnergyConfidence } : {}),
          ...(sectorEnergyDiagnostics !== undefined ? { sectorEnergyDiagnostics } : {}),
          // ADR-0423: SectorEnergy 데이터 진실성 진단 영속 (옵셔널, 후방호환).
          ...(sectorEnergyQualityDiagnostic !== undefined ? { sectorEnergyQualityDiagnostic } : {}),
        }
      : {}),
    // 사이클 분류가 가능했을 때만 덮어쓰기 — 실패 시 이전 stage / RS 유지.
    ...(cycleClassification
      ? {
          sectorCycleStage: cycleClassification.sectorCycleStage,
          leadingSectorRS:  cycleClassification.leadingSectorRS,
        }
      : {}),
    // ADR-0107 mhsAxis 4-axis 영속 — computeMacroIndex 성공 시에만 덮어쓰기.
    ...(mhsAxisSnapshot ? { mhsAxis: mhsAxisSnapshot, mhsAxisUpdatedAt: mhsAxisSnapshotAt } : {}),
    // ADR-0583 MHS 소스 저하 등급 영속 — computeMacroIndex 성공 시에만 덮어쓰기(실패 시 이전 값 보존).
    ...(mhsDegradeSnapshot
      ? {
          mhsSourcesOk: mhsDegradeSnapshot.sourcesOk,
          mhsConfidence: mhsDegradeSnapshot.confidence,
          mhsDegraded: mhsDegradeSnapshot.degraded,
        }
      : {}),
    // ADR-0136 fssRecordsAge 진단 영속 — getFssRecordsAge 항상 객체 반환 (MISSING 포함).
    fssRecordsAge: fssRecordsAgeSnapshot,
  };
}

export async function refreshMarketRegimeVars(reason: MacroRefreshReason = 'SCHEDULED'): Promise<MarketRefreshComputed> {
  const refreshAttemptAt = new Date().toISOString();
  logMacroRefreshStarted(reason);
  const existing = loadMacroState();
  if (!existing) {
    logMacroRefreshSkipped('MACRO_STATE_MISSING');
    emitMarketDataProviderWarn('MACRO_STATE_MISSING', {
      action: 'POST /macro/state required before refresh',
    });
    return {};
  }

  // macro refresh is observational data collection, not trade execution.  It must
  // continue through R6_DEFENSE / SELL_ONLY / SHADOW_ONLY / OBSERVE_ONLY and when
  // Keep this path independent from execution state.
  saveMacroState({
    ...existing,
    lastRefreshAttemptAt: refreshAttemptAt,
    refreshJobEnabled: true,
    refreshJobLastRunAt: refreshAttemptAt,
    refreshBlockedReason: 'NONE',
    writeSucceeded: true,
    updatedAtChanged: false,
  });

  try {
    const computed: MarketRefreshComputed = {};

  // ── ④ KOSPI (^KS11) 60일 — MA, 수익률 ──────────────────────────────────────
  await refreshKospiSection(computed);

  // ── ④-A KOSDAQ 20일 수익률 (ADR-0621 Gate2 RS 벤치마크 이원화 source — KRX-first, Yahoo fallback) ──
  await refreshKosdaqSection(computed);

  // ── ④-B VKOSPI — KRX OpenAPI 파생상품 지수 일별 우선, Yahoo fallback ───────
  await refreshVkospiSection(computed, existing);

  // ── ② USD/KRW (Yahoo `KRW=X` + ECOS 한국은행 공식 교차 검증, ADR-0071) ──────
  await refreshUsdKrwSection(computed);

  // ── ⑦ S&P500 (^GSPC) 20일 ────────────────────────────────────────────────
  await refreshSpxSection(computed);

  // ── ⑦ DXY (DX-Y.NYB) 5일 ────────────────────────────────────────────────
  await refreshDxySection(computed);

  // ── ③ FSS 수급 (서버 로컬 레코드) ────────────────────────────────────────
  const fssVars = computeFssVars();
  computed.foreignNetBuy5d  = fssVars.foreignNetBuy5d;
  computed.passiveActiveBoth = fssVars.passiveActiveBoth;  // ADR-0136: boolean | null
  computed.foreignContinuousBuyDays = fssVars.foreignContinuousBuyDays;
  // ADR-0136: fssRecordsAge 영속 — saveMacroState merge 단계에서 spread.
  const fssRecordsAgeSnapshot = fssVars.fssRecordsAge;
  // foreignFuturesSellDays — confluenceEngine 의 "외국인 5일+ 매도" 약세 신호 활성화.
  // 본 필드는 원래 선물 데이터 의도였으나 KIS/KRX 선물 fetch 인프라 부담 회피 위해
  // FSS 레코드 기반 외국인 *현물 연속 순매도* 일수로 매핑한다 (의미 근사 — 본질은
  // "외국인이 N일 연속 빠지고 있다" 약세 신호 동일). foreignContinuousBuyDays 와
  // 상호 배타적 (한쪽이 ≥1 이면 다른 쪽은 0).
  computed.foreignFuturesSellDays = fssVars.foreignContinuousSellDays;
  console.log(
    `[MarketRefresh] 수급: foreignNetBuy5d=${fssVars.foreignNetBuy5d.toFixed(0)}억, ` +
    `passiveActiveBoth=${fssVars.passiveActiveBoth}, ` +
    `연속매수=${fssVars.foreignContinuousBuyDays}일, ` +
    `연속매도=${fssVars.foreignContinuousSellDays}일, ` +
    `fssRecordsAge=${fssVars.fssRecordsAge.status}` +
    `${fssVars.fssRecordsAge.ageDays !== null ? `(${fssVars.fssRecordsAge.ageDays}일전)` : '(MISSING)'}`,
  );

  // ── ③-b KIS 코스피 전체 투자자별 수급 (실시간 보강) ─────────────────────
  // FSS 레코드가 0이거나 누락 시 KIS API로 당일 실시간 수급 데이터 보강.
  // KIS 외국인 순매수가 양수이면 FSS 연속매수 일수를 최소 1일로 보정 —
  // 당일 선행 매수가 포착된 시점에서 R3 강제 승급 판단이 1일 지연되지 않도록.
  const kisSupply = await fetchKisMarketSupply().catch(() => null);
  if (kisSupply) {
    console.log(
      `[MarketRefresh] KIS 수급 보강: 외국인=${kisSupply.foreignNetBuy.toLocaleString()}주, ` +
      `기관=${kisSupply.institutionNetBuy.toLocaleString()}주, 개인=${kisSupply.individualNetBuy.toLocaleString()}주`,
    );
    if (kisSupply.foreignNetBuy > 0 && fssVars.foreignContinuousBuyDays < 1) {
      computed.foreignContinuousBuyDays = 1;
      console.log('[MarketRefresh] KIS 당일 외국인 순매수 양수 — foreignContinuousBuyDays 1일 보정');
    }
  }

  // ── ③-c ADR-0138: KIS 시장 종합 프로그램 매매 추이 (코스피 시장 단위) ────
  await refreshProgramMarketSection(computed);

  // ── ⑥ KRX 공매도 비율 (코스피 전체) ──────────────────────────────────────
  await refreshShortSellingSection(computed);

  // ── ⑥-b ADR-0139: ECOS 신용공여잔액 5영업일 변화율 ───────────────────────
  await refreshMarginBalanceSection(computed);

  // ── ⑥-c ADR-0141 Stage 1: KRX 11분류 raw 데이터 영속 ───────────────────
  await refreshFssDetailSection(computed);

  // ── ⑧ FRED 거시 지표 (병렬 조회) ────────────────────────────────────────
  await refreshFredSection(computed);

  // ── ⑨ 아이디어 11: ECOS+FRED 기반 MHS 자체 계산 ─────────────────────────
  const { mhsAxisSnapshot, mhsAxisSnapshotAt, mhsDegradeSnapshot } = await resolveMhsSection(computed, existing);

  // ── ADR-0075 PR-4 wiring: 강세 섹터 Gate Score 가산점 SSOT 영속 ─────────────
  const sectorEnergy = await resolveSectorEnergySection(existing);

  // ── 섹터 사이클 분류 (sectorEnergyResult → sectorCycleStage / leadingSectorRS) ─
  // sectorCycleDashboard / regimeBridge / preflight / sizingTierDecider 가 read.
  // sectorEnergyResult 가 이번 사이클에 갱신된 경우에만 분류 시도 — 분류 결과가
  // null (leadingSectors=0) 이면 기존 값 보존 정책 (이전 stage 유지).
  const cycleClassification = sectorEnergy.sectorEnergyResult ? deriveSectorCycle(sectorEnergy.sectorEnergyResult) : null;
  if (cycleClassification) {
    console.log(
      `[MarketRefresh] sectorCycleStage=${cycleClassification.sectorCycleStage} ` +
      `· leadingSectorRS=${cycleClassification.leadingSectorRS}`,
    );
  }

  // ── MacroState에 MERGE 저장 ───────────────────────────────────────────────
  const updatedAt = new Date().toISOString();
  const updatedAtChanged = updatedAt !== existing.updatedAt;
  const updated = buildUpdatedMacroState({
    existing,
    computed,
    updatedAt,
    updatedAtChanged,
    refreshAttemptAt,
    fssRecordsAgeSnapshot,
    cycleClassification,
    mhsAxisSnapshot,
    mhsAxisSnapshotAt,
    mhsDegradeSnapshot,
    sectorEnergy,
  });
  saveMacroState(updated as typeof existing);
  emitMacroDataHealthSummary(updated);
  logMacroRefreshSuccess({ updatedAt, mhs: updated.mhs, vkospi: updated.vkospi, kospiDayReturn: updated.kospiDayReturn, writeSucceeded: true });
  console.log(`[MarketRefresh] MacroState 갱신 완료 — ${Object.keys(computed).length}개 필드`);

  // ── 레짐 전환 감지 + 즉시 알림 ─────────────────────────────────────────────
  await checkAndNotifyRegimeChange(updated as typeof existing).catch(console.error);

    return computed;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const latest = loadMacroState() ?? existing;
    saveMacroState({
      ...latest,
      lastRefreshAttemptAt: refreshAttemptAt,
      lastRefreshError: message,
      refreshJobEnabled: true,
      refreshJobLastRunAt: refreshAttemptAt,
      refreshBlockedReason: 'REFRESH_THROW',
      providerUsed: 'MARKET_DATA_REFRESH',
      writeSucceeded: false,
      updatedAtChanged: false,
    });
    logMacroRefreshFailed({ error: e, provider: 'MARKET_DATA_REFRESH', fallbackUsed: latest?.fallbackUsed });
    emitOperationalWarn({
      priority: 'P1',
      domain: 'DATA',
      code: 'P1_MACRO_DATA_HEALTH_DEGRADED',
      message: '[MarketRefresh] MacroState refresh failed and diagnostics were persisted',
      executionImpact: 'NONE',
      mode: 'DEGRADED',
      dedupKey: 'market-refresh:refresh-throw',
      ttlSec: defaultWarnTtlSec('P1'),
      details: {
        reason: 'providerIssue=true marketSignal=false',
        error: message,
        refreshBlockedReason: 'REFRESH_THROW',
      },
    });
    throw e;
  }
}
