// @responsibility 사전 스크리너 + 시간대별 워치리스트 자동 충전 핵심 로직 + 분해 모듈 barrel
/**
 * stockScreener.ts — KIS 4-TR 사전 스크리너 + autoPopulateWatchlist (ADR-0029).
 *
 * PR-55 분해 후 핵심 로직만 잔존:
 *   - preScreenStocks: KIS 순위 4-TR 병렬 → 80개 캐시 (장 전 스크리너)
 *   - autoPopulateWatchlist: 시간대별 3-Preset (MORNING/MIDDAY/CLOSE/OFFHOURS)
 *     워치리스트 자동 충전 + Gate 감사 + 탈락 로그
 *   - getScreenerCache: 캐시 조회 (지연 디스크 read)
 *
 * 본 파일은 외부 24 importer 가 의존하는 barrel 도 겸한다 — 분해된 6 파일의 모든
 * public export 를 다시 노출해 import 경로 변경 0건 보장.
 */

import fs from 'fs';
import { SCREENER_FILE, ensureDataDir } from '../persistence/paths.js';
import { loadWatchlist, saveWatchlist, MOMENTUM_ALERT_THRESHOLD, type WatchlistSection } from '../persistence/watchlistRepo.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { evaluateServerGate } from '../quantFilter.js';
import { realDataKisGet, HAS_REAL_DATA_CLIENT, KIS_IS_REAL, hasKisClientOverrides } from '../clients/kisClient.js';
import { loadMacroState } from '../persistence/macroStateRepo.js';
import { isPullbackSetup, addBusinessDays } from './pipelineHelpers.js';
import { recordGateAudit, recordGateAuditByStatus, flushGateAudit } from '../persistence/gateAuditRepo.js';
import { getLiveRegime } from '../trading/regimeBridge.js';
import { getCurrentScanPreset } from './scanPresets.js';
import { MOMENTUM_MAX_SIZE, SWING_MAX_SIZE, addToWatchlist } from './watchlistManager.js';

// ── PR-55 분해 후 모듈 import ───────────────────────────────────────────────
import { STOCK_UNIVERSE } from './stockUniverse.js';
import { type RejectionEntry, setLastRejectionLog } from './rejectionLog.js';
import {
  fetchYahooQuote,
  isYahooStaleQuarantined,
  getYahooStaleQuarantineRemainingMs,
  type YahooQuoteExtended,
} from './adapters/yahooQuoteAdapter.js';
import { fetchKisQuoteFallback, fetchKisIntraday, enrichQuoteWithKisMTAS } from './adapters/kisQuoteAdapter.js';
// PR-KIS-CHART-COOLDOWN — Yahoo STALE_BASE 분기에서 KIS 차트 cooldown 활성 여부
// 조회 SSOT. true 면 추가 outbound 호출 0건으로 quoteHydrationFailed 처리
// (STALE_YAHOO_AND_KIS_CHART_FAILED + SKIP_THIS_SCAN, providerIssue=true /
// marketSignal=false / executionImpact=NONE). #974 KIS chart 5xx cooldown
// 인프라 위에 stack — 운영자 Telegram 알림 0건, 전체 스캔 흐름 무중단.
import { getKisChartCooldownRemainingMs, isKisChartCooldownActive } from '../clients/kisClient.js';
import { fetchKrxScreenerFallback } from './adapters/krxScreenerAdapter.js';
import { isKstPreopenDiscoveryWindow, PREOPEN_AUTOPOPULATE_TTL_MS } from '../utils/preopenDiscoveryGuards.js';
// ADR-0443 — yahooSymbolResolver SSOT 위임 — `${s.code}.KS` direct concat 영구
// 차단. screenerSymbols 의 symbol 필드 마스터 매칭 격상 (정확한 시장) + 부재 시
// legacy .KS fallback 보존 (그레이스 — 코스닥도 Yahoo 에서 .KS 로 조회 가능).
import { fetchYahooQuoteByCode, tryGetYahooSymbol } from './adapters/yahooSymbolResolver.js';
// ADR-0128 §Wiring 1B: 워치리스트 신규 후보 incremental 검증 (WATCHLIST role).
// 워치리스트 등록 자체는 차단 금지 — alert 보류 + UI 마킹만 영향 (markDataQuarantine).
import { verifyStockIncremental } from '../data/dataVerificationIncremental.js';
import { markDataQuarantine } from '../persistence/watchlistRepo.js';
// Patch-WATCHLIST-SATURATION-COOLDOWN-001 — MOMENTUM AUTO 편입 감속 SSOT.
// autoRatio >= 0.8 && MOMENTUM count >= alertCap(30) 일 때 사이클당 신규 AUTO
// 편입을 MOMENTUM_AUTO_ADD_PER_CYCLE(3) 이하로 제한 + 최근 cleanup/탈락된
// MOMENTUM AUTO 종목 re-add cooldown(120분). SWING/CATALYST/MANUAL/보유/force buy
// 무영향. 신규 KIS 호출 0건 — 순수 결정 함수 + in-memory snapshot diff.
import {
  evaluateMomentumAutoIntake,
  syncMomentumAutoSnapshot,
  isMomentumReAddBlocked,
} from './momentumAutoIntakePolicy.js';

// ── 본 모듈 자체에서 정의·노출하는 핵심 타입 ──────────────────────────────
export interface ScreenedStock {
  code: string;
  name: string;
  currentPrice: number;
  changeRate: number;     // 등락률 (%)
  volume: number;
  turnoverRate: number;   // 회전율 (%)
  per: number;
  foreignNetBuy: number;  // 외국인 순매수량 (당일)
  screenedAt: string;
}

const PRE_SCREEN_MAX_RESULTS = 40;
let preopenAutoPopulateLastAllowedAt = 0;

