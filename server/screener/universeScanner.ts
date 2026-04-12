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
 */

import { fetchYahooQuote, STOCK_UNIVERSE, type YahooQuoteExtended } from './stockScreener.js';
import { loadConditionWeights } from '../persistence/conditionWeightsRepo.js';
import { evaluateServerGate } from '../quantFilter.js';
import { loadMacroState, type MacroState } from '../persistence/macroStateRepo.js';
import { loadWatchlist, saveWatchlist } from '../persistence/watchlistRepo.js';
import { getGeminiClient } from '../clients/geminiClient.js';
import { AI_MODELS } from '../constants.js';
import { sendTelegramAlert } from '../alerts/telegramClient.js';
import { kisGet, KIS_IS_REAL, fetchKisInvestorFlow } from '../clients/kisClient.js';
import { getDartFinancials } from '../clients/dartFinancialClient.js';
import { calcReliabilityScore, sourcesFromGateKeys, formatReliabilityBadge } from '../learning/reliabilityScorer.js';
import type { RegimeLevel } from '../../src/types/core.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface CandidateStock {
  code:        string;
  name:        string;
  symbol:      string;
  sector:      string;
  quote:       YahooQuoteExtended;
  stage1Score: number;
  // Stage 2 이후 추가
  gateScore?:       number;
  gateSignal?:      string;
  gateDetails?:     string[];   // 실계산 통과 조건 레이블 (Gemini에 전달)
  gateCondKeys?:    string[];   // 실계산 통과 조건 키
  sectorBonus?:     number;
  stage2Score?:     number;
  // 실데이터 수급 (KIS API — Stage 2)
  kisFlow?: {
    foreignNetBuy:      number;  // 외국인 당일 순매수량
    institutionalNetBuy: number; // 기관 당일 순매수량
  };
  // 실데이터 펀더멘털 (DART API — Stage 3)
  dartFin?: {
    roe:       number | null;
    opm:       number | null;
    debtRatio: number | null;
    ocfRatio:  number | null;
  };
}

interface GeminiScreenResult {
  code:               string;
  name:               string;
  signal:             'STRONG_BUY' | 'BUY' | 'SKIP';
  qualScore:          number;   // 0~17 (Gemini가 평가한 질적 조건 점수)
  totalGateScore:     number;   // 0~27 (실계산 gate + qualScore 합산)
  profile:            'A' | 'B' | 'C' | 'D';
  sector:             string;
  topReasons:         string[];
  passedConditionKeys: string[];
}

// ── 상수 ──────────────────────────────────────────────────────────────────────

/** 주요 종목 코드 → 섹터 매핑 (나머지는 Gemini 판단) */
const SECTOR_MAP: Record<string, string> = {
  // 반도체
  '005930': '반도체', '000660': '반도체', '042700': '반도체',
  '357780': '반도체소재', '095340': '반도체소재', '058470': '반도체부품',
  '403870': '반도체장비', '039030': '반도체장비', '240810': '반도체장비', '336260': '반도체장비',
  // 2차전지
  '373220': '2차전지', '006400': '2차전지', '247540': '2차전지소재',
  '086520': '2차전지소재', '383310': '2차전지소재', '003670': '2차전지소재',
  // 조선·방산
  '009540': '조선', '010620': '조선', '042660': '조선',
  // 에너지·원자력
  '034020': '원자력', '015760': '에너지', '009830': '신재생에너지',
  // 바이오·제약
  '207940': '바이오', '068270': '바이오', '196170': '바이오',
  '141080': '바이오', '298380': '바이오', '000100': '제약',
  // IT·플랫폼
  '035420': 'IT서비스', '035720': 'IT서비스', '259960': 'IT서비스',
  '323410': '핀테크', '377300': '핀테크',
  // 자동차
  '005380': '자동차', '000270': '자동차', '012330': '자동차부품',
  // 금융
  '105560': '금융', '055550': '금융', '086790': '금융', '316140': '금융',
  '024110': '금융', '006800': '금융', '138930': '금융',
  // 소재·철강
  '051910': '화학', '011170': '화학', '005490': '철강',
  '004020': '철강', '010130': '금속', '006260': '소재',
  // 전기·통신
  '066570': '가전', '011070': '전자부품', '009150': '전자부품',
  '267260': '전기기기', '017670': '통신', '030200': '통신',
  // 해운·물류
  '011200': '해운', '003490': '항공', '180640': '항공',
  // 엔터·소비
  '035900': '엔터테인먼트', '041510': '엔터테인먼트', '122870': '엔터테인먼트',
  '002790': '화장품', '090430': '화장품', '021240': '생활용품',
};

