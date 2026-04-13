/**
 * universeScanner.ts — 자동 발굴 3단계 파이프라인
 *
 * Stage 1: 전체 종목 풀 양적 1차 필터 → 상위 60개
 *   - KIS 실계좌: 거래량 상위 + 상승률 상위 병렬 조회
 *   - VTS/공통:  STOCK_UNIVERSE 115개 Yahoo 스캔
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

import { fetchYahooQuote, STOCK_UNIVERSE } from './stockScreener.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { evaluateServerGate } from '../quantFilter.js';
import { loadMacroState, type MacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist, saveWatchlist } from '../persistence/watchlistRepo.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { kisGet, KIS_IS_REAL, fetchKisInvestorFlow } from '../clients/kisClient.js';
import { getDartFinancials } from '../clients/dartFinancialClient.js';
import { calcReliabilityScore, sourcesFromGateKeys, formatReliabilityBadge } from '../learning/reliabilityScorer.js';
import { runConfluenceEngine } from '../trading/confluenceEngine.js';
import { evaluateRegretAsymmetry } from '../trading/regretAsymmetryFilter.js';
import type { RegimeLevel } from '../../src/types/core.js';
import {
  type CandidateStock,
  type GeminiScreenResult,
  SECTOR_MAP,
  STOP_RATES,
  TARGET_RATES,
  addBusinessDays,
  calcStage1Score,
  isPullbackSetup,
  getLeadingSectors,
  callGeminiForScreening,
  buildScreeningPrompt,
  parseScreeningResponse,
} from './pipelineHelpers.js';

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

  // ─ KIS 실계좌: 거래량 + 상승률 순위 병렬 조회 ─
  if (KIS_IS_REAL && process.env.KIS_APP_KEY) {
    const [volResult, riseResult] = await Promise.allSettled([
      kisGet('FHPST01710000', '/uapi/domestic-stock/v1/ranking/volume', {
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
      kisGet('FHPST01700000', '/uapi/domestic-stock/v1/ranking/fluctuation', {
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
    const kisRows: Record<string, string>[] = [
      ...((volResult.status === 'fulfilled'  ? (volResult.value  as KisOutput)?.output  : null) ?? []),
      ...((riseResult.status === 'fulfilled' ? (riseResult.value as KisOutput)?.output  : null) ?? []),
    ];

    for (const row of kisRows.slice(0, 60)) {
      const code = row.stck_shrn_iscd ?? '';
      const name = row.hts_kor_isnm  ?? '';
      if (!code || seenCodes.has(code)) continue;

      const quote =
        (await fetchYahooQuote(`${code}.KS`).catch(() => null)) ??
        (await fetchYahooQuote(`${code}.KQ`).catch(() => null));
      if (!quote || quote.price < 3000) continue;
      if (quote.changePercent >= 8)                    continue; // 당일 +8% 이상 과열 제외
      const kisPullback = isPullbackSetup(quote);
      // 눌림목: changePercent -2%까지 허용, 일반: 0% 이상만
      if (quote.changePercent < 0 && !kisPullback)     continue; // 음봉 제외 (눌림목은 통과)
      if (quote.changePercent < -2)                    continue; // 눌림목이라도 -2% 이상 하락은 제외
      const kisVCP = quote.atr > 0 && quote.atr20avg > 0 && quote.atr < quote.atr20avg * 0.75;
      if (quote.volume < quote.avgVolume * 1.2 && !kisVCP && !kisPullback) continue; // 눌림목/VCP면 거래량 마름 허용
      if (quote.per > 0 && quote.per > 60)             continue;
      if (quote.ma20 > 0 && quote.price < quote.ma20 && !kisPullback) continue; // 눌림목: MA20 아래 허용 (MA60 위는 isPullbackSetup에서 검증)
      if (quote.return5d > 15)                         continue; // 5일 +15% 초과 → 이미 급등

      seenCodes.add(code);
      candidates.push({
        code, name,
        symbol: `${code}.KS`,
        sector: SECTOR_MAP[code] ?? '미분류',
        quote,
        stage1Score: calcStage1Score(quote),
      });
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // ─ Yahoo 유니버스 스캔 (VTS 보완 + KIS 미제공 종목) ─
  for (const stock of STOCK_UNIVERSE) {
    if (seenCodes.has(stock.code)) continue;

    const quote = await fetchYahooQuote(stock.symbol).catch(() => null);
    if (!quote || quote.price <= 0) continue;

    if (quote.changePercent >= 8)                    continue; // 당일 +8% 이상 과열 제외
    const yahooPullback = isPullbackSetup(quote);
    // 눌림목: changePercent -2%까지 허용, 일반: 0% 이상만
    if (quote.changePercent < 0 && !yahooPullback)   continue; // 음봉 제외 (눌림목은 통과)
    if (quote.changePercent < -2)                    continue; // 눌림목이라도 -2% 이상 하락은 제외
    const yahooVCP = quote.atr > 0 && quote.atr20avg > 0 && quote.atr < quote.atr20avg * 0.75;
    if (quote.volume < quote.avgVolume * 1.2 && !yahooVCP && !yahooPullback) continue; // 눌림목/VCP면 거래량 마름 허용
    if (quote.price < 3000)                          continue;
    if (quote.per > 0 && quote.per > 60)             continue;
    if (quote.ma20 > 0 && quote.price < quote.ma20 && !yahooPullback) continue; // 눌림목: MA20 아래 허용
    if (quote.return5d > 15)                         continue; // 5일 +15% 초과 → 이미 급등

    seenCodes.add(stock.code);
    candidates.push({
      code:   stock.code,
      name:   stock.name,
      symbol: stock.symbol,
      sector: SECTOR_MAP[stock.code] ?? '미분류',
      quote,
      stage1Score: calcStage1Score(quote),
    });
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

  const kospiDayReturn = macroState?.kospiDayReturn;

  for (const c of candidates) {
    const gate = evaluateServerGate(c.quote, weights, kospiDayReturn);
    if (gate.signalType === 'SKIP') continue;

    const sectorBonus = leadingSectors.some((s) => c.sector.includes(s)) ? 1.5 : 1.0;
    const stage2Score = gate.gateScore * sectorBonus + c.stage1Score * 0.3;

    results.push({
      ...c,
      gateScore:    gate.gateScore,
      gateSignal:   gate.signalType,
      gateDetails:  gate.details,
      gateCondKeys: gate.conditionKeys,
      sectorBonus,
      stage2Score,
    });
  }

  const top15 = results
    .sort((a, b) => (b.stage2Score ?? 0) - (a.stage2Score ?? 0))
    .slice(0, 15);

  // ── KIS 투자자 수급 실데이터 조회 (실계좌 모드, 상위 15개만) ─────────────────
  if (KIS_IS_REAL) {
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
  const prompt     = buildScreeningPrompt(candidates, regime, macroState);
  const response   = await callGeminiForScreening(prompt);

  if (!response) {
    console.warn('[Pipeline/Stage3] Gemini 응답 없음 — Stage3 건너뜀');
    return 0;
  }

  const results = parseScreeningResponse(response);
  if (results.length === 0) {
    console.warn('[Pipeline/Stage3] JSON 파싱 실패 — 원문:', response.slice(0, 300));
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
    const dartOPMNeg = candidate?.dartFin?.opm !== undefined &&
                       candidate.dartFin.opm !== null &&
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
      sector:        result.sector || candidate?.sector,
      memo:          `${formatReliabilityBadge(reliability)} | ${confPart} | ${result.topReasons.slice(0, 2).join(', ')}`,
      expiresAt:     addBusinessDays(new Date(), 5).toISOString(),
      conditionKeys: [...realKeys, ...qualKeys],
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
    saveWatchlist(watchlist);
    // Telegram 알림 — 신뢰도 배지 포함
    const registered = watchlist.filter(w =>
      results.some(r => r.code === w.code) && !existingCodes.has(w.code)
    ).slice(0, 8);
    const summary = registered
      .map(w => `  • ${w.name}(${w.code}) Gate ${w.gateScore}/27 | ${w.memo ?? ''}`)
      .join('\n');

    await sendTelegramAlert(
      `🔍 <b>[AI 파이프라인] 신규 워치리스트 ${added}개 등록</b>\n` +
      `레짐: ${regime} | 후보 ${candidates.length}개 → 등록 ${added}개\n` +
      `데이터: Yahoo OHLCV✅ DART재무${candidates.some(c => c.dartFin) ? '✅' : '⚠️'} KIS수급${candidates.some(c => c.kisFlow) ? '✅' : '⚠️'}\n` +
      summary,
    ).catch(console.error);
  }

  console.log(`[Pipeline/Stage3] Gemini ${results.length}개 평가 → ${added}개 등록`);
  return added;
}

// ── 전체 파이프라인 오케스트레이터 ────────────────────────────────────────────

/**
 * 3단계 자동 발굴 파이프라인 전체 실행.
 * scheduler.ts 에서 매일 08:35 KST (UTC 23:35 일~목) 호출.
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