/**
 * ADR-0418 Phase 3 (2026-05-07) — registry.run 이 evaluator.inputs 메타로부터
 * `requiredData` / `availableData` / `hadRequiredData` 를 자동 생성하여 호출자
 * (stockScreener) 가 evaluator-specific knowledge 를 가질 필요 없음.
 *
 * 이전 ADR-0416 Phase 1 의 `DATA_DEPENDENT_EVALUATORS_WITH_INTENTIONAL_SCREENING_NULL`
 * 임시 inclusion list 는 본 ADR-0418 에서 *영구 제거*. evaluator 가 자신의 외부
 * 데이터 의존성을 `inputs: ['ctx.kisFlow.X', 'ctx.dartFin.Y']` 로 선언하면 registry
 * 가 자동으로 `hadRequiredData: false` 를 합성하여 audit 가 unavailable++ 분류.
 */


export function getScreenerCache(): ScreenedStock[] {
  ensureDataDir();
  if (!fs.existsSync(SCREENER_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(SCREENER_FILE, 'utf-8')); } catch { return []; }
}

/**
 * 아이디어 4 확장: 장 전 사전 스크리너 — KIS 4개 TR 병렬 호출
 *
 * 1단계: KIS 순위 TR 4개 병렬 호출
 *   - 거래량 상위 (FHPST01710000)
 *   - 상승률 상위 (FHPST01700000)
 *   - 52주 신고가 (FHPST01760000) — 주도주 포착 핵심
 *   - 외국인 순매수 상위 (FHPST01600000) — 수급 기반 핵심
 * 2단계: 결과 통합 + 중복 제거 (복수 TR 등장 종목 우선)
 * 3단계: 상위 80개 캐시 저장 → Yahoo 기술적 지표 보완 대상
 */