/** 레짐별 주도 섹터 */
const LEADING_SECTORS: Record<string, string[]> = {
  R1_TURBO:   ['반도체', '방산', '조선', '원자력', '2차전지'],
  R2_BULL:    ['반도체', '2차전지', 'IT서비스', '바이오'],
  R3_EARLY:   ['금융', '조선', '소재', '원자력'],
  R4_NEUTRAL: ['화장품', '헬스케어', 'IT서비스', '바이오'],
  R5_CAUTION: ['통신', '에너지', '금융', '제약'],
  R6_DEFENSE: ['통신', '유틸리티', '제약', '금융'],
};

/** 레짐 × 프로파일별 손절 비율 */
const STOP_RATES: Record<string, Record<string, number>> = {
  R1_TURBO:   { A: -0.08, B: -0.10, C: -0.12, D: -0.15 },
  R2_BULL:    { A: -0.08, B: -0.10, C: -0.12, D: -0.15 },
  R3_EARLY:   { A: -0.09, B: -0.11, C: -0.13, D: -0.16 },
  R4_NEUTRAL: { A: -0.10, B: -0.12, C: -0.15, D: -0.18 },
  R5_CAUTION: { A: -0.07, B: -0.09, C: -0.11, D: -0.13 },
  R6_DEFENSE: { A: -0.06, B: -0.08, C: -0.10, D: -0.12 },
};

/** 레짐 × 프로파일별 목표가 비율 */
const TARGET_RATES: Record<string, Record<string, number>> = {
  R1_TURBO:   { A: 0.15, B: 0.20, C: 0.25, D: 0.30 },
  R2_BULL:    { A: 0.12, B: 0.15, C: 0.20, D: 0.25 },
  R3_EARLY:   { A: 0.10, B: 0.13, C: 0.17, D: 0.22 },
  R4_NEUTRAL: { A: 0.10, B: 0.12, C: 0.15, D: 0.20 },
  R5_CAUTION: { A: 0.08, B: 0.10, C: 0.12, D: 0.15 },
  R6_DEFENSE: { A: 0.07, B: 0.08, C: 0.10, D: 0.12 },
};

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

function calcStage1Score(q: YahooQuoteExtended): number {
  let score = 0;
  score += Math.min(q.changePercent / 5, 2);                             // 상승률 (최대 2점)
  score += Math.min(q.volume / Math.max(q.avgVolume, 1) - 1, 2);        // 거래량 배수 (최대 2점)
  score += q.price >= q.ma5 ? 0.5 : 0;                                  // 5일선 위
  score += q.price >= q.high20d * 0.98 ? 1 : 0;                         // 20일 신고가 근접
  score += q.atr > 0 && q.atr20avg > 0 && q.atr < q.atr20avg * 0.7 ? 1 : 0; // VCP
  return score;
}

function getLeadingSectors(regime: RegimeLevel): string[] {
  return LEADING_SECTORS[regime] ?? LEADING_SECTORS['R4_NEUTRAL'];
}

