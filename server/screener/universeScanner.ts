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

import fs from 'fs';
import { fetchYahooQuote, enrichQuoteWithKisMTAS, STOCK_UNIVERSE } from './stockScreener.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { evaluateServerGate } from '../quantFilter.js';
import { loadMacroState, type MacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist, saveWatchlist } from '../persistence/watchlistRepo.js';
import { computeFocusCodes, assignSection, tryEvictWeakest, SWING_MAX_SIZE, MOMENTUM_MAX_SIZE } from './watchlistManager.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { realDataKisGet, HAS_REAL_DATA_CLIENT, KIS_IS_REAL, fetchKisInvestorFlow, hasKisClientOverrides } from '../clients/kisClient.js';
import { getDartFinancials } from '../clients/dartFinancialClient.js';
import { recordDartAttempt } from './dataCompletenessTracker.js';
import { calcReliabilityScore, sourcesFromGateKeys, formatReliabilityBadge } from '../learning/reliabilityScorer.js';
import { runConfluenceEngine } from '../trading/confluenceEngine.js';
import { computeEtfSectorBoost } from '../alerts/globalScanAgent.js';
import { evaluateRegretAsymmetry } from '../trading/regretAsymmetryFilter.js';
import { STAGE1_CACHE_FILE, ensureDataDir } from '../persistence/paths.js';
import type { RegimeLevel } from '../../src/types/core.js';
import {
  type CandidateStock,
  STOP_RATES,
  TARGET_RATES,
  addBusinessDays,
  calcStage1Score,
  getLeadingSectors,
  runStage3Screening,
  passesStage1Filter,
} from './pipelineHelpers.js';
import { getSectorByCode } from './sectorMap.js';

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
  const BATCH_SIZE = 5;  // 병렬 배치 크기 (Yahoo rate limit 고려, 500개 확장 대비)

  // ─ KIS 실계좌 데이터: 거래량 + 상승률 순위 병렬 조회 ─
  // 실계좌 데이터 키(KIS_REAL_DATA_APP_KEY) 또는 실계좌 모드(KIS_IS_REAL)일 때 실행
  // VTS mock override가 설치된 경우에도 허용 (mock client가 ranking TR 응답을 생성)
  const hasMockOverride = hasKisClientOverrides();
  if ((HAS_REAL_DATA_CLIENT || KIS_IS_REAL || hasMockOverride) && (process.env.KIS_REAL_DATA_APP_KEY || process.env.KIS_APP_KEY || hasMockOverride)) {
    const [volResult, riseResult] = await Promise.allSettled([
      realDataKisGet('FHPST01710000', '/uapi/domestic-stock/v1/ranking/volume', {
        fid_cond_mrkt_div_code: 'J',
        fid_cond_scr_div_code:  '20171',
        fid_input_iscd:         '0000',
        fid_div_cls_code:       '0',
        fid_blng_cls_code:      '0',
        fid_trgt_cls_code:      '111111111',
        fid_trgt_exls_cls_code: '000000',
        fid_input_price_1:      '3000',
        fid_input_price_2:      '999999',
        fid_vol_cnt:            '50000',
        fid_input_date_1:       '',
      }),
      realDataKisGet('FHPST01700000', '/uapi/domestic-stock/v1/ranking/fluctuation', {
        fid_cond_mrkt_div_code: 'J',
        fid_cond_scr_div_code:  '20170',
        fid_input_iscd:         '0000',
        fid_rank_sort_cls_code: '0',
        fid_input_price_1:      '3000',
        fid_vol_cnt:            '50000',
        fid_trgt_cls_code:      '111111111',
        fid_trgt_exls_cls_code: '000000',
        fid_input_date_1:       '',
      }),
    ]);

    type KisOutput = { output?: Record<string, string>[] };
    const rawRows: Record<string, string>[] = [
      ...((volResult.status === 'fulfilled'  ? (volResult.value  as KisOutput)?.output  : null) ?? []),
      ...((riseResult.status === 'fulfilled' ? (riseResult.value as KisOutput)?.output  : null) ?? []),
    ];

    // 관리종목 · 거래정지 · 정리매매 · 투자경고/위험 사전 제외 (부실기업 필터)
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
    const kisRows = rawRows.filter(r => !isRiskyKisRow(r));
    if (rawRows.length !== kisRows.length) {
      console.log(`[Pipeline/Stage1] 관리·거래정지 등 부실기업 ${rawRows.length - kisRows.length}개 제외`);
    }

    // ─ 5개씩 병렬 배치 처리 (순차 대비 ~5× 속도 향상) ─
    const kisTop60 = kisRows.slice(0, 60);
    for (let i = 0; i < kisTop60.length; i += BATCH_SIZE) {
      const batch = kisTop60.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (row) => {
          const code = row.stck_shrn_iscd ?? '';
          const name = row.hts_kor_isnm  ?? '';
          if (!code || seenCodes.has(code)) return null;

          const quote =
            (await fetchYahooQuote(`${code}.KS`).catch(() => null)) ??
            (await fetchYahooQuote(`${code}.KQ`).catch(() => null));
          if (!quote) return null;
          if (!passesStage1Filter(quote)) return null;

          return {
            code, name,
            symbol: `${code}.KS`,
            sector: getSectorByCode(code),
            quote,
            stage1Score: calcStage1Score(quote),
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
  const { getExpandedUniverse } = await import('./dynamicUniverseExpander.js');
  const scanUniverse = getExpandedUniverse();
  for (let i = 0; i < scanUniverse.length; i += BATCH_SIZE) {
    const batch = scanUniverse.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (stock) => {
        if (seenCodes.has(stock.code)) return null;

        const quote = await fetchYahooQuote(stock.symbol).catch(() => null);
        if (!quote || quote.price <= 0) return null;
        if (!passesStage1Filter(quote)) return null;

        return {
          code:   stock.code,
          name:   stock.name,
          symbol: stock.symbol,
          sector: getSectorByCode(stock.code),
          quote,
          stage1Score: calcStage1Score(quote),
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

  const result = candidates
    .sort((a, b) => b.stage1Score - a.stage1Score)
    .slice(0, 60);

  console.log(
    `[Pipeline/Stage1] 스캔 ${candidates.length}개 → 상위 ${result.length}개 추출`,
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
  const weights  = loadConditionWeights();
  const results: CandidateStock[] = [];

  const kospi20dReturn = macroState?.kospi20dReturn;

  for (const c of candidates) {
    // 아이디어 9: KIS API 월봉/주봉 데이터로 MTAS 보강
    const enrichedQuote = await enrichQuoteWithKisMTAS(c.quote, c.code);
    const gate = evaluateServerGate(enrichedQuote, weights, kospi20dReturn, null, null, regime);

    // 아이디어 #5 rate limit 방지: 종목당 월봉+주봉 2회 호출 후 인터벌 확보
    // 내부 100ms(월봉→주봉) + 외부 60ms = 종목간 총 ~160ms → 약 6종목/초로 KIS 20건/초 한도 내 유지
    await new Promise(r => setTimeout(r, 60));

    if (gate.signalType === 'SKIP') continue;

    const sectorBonus = leadingSectors.some((s) => c.sector.includes(s)) ? 1.5 : 1.0;

    // Layer 14 ETF 선행 수급 부스트 — EWY/ITA/SOXX/XLE 5일 수익률 양수 시 gateScore에 가산
    const etfBoost = computeEtfSectorBoost(c.sector);
    const boostedGateScore = gate.gateScore + etfBoost.boost;
    const boostedDetails = etfBoost.reasons.length > 0
      ? [...gate.details, ...etfBoost.reasons]
      : gate.details;

    const stage2Score = boostedGateScore * sectorBonus + c.stage1Score * 0.3;

    results.push({
      ...c,
      quote:        enrichedQuote,  // KIS 보강된 quote 사용
      gateScore:    boostedGateScore,
      gateSignal:   gate.signalType,
      gateDetails:  boostedDetails,
      gateCondKeys: gate.conditionKeys,
      sectorBonus,
      stage2Score,
    });
  }

  const top15 = results
    .sort((a, b) => (b.stage2Score ?? 0) - (a.stage2Score ?? 0))
    .slice(0, 15);

  // ── KIS 투자자 수급 실데이터 조회 (실계좌 모드 또는 mock override, 상위 15개만) ──
  if (KIS_IS_REAL || hasKisClientOverrides()) {
    for (const c of top15) {
      const flow = await fetchKisInvestorFlow(c.code).catch(() => null);
      if (flow) {
        c.kisFlow = {
          foreignNetBuy:       flow.foreignNetBuy,
          institutionalNetBuy: flow.institutionalNetBuy,
        };
        // 외국인 순매수 보너스: stage2Score에 반영
        const flowBonus = (flow.foreignNetBuy > 0 ? 0.3 : 0) +
                          (flow.institutionalNetBuy > 0 ? 0.2 : 0);
        c.stage2Score = (c.stage2Score ?? 0) + flowBonus;
      }
      await new Promise(r => setTimeout(r, 100));
    }
    // KIS 수급 보너스 반영 후 재정렬
    top15.sort((a, b) => (b.stage2Score ?? 0) - (a.stage2Score ?? 0));
  }

  // ── Phase 2 컨플루언스 스코어링 ────────────────────────────────────────────
  // DART는 Stage 3에서 조회하므로 여기선 null 전달 (기술·수급·매크로 3축 평가)
  for (const c of top15) {
    c.confluenceResult = runConfluenceEngine({
      quote:         c.quote,
      kisFlow:       c.kisFlow ?? null,
      dartFin:       null,   // Stage 3에서 DART 조회 후 재평가
      macroState,
      regime,
      gateScore:     c.gateScore ?? 0,
      kospiDayReturn: macroState?.kospiDayReturn,
    });
  }

  // HOLD 신호 제거 (3축 미만 BULLISH) — Gemini 호출 전 사전 필터링
  const confluenceFiltered = top15.filter(c => c.confluenceResult?.signal !== 'HOLD');
  const holdCount = top15.length - confluenceFiltered.length;

  console.log(
    `[Pipeline/Stage2] Gate통과 ${results.length}개 (macroState=${macroState ? 'OK' : 'null'})` +
    ` → 상위 ${top15.length}개 (KIS수급=${KIS_IS_REAL ? '조회' : '생략'})` +
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
  await Promise.all(
    candidates.map(async (c) => {
      const fin = await getDartFinancials(c.code).catch(() => null);
      const hasData = !!(fin && fin.ocfRatio != null);
      recordDartAttempt(c.code, hasData);
      if (fin) {
        c.dartFin = {
          roe: fin.roe, opm: fin.opm,
          debtRatio: fin.debtRatio, ocfRatio: fin.ocfRatio,
        };
      }
    }),
  );

  const macroState = loadMacroState();

  // ── DART 조회 후 컨플루언스 재평가 (4축 완전체) ───────────────────────────
  for (const c of candidates) {
    c.confluenceResult = runConfluenceEngine({
      quote:          c.quote,
      kisFlow:        c.kisFlow ?? null,
      dartFin:        c.dartFin ?? null,
      macroState,
      regime,
      gateScore:      c.gateScore ?? 0,
      kospiDayReturn: macroState?.kospiDayReturn,
    });
  }
  // 결정적 평가 + Gemini는 topReasons만 자연어 생성 (Idea 5).
  // Gemini 호출 실패 시에도 결정적 결과는 유지되므로 파이프라인 안정성 향상.
  const results = (await runStage3Screening(candidates, regime, macroState)).map((r) => ({
    ...r,
    sector: getSectorByCode(r.code),  // 서버측 결정적 조회로 안전 덮어쓰기
  }));
  if (results.length === 0) {
    console.warn('[Pipeline/Stage3] 결정적 스크리닝 결과 없음 — 종료');
    return 0;
  }

  const watchlist     = loadWatchlist();
  const existingCodes = new Set(watchlist.map((w) => w.code));
  const stopMap       = STOP_RATES[regime]  ?? STOP_RATES['R4_NEUTRAL'];
  const targetMap     = TARGET_RATES[regime] ?? TARGET_RATES['R4_NEUTRAL'];
  let added = 0;

  for (const result of results) {
    if (result.signal === 'SKIP') continue;
    if (existingCodes.has(result.code)) continue;

    const candidate    = candidates.find((c) => c.code === result.code);
    const currentPrice = candidate?.quote.price ?? 0;
    if (currentPrice <= 0) continue;

    // 실계산 gate 점수로 필터 (Gemini 추정값 불사용)
    // gateScore 18 이상만 워치리스트 등록: 27조건 기준 약 67% 충족 수준으로
    // Wide Watchlist 품질을 높여 목표 전환율 12~18%를 달성하기 위한 임계값
    const realGateScore = candidate?.gateScore ?? 0;
    if (realGateScore < 18) continue;

    const profile    = (['A','B','C','D'].includes(result.profile) ? result.profile : 'B') as 'A'|'B'|'C'|'D';
    const stopRate   = stopMap[profile]   ?? -0.10;
    const targetRate = targetMap[profile] ?? 0.15;

    const sl  = Math.round(currentPrice * (1 + stopRate));
    const tp  = Math.round(currentPrice * (1 + targetRate));
    const rrr = (tp - currentPrice) / Math.max(currentPrice - sl, 1);
    if (rrr < 2.0) continue;

    // 실계산 conditionKeys + Gemini 질적 조건 키 병합
    const realKeys = candidate?.gateCondKeys ?? [];
    const qualKeys = (result.passedConditionKeys ?? []).filter(k => !realKeys.includes(k));

    // DART OPM 음수 → 적자기업 경고 (SKIP하지는 않지만 profile 강제 강등)
    const dartOPMNeg = candidate?.dartFin?.opm != null &&
                       candidate.dartFin.opm < 0;
    const finalProfile = dartOPMNeg && profile === 'A' ? 'B' : profile;

    // 신뢰도 스코어 계산
    const reliability = calcReliabilityScore(
      sourcesFromGateKeys(realKeys, {
        hasForeignNetBuy:      (candidate?.kisFlow?.foreignNetBuy ?? 0) !== 0,
        hasInstitutionalNetBuy: (candidate?.kisFlow?.institutionalNetBuy ?? 0) !== 0,
        hasDartROE:       candidate?.dartFin?.roe   != null,
        hasDartOPM:       candidate?.dartFin?.opm   != null,
        hasDartDebtRatio: candidate?.dartFin?.debtRatio != null,
        hasDartOCFRatio:  candidate?.dartFin?.ocfRatio  != null,
        hasGeminiProfile: true,
        hasGeminiQual:    true,
      }),
    );

    // 컨플루언스 신호 레이블
    const cf          = candidate?.confluenceResult;
    const cfSignal    = cf ? `${cf.signal} ${cf.bullishAxes}/4축` : '';
    const cycleEmoji  = cf?.cyclePosition === 'EARLY' ? '🌱' : cf?.cyclePosition === 'LATE' ? '⚠️' : '📈';
    const catalystTag = cf ? `촉매${cf.catalystGrade}` : '';
    const confPart    = cf ? `${cfSignal} ${cycleEmoji}${cf.cyclePosition} ${catalystTag}` : '';

    // ── Regret Asymmetry Filter — 직전 5거래일 급등 시 쿨다운 설정 ────────────
    const return5d = candidate?.quote.return5d ?? 0;
    const regretFilter = evaluateRegretAsymmetry(return5d, currentPrice);

    // Discovery Pipeline 종목: STRONG_BUY → SWING(즉시 매수대상), BUY → MOMENTUM(관찰 후 승격 대기)
    const section = result.signal === 'STRONG_BUY' ? 'SWING' as const : 'MOMENTUM' as const;

    // ── 섹션 만석 시 품질 경쟁: 기존 최저 gateScore 종목을 밀어냄 ──────────────
    const sectionMax = section === 'SWING' ? SWING_MAX_SIZE : MOMENTUM_MAX_SIZE;
    const sectionCount = watchlist.filter(w => w.section === section).length;
    if (sectionCount >= sectionMax) {
      const evicted = tryEvictWeakest(watchlist, result.totalGateScore, section);
      if (!evicted) {
        // 신규 종목이 기존 최저보다 약함 → 진입 불가
        continue;
      }
    }

    watchlist.push({
      code:          result.code,
      name:          result.name,
      entryPrice:    currentPrice,
      stopLoss:      sl,
      targetPrice:   tp,
      rrr:           parseFloat(rrr.toFixed(2)),
      addedAt:       new Date().toISOString(),
      addedBy:       'AUTO',
      entryRegime:   regime,
      profileType:   finalProfile,
      gateScore:     result.totalGateScore,
      sector:        result.sector,  // runStage3Screening 후처리 단계에서 getSectorByCode로 확정됨
      memo:          `${formatReliabilityBadge(reliability)} | ${confPart} | ${result.topReasons.slice(0, 2).join(', ')}`,
      expiresAt:     addBusinessDays(new Date(), section === 'SWING' ? 7 : 2).toISOString(),
      conditionKeys: [...realKeys, ...qualKeys],
      section,
      track:         section === 'MOMENTUM' ? 'A' : 'B',
      ...(regretFilter.isCooldown && {
        cooldownUntil: regretFilter.cooldownUntil,
        recentHigh:    regretFilter.recentHigh,
      }),
    });
    existingCodes.add(result.code);
    added++;

    if (regretFilter.isCooldown) {
      console.log(`[Regret Asymmetry] ${result.name}(${result.code}) ${regretFilter.reason}`);
    }
  }

  if (added > 0) {
    // section + isFocus 즉시 갱신 — cleanupWatchlist(16:00)까지 기다리지 않고 등록 직후 반영
    const focusCodes = computeFocusCodes(watchlist);
    const withSection = watchlist.map(w => {
      const sec = assignSection(w, focusCodes);
      return {
        ...w,
        section: sec,
        isFocus: sec === 'SWING',
        track: (sec === 'MOMENTUM' ? 'A' : 'B') as 'A' | 'B',
      };
    });
    saveWatchlist(withSection);
    // Telegram 알림 — 신뢰도 배지 포함
    const registered = watchlist.filter(w =>
      results.some(r => r.code === w.code) && !existingCodes.has(w.code)
    ).slice(0, 8);
    const summary = registered
      .map(w => `  • ${w.name}(${w.code}) Gate ${w.gateScore}/27 | ${w.memo ?? ''}`)
      .join('\n');

    // 같은 날 파이프라인이 재시도되거나 Stage1/Stage2/Stage3가 중복 호출돼도
    // Telegram "신규 워치리스트 N개 등록" 메시지는 하루 1회만 발송한다.
    const todayKey = new Date().toISOString().slice(0, 10);
    await sendTelegramAlert(
      `🔍 <b>[AI 파이프라인] 신규 워치리스트 ${added}개 등록</b>\n` +
      `레짐: ${regime} | 후보 ${candidates.length}개 → 등록 ${added}개\n` +
      `데이터: Yahoo OHLCV✅ DART재무${candidates.some(c => c.dartFin) ? '✅' : '⚠️'} KIS수급${candidates.some(c => c.kisFlow) ? '✅' : '⚠️'}\n` +
      summary,
      { dedupeKey: `pipeline_watchlist:${todayKey}`, cooldownMs: 12 * 60 * 60 * 1000 },
    ).catch(console.error);
  }

  console.log(`[Pipeline/Stage3] Gemini ${results.length}개 평가 → ${added}개 등록`);
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

  try {
    // Stage 1 — 양적 1차 필터
    const stage1 = await stage1QuantFilter();
    if (stage1.length === 0) {
      console.log('[Pipeline] Stage1 결과 없음 — 종료');
      return;
    }

    // Stage 2 — 섹터 + Gate 필터
    const stage2 = await stage2SectorGateFilter(stage1, regime, macroState);
    if (stage2.length === 0) {
      console.log('[Pipeline] Stage2 통과 종목 없음 — 종료');
      return;
    }

    // Stage 3 — Gemini 배치 + 워치리스트 등록
    const added   = await stage3AIScreenAndRegister(stage2, regime);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Pipeline] 완료 — ${added}개 등록, ${elapsed}초 소요`);
  } catch (e) {
    console.error('[Pipeline] 파이프라인 오류:', e instanceof Error ? e.message : e);
    await sendTelegramAlert(
      `⚠️ <b>[AI 파이프라인] 오류 발생</b>\n${e instanceof Error ? e.message : '알 수 없는 오류'}`,
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
  cachedAt: string;        // ISO — Stage1 실행 시각
  candidates: CandidateStock[];
}

function loadStage1Cache(): Stage1CacheData | null {
  ensureDataDir();
  if (!fs.existsSync(STAGE1_CACHE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STAGE1_CACHE_FILE, 'utf-8'));
  } catch { return null; }
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
  console.log('[Pipeline/PreScreen] 1차 Pre-screening 시작 (Stage1 only)');

  try {
    const stage1 = await stage1QuantFilter();
    if (stage1.length === 0) {
      console.log('[Pipeline/PreScreen] Stage1 결과 없음');
      return;
    }

    saveStage1Cache({
      cachedAt: new Date().toISOString(),
      candidates: stage1,
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Pipeline/PreScreen] 완료 — ${stage1.length}개 후보 캐시 저장, ${elapsed}초 소요`);

    await sendTelegramAlert(
      `🔍 <b>[Pre-screening 완료] 16:30</b>\n` +
      `Stage1: ${stage1.length}개 후보 확정 → 캐시 저장\n` +
      `소요: ${elapsed}초 | 내일 08:35 Stage2+3 실행 예정`,
    ).catch(console.error);
  } catch (e) {
    console.error('[Pipeline/PreScreen] 오류:', e instanceof Error ? e.message : e);
    await sendTelegramAlert(
      `⚠️ <b>[Pre-screening 오류]</b>\n${e instanceof Error ? e.message : '알 수 없는 오류'}\n` +
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
  const cache = loadStage1Cache();

  // 캐시 유효성 검증: 존재 + 24시간 이내
  const cacheMaxAgeMs = 24 * 60 * 60 * 1000;
  const cacheValid = cache &&
    cache.candidates.length > 0 &&
    (Date.now() - new Date(cache.cachedAt).getTime()) < cacheMaxAgeMs;

  if (!cacheValid) {
    console.log('[Pipeline/FinalScreen] Stage1 캐시 없음 또는 만료 — 전체 파이프라인 fallback');
    await runFullDiscoveryPipeline(regime, macroState);
    return;
  }

  console.log(
    `[Pipeline/FinalScreen] 2차 Final-screening 시작 — ` +
    `Stage1 캐시 ${cache.candidates.length}개 (${cache.cachedAt})`,
  );

  try {
    // Stage 2 — 섹터 + Gate 필터 (간밤 글로벌 신호 반영)
    const stage2 = await stage2SectorGateFilter(cache.candidates, regime, macroState);
    if (stage2.length === 0) {
      console.log('[Pipeline/FinalScreen] Stage2 통과 종목 없음 — 종료');
      return;
    }

    // Stage 3 — Gemini 배치 + 워치리스트 등록
    const added = await stage3AIScreenAndRegister(stage2, regime);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Pipeline/FinalScreen] 완료 — ${added}개 등록, ${elapsed}초 소요`);

    await sendTelegramAlert(
      `🔍 <b>[Final-screening 완료] 08:35</b>\n` +
      `Stage1 캐시: ${cache.candidates.length}개 → Stage2: ${stage2.length}개 → 등록: ${added}개\n` +
      `소요: ${elapsed}초 (전체 파이프라인 대비 ~80% 단축)`,
    ).catch(console.error);
  } catch (e) {
    console.error('[Pipeline/FinalScreen] 오류:', e instanceof Error ? e.message : e);
    await sendTelegramAlert(
      `⚠️ <b>[Final-screening 오류]</b>\n${e instanceof Error ? e.message : '알 수 없는 오류'}`,
    ).catch(console.error);
  }
}