export async function preScreenStocks(options?: {
  /** KIS 시장 구분 코드: J=KOSPI, Q=KOSDAQ (기본 J) */
  marketDivCode?: string;
}): Promise<ScreenedStock[]> {
  if (!process.env.KIS_APP_KEY && !HAS_REAL_DATA_CLIENT) return [];

  const marketDiv = options?.marketDivCode ?? 'J';

  // 순위 TR은 실계좌 전용 — VTS에서 미지원
  // 단, 실계좌 데이터 키(KIS_REAL_DATA_APP_KEY) 설정 시 하이브리드 모드로 조회 가능
  // VTS mock override가 설치된 경우에도 mock 데이터로 순위 TR 실행 허용
  if (!KIS_IS_REAL && !HAS_REAL_DATA_CLIENT && !hasKisClientOverrides()) {
    console.warn(
      '[Screener] 모의투자(VTS) 모드 — 순위 TR 미지원. ' +
      '캐시된 스크리너 결과를 반환합니다. 실계좌 데이터 키 또는 KIS_IS_REAL=true 설정 후 사용 가능.'
    );
    return getScreenerCache();
  }

  try {
    // ── 병렬로 4개 TR 동시 호출 ────────────────────────────────
    const [volData, riseData, highData, foreignData] = await Promise.allSettled([

      // 1. 거래량 상위 (기존)
      realDataKisGet('FHPST01710000', '/uapi/domestic-stock/v1/ranking/volume', {
        fid_cond_mrkt_div_code: marketDiv,
        fid_cond_scr_div_code:  '20171',
        fid_input_iscd:         '0000',
        fid_div_cls_code:       '0',
        fid_blng_cls_code:      '0',
        fid_trgt_cls_code:      '111111111',
        fid_trgt_exls_cls_code: '000000',
        fid_input_price_1:      '3000',   // 3천원으로 완화
        fid_input_price_2:      '500000',
        fid_vol_cnt:            '50000',   // 5만주로 완화
        fid_input_date_1:       '',
        __kisPurpose:          'SCREENER',
      }),

      // 2. 상승률 상위 (신규)
      realDataKisGet('FHPST01700000', '/uapi/domestic-stock/v1/ranking/fluctuation', {
        fid_cond_mrkt_div_code: marketDiv,
        fid_cond_scr_div_code:  '20170',
        fid_input_iscd:         '0000',
        fid_rank_sort_cls_code: '0',       // 상승률 상위
        fid_input_cnt_1:        '40',
        fid_prc_cls_code:       '1',
        fid_input_price_1:      '3000',
        fid_input_price_2:      '500000',
        fid_vol_cnt:            '50000',
        fid_trgt_cls_code:      '0',
        fid_trgt_exls_cls_code: '0',
        fid_div_cls_code:       '0',
        fid_rsfl_rate1:         '1',       // 1% 이상 상승
        fid_rsfl_rate2:         '15',      // 15% 미만 (과열 제외)
        __kisPurpose:          'SCREENER',
      }),

      // 3. 52주 신고가 (신규) — 주도주 포착 핵심
      realDataKisGet('FHPST01760000', '/uapi/domestic-stock/v1/ranking/new-high-low', {
        fid_cond_mrkt_div_code: marketDiv,
        fid_cond_scr_div_code:  '20176',
        fid_input_iscd:         '0000',
        fid_rank_sort_cls_code: '0',       // 신고가
        fid_input_cnt_1:        '40',
        fid_vol_cnt:            '50000',
        fid_trgt_cls_code:      '0',
        fid_trgt_exls_cls_code: '0',
        fid_div_cls_code:       '0',
        __kisPurpose:          'SCREENER',
      }),

      // 4. 외국인 순매수 상위 (신규) — 수급 기반 핵심
      realDataKisGet('FHPST01600000', '/uapi/domestic-stock/v1/ranking/investor', {
        fid_cond_mrkt_div_code: marketDiv,
        fid_cond_scr_div_code:  '20160',
        fid_input_iscd:         '0000',
        fid_inqr_dvsn_cls_code: '0',       // 순매수
        fid_div_cls_code:       '0',
        fid_rank_sort_cls_code: '1',       // 외국인
        fid_input_cnt_1:        '40',
        fid_trgt_cls_code:      '111111111',
        fid_trgt_exls_cls_code: '000000',
        fid_vol_cnt:            '50000',
        fid_input_price_1:      '3000',
        fid_input_price_2:      '500000',
        __kisPurpose:          'SCREENER',
      }),
    ]);

    const now = new Date().toISOString();

    // ── 결과 통합 + 중복 제거 ───────────────────────────────────
    const codeMap = new Map<string, ScreenedStock & { sources: string[] }>();

    const mergeOutput = (
      result: PromiseSettledResult<unknown>,
      source: string,
      mapper: (s: Record<string, string>) => ScreenedStock | null,
    ) => {
      if (result.status !== 'fulfilled') return;
      const raw = (result.value as { output?: Record<string, string>[] })?.output ?? [];
      for (const s of raw) {
        const mapped = mapper(s);
        if (!mapped || !mapped.code) continue;
        if (codeMap.has(mapped.code)) {
          codeMap.get(mapped.code)!.sources.push(source);
        } else {
          codeMap.set(mapped.code, { ...mapped, sources: [source] });
        }
      }
    };

    // 관리종목 · 거래정지 · 정리매매 · 투자위험 필터 (부실기업 제외)
    // KIS 랭킹 TR 출력의 공통 상태 필드를 사용:
    //   trht_yn='Y'   → 거래정지
    //   sltr_yn='Y'   → 정리매매
    //   mang_issu_cls_code/mang_issu_yn='Y' → 관리종목
    //   mrkt_warn_cls_code='02'(경고)·'03'(위험) → 투자경고/위험
    //   iscd_stat_cls_code '51'(관리)·'58'(정지) → 종목상태
    const isRiskyKisRow = (s: Record<string, string>): boolean => {
      if ((s.trht_yn ?? '').toUpperCase() === 'Y') return true;
      if ((s.sltr_yn ?? '').toUpperCase() === 'Y') return true;
      if ((s.mang_issu_yn ?? '').toUpperCase() === 'Y') return true;
      if ((s.mang_issu_cls_code ?? '').toUpperCase() === 'Y') return true;
      const warnCode = s.mrkt_warn_cls_code ?? '';
      if (warnCode === '02' || warnCode === '03') return true;
      const statCode = s.iscd_stat_cls_code ?? '';
      if (statCode === '51' || statCode === '52' || statCode === '58') return true;
      return false;
    };

    // 거래량 상위 매핑
    mergeOutput(volData, 'VOL', (s) => {
      if (isRiskyKisRow(s)) return null;
      return {
      code:          s.stck_shrn_iscd  ?? '',
      name:          s.hts_kor_isnm    ?? '',
      currentPrice:  parseInt(s.stck_prpr      ?? '0', 10),
      changeRate:    parseFloat(s.prdy_ctrt    ?? '0'),
      volume:        parseInt(s.acml_vol       ?? '0', 10),
      turnoverRate:  parseFloat(s.acml_tr_pbmn ?? '0'),
      per:           parseFloat(s.per          ?? '999'),
      foreignNetBuy: parseInt(s.frgn_ntby_qty  ?? '0', 10),
      screenedAt:    now,
    };
    });

    // 상승률 상위 매핑
    mergeOutput(riseData, 'RISE', (s) => {
      if (isRiskyKisRow(s)) return null;
      return {
      code:          s.stck_shrn_iscd  ?? '',
      name:          s.hts_kor_isnm    ?? '',
      currentPrice:  parseInt(s.stck_prpr      ?? '0', 10),
      changeRate:    parseFloat(s.prdy_ctrt    ?? '0'),
      volume:        parseInt(s.acml_vol       ?? '0', 10),
      turnoverRate:  parseFloat(s.acml_tr_pbmn ?? '0'),
      per:           parseFloat(s.per          ?? '999'),
      foreignNetBuy: parseInt(s.frgn_ntby_qty  ?? '0', 10),
      screenedAt:    now,
    };
    });

    // 52주 신고가 매핑
    mergeOutput(highData, 'HIGH52W', (s) => {
      if (isRiskyKisRow(s)) return null;
      return {
      code:          s.stck_shrn_iscd  ?? '',
      name:          s.hts_kor_isnm    ?? '',
      currentPrice:  parseInt(s.stck_prpr      ?? '0', 10),
      changeRate:    parseFloat(s.prdy_ctrt    ?? '0'),
      volume:        parseInt(s.acml_vol       ?? '0', 10),
      turnoverRate:  0,
      per:           parseFloat(s.per          ?? '999'),
      foreignNetBuy: 0,
      screenedAt:    now,
    };
    });

    // 외국인 순매수 상위 매핑
    mergeOutput(foreignData, 'FOREIGN', (s) => {
      if (isRiskyKisRow(s)) return null;
      return {
      code:          s.stck_shrn_iscd  ?? '',
      name:          s.hts_kor_isnm    ?? '',
      currentPrice:  parseInt(s.stck_prpr      ?? '0', 10),
      changeRate:    parseFloat(s.prdy_ctrt    ?? '0'),
      volume:        parseInt(s.acml_vol       ?? '0', 10),
      turnoverRate:  0,
      per:           999,
      foreignNetBuy: parseInt(s.frgn_ntby_qty  ?? '0', 10),
      screenedAt:    now,
    };
    });

    // ── 복수 TR에 등장한 종목 우선 정렬 ────────────────────────
    // 거래량+상승률+신고가+외국인 동시에 잡힌 종목 = 최강 후보
    const getOutputLen = (r: PromiseSettledResult<unknown>): number =>
      r.status === 'fulfilled'
        ? ((r.value as { output?: unknown[] })?.output?.length ?? 0)
        : 0;

    const candidates = Array.from(codeMap.values())
      .filter(s =>
        s.code &&
        s.currentPrice > 0 &&
        s.changeRate > -5 &&
        s.changeRate < 20
      )
      .sort((a, b) => {
        // 복수 TR 등장 종목 우선
        const scoreDiff = b.sources.length - a.sources.length;
        if (scoreDiff !== 0) return scoreDiff;
        return b.volume - a.volume;
      })
      .slice(0, 80);  // 최대 80개 (Yahoo 보완 대상)

    // sources 필드 제거 후 저장 (ScreenedStock 인터페이스 호환)
    const toSave: ScreenedStock[] = candidates.map(({ sources: _sources, ...rest }) => rest);

    console.log(
      `[Screener] KIS 4개 TR 통합 — ` +
      `거래량:${getOutputLen(volData)} ` +
      `상승률:${getOutputLen(riseData)} ` +
      `신고가:${getOutputLen(highData)} ` +
      `외국인:${getOutputLen(foreignData)} ` +
      `→ 통합 후 ${codeMap.size}개 → 상위 ${candidates.length}개` +
      (candidates.filter(c => c.sources.length >= 2).length > 0
        ? ` (복수TR ${candidates.filter(c => c.sources.length >= 2).length}개)`
        : '')
    );

    ensureDataDir();
    fs.writeFileSync(SCREENER_FILE, JSON.stringify(toSave, null, 2));

    // ── 아이디어 2: KIS 결과가 0건이면 KRX OpenAPI로 폴백 ──────────────────
    // KIS 4개 TR이 모두 비었거나 한국투자증권 서버 장애 시 KRX 정보데이터시스템
    // (data.krx.co.kr) 에서 투자자별 거래실적 + PER/PBR 을 수집해 최소 후보군을
    // 확보한다. 법적 리스크 0, 무료, 공식 채널.
    if (toSave.length === 0) {
      const krxFallback = await fetchKrxScreenerFallback();
      if (krxFallback.length > 0) {
        fs.writeFileSync(SCREENER_FILE, JSON.stringify(krxFallback, null, 2));
        console.log(`[Screener] KIS 빈 결과 → KRX 폴백 ${krxFallback.length}개 종목 적재`);
        return krxFallback;
      }
    }
    return toSave;
  } catch (e: unknown) {
    console.error('[Screener] 실패:', e instanceof Error ? e.message : e);
    // KIS 예외 경로도 KRX로 한 번 더 시도.
    const krxFallback = await fetchKrxScreenerFallback();
    if (krxFallback.length > 0) {
      ensureDataDir();
      fs.writeFileSync(SCREENER_FILE, JSON.stringify(krxFallback, null, 2));
      console.log(`[Screener] KIS 예외 → KRX 폴백 ${krxFallback.length}개 종목 적재`);
      return krxFallback;
    }
    return [];
  }
}