/** Gemini 스크리닝용 — maxOutputTokens 4096으로 배치 분석 */
async function callGeminiForScreening(prompt: string): Promise<string | null> {
  const ai = getGeminiClient();
  if (!ai) {
    console.warn('[Pipeline/Gemini] API 키 미설정 — Stage3 건너뜀');
    return null;
  }
  try {
    const res = await ai.models.generateContent({
      model:    AI_MODELS.SERVER_SIDE,
      contents: prompt,
      config:   { temperature: 0.3, maxOutputTokens: 4096 },
    });
    return res.text ?? null;
  } catch (e) {
    console.error('[Pipeline/Gemini] 호출 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

function buildScreeningPrompt(
  candidates: CandidateStock[],
  regime: RegimeLevel,
  macroState: MacroState | null,
): string {
  const stockLines = candidates.map((c) => {
    const q          = c.quote;
    const techPassed = c.gateDetails?.join('|') ?? '';

    // DART 실데이터 포함 (있을 경우)
    const dartStr = c.dartFin
      ? `ROE:${c.dartFin.roe?.toFixed(1) ?? 'N/A'}% OPM:${c.dartFin.opm?.toFixed(1) ?? 'N/A'}% DR:${c.dartFin.debtRatio?.toFixed(0) ?? 'N/A'}%`
      : 'DART:미수집';

    // KIS 수급 실데이터 (있을 경우)
    const kisStr = c.kisFlow
      ? `외인${c.kisFlow.foreignNetBuy >= 0 ? '+' : ''}${(c.kisFlow.foreignNetBuy / 1000).toFixed(0)}천주 기관${c.kisFlow.institutionalNetBuy >= 0 ? '+' : ''}${(c.kisFlow.institutionalNetBuy / 1000).toFixed(0)}천주`
      : 'KIS:미수집';

    return (
      `${c.name}(${c.code}): ${q.price.toLocaleString()}원 ` +
      `등락${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(1)}% ` +
      `RSI${q.rsi14.toFixed(0)} MACD${q.macdHistogram >= 0 ? '↑' : '↓'} ` +
      `정배열:${q.price > q.ma5 && q.ma5 > q.ma20 ? 'Y' : 'N'} ` +
      `VCP:${q.atr > 0 && q.atr < q.atr20avg * 0.7 ? 'Y' : 'N'} ` +
      `섹터:${c.sector} ` +
      `[서버Gate ${c.gateScore?.toFixed(1) ?? '?'}/10: ${techPassed}] ` +
      `[${dartStr}] [${kisStr}]`
    );
  }).join('\n');

  return (
    `당신은 한국 주식 퀀트 시스템의 종목 선별 AI입니다.\n` +
    `현재 레짐: ${regime} | MHS: ${macroState?.mhs ?? 'N/A'} | VKOSPI: ${macroState?.vkospi ?? 'N/A'}\n\n` +
    `[서버 실계산 완료 — 재평가 금지]\n` +
    `RSI(14)/MACD/정배열/거래량/VCP/터틀/상대강도/PER → 서버Gate(0~10)에 반영 완료.\n` +
    `ROE/OPM/부채비율 → DART API 실데이터. 수급 → KIS API 실데이터.\n` +
    `위 데이터들은 사실 그대로 해석만 하세요 (재추정 금지).\n\n` +
    `[당신이 평가할 순수 질적 조건]\n` +
    `1.주도주사이클적합성 2.시장환경부합(레짐) 3.신규주도주여부\n` +
    `4.경제적해자(Moat) 5.목표가여력(애널리스트) 6.실적서프라이즈가능성\n` +
    `7.정책/매크로부합 8.심리적객관성 9.피보나치/엘리엇위치\n` +
    `10.촉매제유무 11.이익모멘텀가속도 12.기타구조적강점\n\n` +
    `[종목 데이터 (실계산 포함)]\n${stockLines}\n\n` +
    `JSON 배열로만 응답 (추가 텍스트 금지):\n` +
    `[{"code":"","name":"","signal":"STRONG_BUY|BUY|SKIP",` +
    `"qualScore":0,"totalGateScore":0,` +
    `"profile":"A|B|C|D","sector":"","topReasons":[""],"passedConditionKeys":[""]}]\n` +
    `qualScore: 질적 조건 12개 중 통과 추정 수 (0~12)\n` +
    `totalGateScore: 서버Gate점수×1.5+qualScore (0~27 범위 클램프)`
  );
}

function parseScreeningResponse(text: string): GeminiScreenResult[] {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as unknown[];
    return parsed.filter(
      (item): item is GeminiScreenResult =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as GeminiScreenResult).code === 'string' &&
        typeof (item as GeminiScreenResult).signal === 'string',
    );
  } catch {
    return [];
  }
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
      if (quote.changePercent < 1.0)                   continue;
      if (quote.volume < quote.avgVolume * 1.2)        continue;
      if (quote.per > 0 && quote.per > 60)             continue;
      if (quote.ma20 > 0 && quote.price < quote.ma20)  continue;

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

    if (quote.changePercent < 1.0)                   continue;
    if (quote.volume < quote.avgVolume * 1.2)        continue;
    if (quote.price < 3000)                          continue;
    if (quote.per > 0 && quote.per > 60)             continue;
    if (quote.ma20 > 0 && quote.price < quote.ma20)  continue;

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

  console.log(
    `[Pipeline/Stage2] Gate통과 ${results.length}개 (macroState=${macroState ? 'OK' : 'null'})` +
    ` → 상위 ${top15.length}개 (KIS수급=${KIS_IS_REAL ? '조회' : '생략'})`,
  );
  return top15;
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
    const realGateScore = candidate?.gateScore ?? 0;
    if (realGateScore < 5) continue; // 10조건 기준 NORMAL 이상

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
      memo:          `${formatReliabilityBadge(reliability)} | ${result.topReasons.slice(0, 2).join(', ')}`,
      expiresAt:     addBusinessDays(new Date(), 5).toISOString(),
      conditionKeys: [...realKeys, ...qualKeys],
    });
    existingCodes.add(result.code);
    added++;
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