/**
 * Yahoo Finance 기반 자동 워치리스트 채우기 — 아이디어 8: 2-Track 구조
 *
 * Track A (Candidate Pool): 느슨한 조건으로 후보군 최대한 유지
 *   - changePercent > -3% (기존 -2%/-5% → -3% 단일 기준)
 *   - 거래량 조건 없음 (기존 avgVolume*1.2 필터 제거)
 *   - Gate SKIP 허용 (MTAS만으로 차단되지 않음)
 *
 * Track B (Buy Watch): signalScanner에서 Focus 선정 시 승격
 *   - 기존 Gate Score + FOCUS_LIST_SIZE 기준 적용
 *
 * 손절: 현재가 -8%, 목표: 현재가 +15%
 */
export async function autoPopulateWatchlist(options: { force?: boolean } = {}): Promise<number> {
  if (isKstPreopenDiscoveryWindow() && !options.force) {
    const now = Date.now();
    const remainingMs = PREOPEN_AUTOPOPULATE_TTL_MS - (now - preopenAutoPopulateLastAllowedAt);
    if (preopenAutoPopulateLastAllowedAt > 0 && remainingMs > 0) {
      console.info(
        `[PREOPEN_AUTOPOPULATE_SKIPPED]\n`
        + `reason=PREOPEN_AUTOPOPULATE_TTL_ACTIVE\n`
        + `remainingMs=${remainingMs}\n`
        + `executionImpact=NONE\n`
        + `marketSignal=false\n`
        + `providerIssue=false`,
      );
      return 0;
    }
    preopenAutoPopulateLastAllowedAt = now;
    console.info(
      `[PREOPEN_AUTOPOPULATE_ALLOWED]\n`
      + `reason=PREOPEN_AUTOPOPULATE_TTL_EXPIRED\n`
      + `ttlMs=${PREOPEN_AUTOPOPULATE_TTL_MS}\n`
      + `executionImpact=NONE`,
    );
  }

  const watchlist = loadWatchlist();
  const existingCodes = new Set(watchlist.map(w => w.code));
  let added = 0;

  // 아이디어 5: 탈락 사유 추적 — 매 실행마다 초기화
  const rejectionLog: RejectionEntry[] = [];

  // Patch-WATCHLIST-SATURATION-COOLDOWN-001 — MOMENTUM AUTO 편입 감속 평가.
  //   - autoRatio >= 0.8 && MOMENTUM count >= 30 → 사이클당 신규 AUTO 편입 3개 이하로 제한
  //   - 직전 사이클 대비 사라진 (cleanup/탈락) MOMENTUM AUTO 종목은 re-add cooldown
  //   - 본 가드는 *신규 후보 편입* 만 제한 — 보유/Shadow 포지션·SWING·CATALYST·MANUAL 무영향
  const momentumEntries = watchlist.filter(
    (w) => w.section === 'MOMENTUM' || (!w.section && w.track === 'A'),
  );
  const momentumAutoEntries = momentumEntries.filter(
    (w) => (w.addedBy ?? 'AUTO') === 'AUTO',
  );
  const intake = evaluateMomentumAutoIntake({
    momentumCount: momentumEntries.length,
    alertCap: MOMENTUM_ALERT_THRESHOLD,
    autoCount: momentumAutoEntries.length,
    manualCount: momentumEntries.filter((w) => w.addedBy === 'MANUAL').length,
    dartCount: momentumEntries.filter((w) => w.addedBy === 'DART').length,
  });
  syncMomentumAutoSnapshot(momentumAutoEntries.map((w) => w.code));
  let autoMomentumAddedThisCycle = 0;
  const cycleId = `AUTOPOPULATE:${Date.now()}`;
  const momentumLimitedSamples: string[] = [];
  let momentumLimitedCount = 0;
  if (intake.slowed) {
    console.log(
      `[MOMENTUM_AUTO_INTAKE_SLOWED] ${intake.reason} — ` +
        `perCycleLimit=${intake.perCycleLimit} ` +
        `executionImpact=NONE marketSignal=false providerIssue=false`,
    );
  }
  /** MOMENTUM AUTO 신규 편입 가드 — 차단 시 rejectionLog push 후 호출자가 continue. */
  const momentumAutoIntakeBlocked = (
    code: string,
    name: string,
  ): boolean => {
    if (isMomentumReAddBlocked(code)) {
      rejectionLog.push({
        code,
        name,
        reason: 'MOMENTUM 재편입 cooldown (최근 cleanup/탈락 — re-add 차단)',
      });
      return true;
    }
    if (intake.slowed && autoMomentumAddedThisCycle >= intake.perCycleLimit) {
      rejectionLog.push({
        code,
        name,
        reason: `MOMENTUM AUTO 편입 감속 (사이클당 ${intake.perCycleLimit}개 한도)`,
      });
      momentumLimitedCount++;
      if (momentumLimitedSamples.length < 10) momentumLimitedSamples.push(`${name}(${code})`);
      console.debug(
        `[MOMENTUM_AUTO_INTAKE_LIMITED_DEBUG] ${name}(${code}) — ` +
          `autoRatio=${intake.autoRatio.toFixed(2)} perCycleLimit=${intake.perCycleLimit} ` +
          `addedThisCycle=${autoMomentumAddedThisCycle} executionImpact=NONE`,
      );
      return true;
    }
    return false;
  };

  // 실계좌: preScreenStocks 결과 → 워치리스트 승격
  if (KIS_IS_REAL) {
    const screened = getScreenerCache().slice(0, PRE_SCREEN_MAX_RESULTS);
    for (const s of screened) {
      if (existingCodes.has(s.code)) continue;
      if (s.changeRate < 0 || s.changeRate >= 8) {
        rejectionLog.push({ code: s.code, name: s.name, reason: s.changeRate < 0 ? `음봉 ${s.changeRate.toFixed(1)}%` : `과열 +${s.changeRate.toFixed(1)}%` });
        continue;
      }
      if (s.foreignNetBuy < 0) {
        rejectionLog.push({ code: s.code, name: s.name, reason: `외국인순매도 ${s.foreignNetBuy.toLocaleString()}주` });
        continue;
      }

      // Patch-WATCHLIST-SATURATION-COOLDOWN-001 — MOMENTUM AUTO 편입 감속 가드
      // (스크리너 경로는 항상 section='MOMENTUM' AUTO — 전건 적용).
      if (momentumAutoIntakeBlocked(s.code, s.name)) continue;

      const sl = Math.round(s.currentPrice * 0.92);
      const tp = Math.round(s.currentPrice * 1.20);
      const addResult = addToWatchlist(watchlist, {
        code: s.code,
        name: s.name,
        entryPrice: s.currentPrice,
        stopLoss: sl,
        targetPrice: tp,
        addedAt: new Date().toISOString(),
        addedBy: 'AUTO',
        rrr: parseFloat(((tp - s.currentPrice) / (s.currentPrice - sl || 1)).toFixed(2)),
        section: 'MOMENTUM' as WatchlistSection,
        track: 'A',
        expiresAt: addBusinessDays(new Date(), 2).toISOString(), // MOMENTUM: 2영업일 만료
      });
      if (!addResult.added) {
        const momentumCount = watchlist.filter(w => w.section === 'MOMENTUM').length;
        rejectionLog.push({ code: s.code, name: s.name, reason: `MOMENTUM 만석(${momentumCount}/${MOMENTUM_MAX_SIZE})` });
        continue;
      }
      existingCodes.add(s.code);
      added++;
      autoMomentumAddedThisCycle++;
      console.log(`[AutoPopulate] 스크리너 → 워치리스트 [MOMENTUM]: ${s.name}(${s.code}) @${s.currentPrice.toLocaleString()}`);

      // ADR-0128 §Wiring 1B: 등록 자체는 보존, sanity 위반 시 markDataQuarantine 으로 alert 보류.
      try {
        const _verifyKis = await verifyStockIncremental(s.code, 'WATCHLIST');
        if (!_verifyKis.verified && _verifyKis.dataQuality) {
          markDataQuarantine(s.code, _verifyKis.dataQuality);
        }
      } catch (err) {
        console.warn(`[autoPopulateWatchlist] verify error (skip): ${s.code} — ${(err as Error).message}`);
      }
    }
  }

  // ── Yahoo Finance 기반 기술적 지표 보완 ─────────────────────────────
  // 실계좌: KIS 4개 TR 스크리닝 결과(캐시) 기반으로 후보군 축소
  // VTS/폴백: 기존 동적 확장 유니버스 사용
  const screenerSymbols = getScreenerCache().slice(0, PRE_SCREEN_MAX_RESULTS).map(s => ({
    // ADR-0443 — 마스터 매칭 시 정확한 시장 (.KS / .KQ), 부재 시 legacy .KS fallback
    // (코스닥도 Yahoo 에서 .KS 로 조회 가능 — 그레이스 동작 보존).
    symbol: tryGetYahooSymbol(s.code) ?? `${s.code}.KS`,
    code: s.code,
    name: s.name,
  }));
  const { getExpandedUniverse } = await import('./dynamicUniverseExpander.js');
  const scanUniverse = screenerSymbols.length > 0 ? screenerSymbols : getExpandedUniverse();

  // ── 시간대별 3-Preset: MORNING/MIDDAY/CLOSE/OFFHOURS ─────────────────────
  // 기존 하드컷(quote.changePercent >= 8, < -3, return5d > 20)을 시간 커브로 교체.
  const preset = getCurrentScanPreset();
  console.log(
    `[AutoPopulate] 스캔 대상: ${scanUniverse.length}개` +
    (screenerSymbols.length > 0 ? ' (KIS 스크리너 캐시 기반)' : ' (정적 유니버스 폴백)') +
    ` | 프리셋: ${preset.phase} (${preset.label})`,
  );
  for (const stock of scanUniverse) {
    if (existingCodes.has(stock.code)) continue;
    if (isYahooStaleQuarantined(stock.code)) {
      rejectionLog.push({
        code: stock.code,
        name: stock.name,
        reason: `Yahoo stale discovery quarantine active (${getYahooStaleQuarantineRemainingMs(stock.code)}ms remaining)`,
      });
      continue;
    }
    if (isKisChartCooldownActive(stock.code, 'D', 'DISCOVERY')) {
      console.info(
        `[DISCOVERY_CANDIDATE_SKIPPED_BY_KIS_CHART_COOLDOWN]\n`
        + `trId=FHKST03010100\n`
        + `symbol=${stock.code}\n`
        + `period=D\n`
        + `purpose=DISCOVERY\n`
        + `remainingMs=${getKisChartCooldownRemainingMs({ symbol: stock.code, period: 'D', purpose: 'DISCOVERY' })}\n`
        + `executionImpact=NONE\n`
        + `marketSignal=false`,
      );
      rejectionLog.push({ code: stock.code, name: stock.name, reason: 'KIS chart cooldown active (DISCOVERY skip)' });
      continue;
    }

    const quote = await fetchYahooQuoteByCode(stock.code, fetchYahooQuote);
    if (!quote || quote.price <= 0) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: '시세조회실패' });
      continue;
    }

    // 거래중지/관리종목/위험 분류 종목 제외
    if (quote.isHighRisk) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: '거래중지/위험종목' });
      continue;
    }

    // ─── ADR-0411 — Yahoo↔KIS 50% 초과 괴리 시 universe 보존 + WATCHLIST_HOLD 마커 ───
    // 사용자 micro-correction: STRONG→BUY 강등 대신 시계열 evaluator 자동 강등으로 자연 진입 차단.
    // ADR-0263 원안 (return null) 폐기 — universe 손실 + 운영자 추적 불가 차단.
    // 본 분기는 KIS 가격 채택된 종목 (price 신뢰성 OK) → universe 통과 + 진단 마커만 부착.
    // 시계열 의존 14 evaluator 는 registry.run 에서 자동 PROVIDER_DEGRADED 강등 (score=0).
    // 후속 watchlistEntry 에 technicalProviderDegraded=true 영속 (라인 ~538 참조).
    let technicalProviderDegraded = false;
    if (quote.dataQuality === 'KIS_PRIMARY_YAHOO_STALE_DETECTED' && !quote.noProviderDegrade) {
      technicalProviderDegraded = true;
      console.warn(
        `[AutoPopulate] ${stock.code} ${stock.name} — WATCHLIST_HOLD ` +
        `(Yahoo↔KIS divergence: ${quote.yahooKisRecovery?.divergencePct.toFixed(1) ?? '?'}%, ` +
        `KIS price 채택, 시계열 evaluator PROVIDER_DEGRADED 강등). ADR-0411.`,
      );
    }

    // ─── ADR-0091 PR-Z4 — Yahoo dataQuality=STALE_BASE 시 KIS 폴백 + 종목 제외 ───
    // 사용자 진단: "Sanity 실패 후에도 Yahoo base 를 계속 신뢰하는 구조" 차단.
    // changePercent 위반 시 KIS intraday 로 재산출 시도 (KIS 는 자체 prevClose 보유).
    // KIS 폴백 실패 또는 return5d/return20d 까지 STALE 인 경우 → universe 제외.
    if (quote.dataQuality === 'STALE_BASE') {
      const issues = quote.dataQualityIssues ?? [];

      // PR-KIS-CHART-COOLDOWN — Yahoo stale + KIS 차트(FHKST03010100 D) 5xx cooldown
      // 활성 시 quoteHydrationFailed 처리. 추가 outbound 호출 0건 + 운영자 Telegram
      // 알림 0건 + providerIssue=true / marketSignal=false / executionImpact=NONE
      // literal. 전체 스캔 / Shadow learning / 보유·매도 관리는 무중단 (continue 만).
      // 같은 종목 반복 호출은 cooldown 으로 자동 차단되어 로그 폭주 영구 차단.
      if (isKisChartCooldownActive(stock.code, 'D')) {
        rejectionLog.push({
          code: stock.code,
          name: stock.name,
          reason:
            `quoteHydrationFailed (STALE_YAHOO_AND_KIS_CHART_FAILED) — `
            + `Yahoo STALE_BASE: ${issues.join(',')} + KIS chart cooldown `
            + `(symbol=${stock.code} period=D providerIssue=true marketSignal=false `
            + `executionImpact=NONE candidateAction=SKIP_THIS_SCAN)`,
        });
        continue;
      }

      const onlyChangePercent = issues.length === 1 && issues[0] === 'changePercent';
      let kisRecovered = false;
      if (onlyChangePercent) {
        const kisIntraday = await fetchKisIntraday(stock.code).catch(() => null);
        if (kisIntraday && kisIntraday.prevClose > 0) {
          const kisChangePct = ((kisIntraday.price - kisIntraday.prevClose) / kisIntraday.prevClose) * 100;
          if (Number.isFinite(kisChangePct) && Math.abs(kisChangePct) <= 30) {
            quote.changePercent = parseFloat(kisChangePct.toFixed(2));
            quote.prevClose = kisIntraday.prevClose;
            quote.dataQuality = 'OK';
            quote.dataQualityIssues = undefined;
            kisRecovered = true;
            console.log(`[AutoPopulate] ${stock.code} ${stock.name} — Yahoo STALE_BASE → KIS changePercent ${kisChangePct.toFixed(2)}% 폴백`);
          }
        }
      }
      if (!kisRecovered) {
        rejectionLog.push({
          code: stock.code,
          name: stock.name,
          reason: `Yahoo 데이터 오염 (STALE_BASE: ${issues.join(',')}) — KIS 폴백 실패 또는 다중 위반`,
        });
        continue;
      }
    }

    // ── 시간대별 프리셋 적용: MORNING/MIDDAY/CLOSE/OFFHOURS ──────────────────
    // 단일 임계값이 아닌 시간 커브를 가진 필터.
    if (quote.changePercent >= preset.changePercentMax) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: `과열 +${quote.changePercent.toFixed(1)}% (${preset.phase})` });
      continue;
    }
    if (quote.changePercent < preset.changePercentMin) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: `하락 ${quote.changePercent.toFixed(1)}% (${preset.phase})` });
      continue;
    }
    if (quote.return5d > preset.return5dMax) {
      rejectionLog.push({ code: stock.code, name: stock.name, reason: `5일급등 +${quote.return5d.toFixed(1)}% (${preset.phase})` });
      continue;
    }
    // MIDDAY/CLOSE는 거래량 배수 하한 요구 — MORNING은 누적 미비로 null (스킵)
    if (preset.minVolumeMultiplier != null && quote.avgVolume > 0) {
      const multiplier = quote.volume / quote.avgVolume;
      if (multiplier < preset.minVolumeMultiplier) {
        rejectionLog.push({ code: stock.code, name: stock.name, reason: `거래량부족 ×${multiplier.toFixed(2)} (${preset.phase} 최소 ×${preset.minVolumeMultiplier})` });
        continue;
      }
    }

    // 아이디어 9: KIS API로 월봉/주봉 MTAS 구성 요소 보강 (Yahoo 폴백)
    const enrichedQuote = await enrichQuoteWithKisMTAS(quote, stock.code);

    // 서버사이드 Gate 평가 — Track A에서는 SKIP이어도 등록 (점수만 기록)
    // 레짐을 전달해 RISK_ON_EARLY/RISK_OFF_CORRECTION에서 STRONG/NORMAL 밴드가 동적 적용되도록.
    // 프리셋 VCP/눌림목 가중은 개별 조건 weight에 승수로 덮어씌운다.
    const macroState = loadMacroState();
    const regime     = getLiveRegime(macroState);
    const baseWeights = loadConditionWeights();
    const presetWeights = {
      ...baseWeights,
      vcp:      Math.min(2.0, (baseWeights.vcp      ?? 1.0) * preset.vcpWeightMultiplier),
      pullback: Math.min(2.0, (baseWeights.pullback ?? 1.0) * preset.pullbackWeightMultiplier),
    };
    const gate = evaluateServerGate(enrichedQuote, presetWeights, macroState?.kospi20dReturn, null, null, regime);

    // 아이디어 11: Gate 조건 통과/탈락 — 메모리 캐시에만 누적 (루프 후 flushGateAudit으로 파일 저장)
    // ADR-0387/0388: outputs (status 분류 포함) 가 있으면 정밀 audit, 없으면 legacy passedKeys.
    if (gate.outputs && gate.outputs.length > 0) {
      // ADR-0418 Phase 3 (2026-05-07) — registry.run() 이 자동 생성한 context 를
      // 그대로 audit 에 전달. stockScreener 는 evaluator 별 inclusion list 를 더
      // 이상 갖지 않는다 (ADR-0416 Phase 1 임시 wiring 영구 제거).
      //
      // ServerGateResult.outputs 의 output.status 는 string (loose) 인 반면
      // recordGateAuditByStatus 는 ConditionEvalStatus union 을 기대 → 안전 cast.
      type AuditInputItem = Parameters<typeof recordGateAuditByStatus>[0][number];
      recordGateAuditByStatus(gate.outputs.map(o => ({
        key: o.key,
        output: o.output as AuditInputItem['output'],
        context: o.context
          ? {
              evaluatorKey: o.key,
              hadRequiredData: o.context.hadRequiredData,
            }
          : { evaluatorKey: o.key },
      })));
    } else {
      recordGateAudit(gate.conditionKeys);
    }

    // 섹션 분류: SKIP이 아닌 고득점 종목은 SWING 후보, 나머지는 MOMENTUM
    const section: WatchlistSection = gate.signalType !== 'SKIP' ? 'SWING' : 'MOMENTUM';
    const track: 'A' | 'B' = section === 'MOMENTUM' ? 'A' : 'B';
    // 섹션별 만료: SWING 7영업일, MOMENTUM 2영업일
    const expireDays = section === 'SWING' ? 7 : 2;

    // Patch-WATCHLIST-SATURATION-COOLDOWN-001 — MOMENTUM AUTO 편입 감속 가드.
    // SWING/CATALYST 후보는 무영향 — section==='MOMENTUM' 일 때만 적용.
    if (section === 'MOMENTUM' && momentumAutoIntakeBlocked(stock.code, stock.name)) {
      continue;
    }

    const sl = Math.round(quote.price * 0.92);
    const tp = Math.round(quote.price * 1.20);
    const addResult = addToWatchlist(watchlist, {
      code: stock.code,
      name: stock.name,
      entryPrice: quote.price,
      stopLoss: sl,
      targetPrice: tp,
      addedAt: new Date().toISOString(),
      gateScore: gate.gateScore,
      addedBy: 'AUTO',
      memo: `${gate.signalType} gate=${gate.gateScore.toFixed(1)}/10 ${gate.details.join(', ')}`,
      rrr: parseFloat(((tp - quote.price) / (quote.price - sl || 1)).toFixed(2)),
      conditionKeys: gate.conditionKeys,
      section,
      track,
      expiresAt: addBusinessDays(new Date(), expireDays).toISOString(),
      // ADR-0411 — Yahoo↔KIS 괴리 KIS recovery 종목 라벨링 (운영자 진단·텔레그램용).
      ...(technicalProviderDegraded
        ? { technicalProviderDegraded: true, technicalProviderDegradedAt: new Date().toISOString() }
        : {}),
    });
    if (!addResult.added) {
      const sectionCount = watchlist.filter(w => w.section === section).length;
      const sectionMax = section === 'SWING' ? SWING_MAX_SIZE : MOMENTUM_MAX_SIZE;
      rejectionLog.push({ code: stock.code, name: stock.name, reason: `${section} 만석(${sectionCount}/${sectionMax})` });
      continue;
    }
    existingCodes.add(stock.code);
    added++;
    if (section === 'MOMENTUM') autoMomentumAddedThisCycle++;
    console.log(
      `[AutoPopulate] Yahoo → 워치리스트 [${section}]: ${stock.name}(${stock.code}) ` +
      `@${quote.price.toLocaleString()} (+${quote.changePercent.toFixed(1)}% / ${(quote.volume / 10000).toFixed(0)}만주) ` +
      `gate=${gate.gateScore}/10 [${gate.signalType}] ${gate.details.join(', ')}`
    );

    // ADR-0128 §Wiring 1B: 등록 자체는 보존, sanity 위반 시 markDataQuarantine 으로 alert 보류.
    try {
      const _verifyYahoo = await verifyStockIncremental(stock.code, 'WATCHLIST');
      if (!_verifyYahoo.verified && _verifyYahoo.dataQuality) {
        markDataQuarantine(stock.code, _verifyYahoo.dataQuality);
      }
    } catch (err) {
      console.warn(`[autoPopulateWatchlist] verify error (skip): ${stock.code} — ${(err as Error).message}`);
    }

    // Yahoo rate limit 방지
    await new Promise(r => setTimeout(r, 300));
  }

  // 아이디어 11: Gate 감사 플러시 — 루프 종료 후 단일 파일 I/O
  flushGateAudit();

  if (momentumLimitedCount > 0) {
    console.info(
      `[MOMENTUM_AUTO_INTAKE_LIMITED_SUMMARY]\n`
      + `cycleId=${cycleId}\n`
      + `limitedCount=${momentumLimitedCount}\n`
      + `sample=[${momentumLimitedSamples.join(', ')}]\n`
      + `autoRatio=${intake.autoRatio.toFixed(2)}\n`
      + `perCycleLimit=${intake.perCycleLimit}\n`
      + `addedThisCycle=${autoMomentumAddedThisCycle}\n`
      + `executionImpact=NONE\n`
      + `marketSignal=false\n`
      + `providerIssue=false`,
    );
  }

  // 아이디어 5: 탈락 로그를 메모리 캐시에 저장 + 상세 JSON 로그 출력
  setLastRejectionLog(rejectionLog);
  if (rejectionLog.length > 0) {
    console.log(`[AutoPopulate] 탈락 ${rejectionLog.length}건 — ${JSON.stringify(rejectionLog.slice(0, 10))}`);
  }

  if (added > 0) {
    saveWatchlist(watchlist);
    const swingCnt    = watchlist.filter(w => w.section === 'SWING').length;
    const catalystCnt = watchlist.filter(w => w.section === 'CATALYST').length;
    const momentumCnt = watchlist.filter(w => w.section === 'MOMENTUM' || (!w.section && w.track === 'A')).length;
    console.log(
      `[AutoPopulate] 워치리스트 자동 추가 완료 — ${added}개 신규 (총 ${watchlist.length}개, ` +
      `SWING ${swingCnt}개 / CATALYST ${catalystCnt}개 / MOMENTUM ${momentumCnt}개)`,
    );
  } else {
    console.log('[AutoPopulate] 조건 충족 종목 없음 — 워치리스트 변동 없음');
  }

  return added;
}


// ── ADR-0029 barrel re-export ───────────────────────────────────────────────
// 외부 24 importer 가 'server/screener/stockScreener.js' 에서 직접 import 하던
// 심볼들을 분해된 6 파일에서 가져와 그대로 다시 노출한다. 신규 importer 는
// 어댑터를 직접 import 권장 (성능 동일, 의존성 명시적).
export { STOCK_UNIVERSE } from './stockUniverse.js';
export { type RejectionEntry, getLastRejectionLog, setLastRejectionLog } from './rejectionLog.js';
export { sendWatchlistRejectionReport } from './watchlistRejectionReport.js';
export { fetchYahooQuote, type YahooQuoteExtended } from './adapters/yahooQuoteAdapter.js';
export { fetchKisQuoteFallback, fetchKisIntraday, enrichQuoteWithKisMTAS } from './adapters/kisQuoteAdapter.js';
export { fetchKrxScreenerFallback } from './adapters/krxScreenerAdapter.js';
