// @responsibility prefetchedContext AI provider 모듈
/**
 * prefetchedContext.ts — 아이디어 3: 정량 데이터 우선 수집 → Gemini 주입 블록 빌더
 *
 * Gemini가 네이버/구글 검색으로 현재가·재무·기술지표를 찾게 하지 않고,
 * KIS(현재가·수급) · Yahoo(기술지표) · DART(재무) 에서 미리 실계산한 값을
 * 한 블록으로 조립해 프롬프트 상단에 주입한다.
 *
 * 사용 예:
 *   const ctx = await buildStockInterpretContext({ code, symbol, name });
 *   await callGeminiInterpret(ctx, '이 종목의 매수·보류·회피 판단을 서술하라.');
 *
 * 목표:
 *   - googleSearch 제거 → 호출당 토큰 ~70% 절감, 응답 3~5배 가속
 *   - 장애 내성: 각 소스 실패는 "데이터 없음" 문자열로 표기, 절대 throw 하지 않음
 */

import { fetchCurrentPrice, fetchKisInvestorFlow } from '../clients/kisClient.js';
import { fetchYahooQuote, type YahooQuoteExtended } from '../screener/stockScreener.js';
import { getDartFinancials, type DartFinancials } from '../clients/dartFinancialClient.js';
import { fetchPerPbr as krxFetchPerPbr } from '../clients/krxClient.js';

// ── 타입 ─────────────────────────────────────────────────────────────────────

export interface StockRef {
  code:   string;   // 6자리 종목코드
  symbol?: string;  // Yahoo 심볼 (005930.KS). 없으면 코스피 가정.
  name:   string;
}

interface CollectedData {
  kis: {
    currentPrice: number | null;
    foreignNetBuy: number | null;
    institutionalNetBuy: number | null;
    individualNetBuy: number | null;
  };
  yahoo: YahooQuoteExtended | null;
  dart: DartFinancials | null;
  krxPer: number | null;
  krxPbr: number | null;
  errors: string[];
}

// ── 수집 ─────────────────────────────────────────────────────────────────────

/** 각 소스를 병렬 수집. 개별 실패는 errors 배열에 축적되고 undefined 로 표기. */
async function collectAll(ref: StockRef): Promise<CollectedData> {
  const errors: string[] = [];
  const symbol = ref.symbol ?? `${ref.code}.KS`;

  const [priceRes, flowRes, yahooRes, dartRes, perPbrRes] = await Promise.allSettled([
    fetchCurrentPrice(ref.code),
    fetchKisInvestorFlow(ref.code),
    fetchYahooQuote(symbol),
    getDartFinancials(ref.code),
    krxFetchPerPbr(),
  ]);

  const kisPrice = priceRes.status === 'fulfilled' ? priceRes.value : null;
  if (priceRes.status === 'rejected') errors.push(`kis.price: ${safeErr(priceRes.reason)}`);

  const kisFlow = flowRes.status === 'fulfilled' ? flowRes.value : null;
  if (flowRes.status === 'rejected') errors.push(`kis.flow: ${safeErr(flowRes.reason)}`);

  const yahoo = yahooRes.status === 'fulfilled' ? yahooRes.value : null;
  if (yahooRes.status === 'rejected') errors.push(`yahoo: ${safeErr(yahooRes.reason)}`);

  const dart = dartRes.status === 'fulfilled' ? dartRes.value : null;
  if (dartRes.status === 'rejected') errors.push(`dart: ${safeErr(dartRes.reason)}`);

  let krxPer: number | null = null;
  let krxPbr: number | null = null;
  if (perPbrRes.status === 'fulfilled') {
    const row = perPbrRes.value.find(r => r.code === ref.code);
    if (row) {
      krxPer = row.per > 0 ? row.per : null;
      krxPbr = row.pbr > 0 ? row.pbr : null;
    }
  } else {
    errors.push(`krx.perPbr: ${safeErr(perPbrRes.reason)}`);
  }

  return {
    kis: {
      currentPrice: kisPrice,
      foreignNetBuy: kisFlow?.foreignNetBuy ?? null,
      institutionalNetBuy: kisFlow?.institutionalNetBuy ?? null,
      individualNetBuy: kisFlow?.individualNetBuy ?? null,
    },
    yahoo,
    dart,
    krxPer,
    krxPbr,
    errors,
  };
}

function safeErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e).slice(0, 120);
}

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '데이터 없음';
  return v.toLocaleString('ko-KR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '데이터 없음';
  return Math.round(v).toLocaleString('ko-KR');
}

// ── 블록 빌더 ────────────────────────────────────────────────────────────────

/**
 * Gemini 프롬프트에 주입할 "사전 수집 실데이터" 블록을 문자열로 반환한다.
 * 각 소스가 실패해도 "데이터 없음"으로 표기되어 프롬프트 구조가 깨지지 않는다.
 */
export async function buildStockInterpretContext(ref: StockRef): Promise<string> {
  if (!ref.code || !/^\d{6}$/.test(ref.code)) {
    throw new Error(`buildStockInterpretContext: 6자리 종목코드가 필요 (받은 값: ${ref.code})`);
  }
  const data = await collectAll(ref);
  const y = data.yahoo;

  const perFinal = data.krxPer ?? (y?.per && y.per < 999 ? y.per : null);
  const linesKis: string[] = [
    `현재가(KIS): ${fmtInt(data.kis.currentPrice)}원`,
    `외국인 당일 순매수: ${fmtInt(data.kis.foreignNetBuy)}주`,
    `기관 당일 순매수:   ${fmtInt(data.kis.institutionalNetBuy)}주`,
    `개인 당일 순매수:   ${fmtInt(data.kis.individualNetBuy)}주`,
  ];

  const linesTech: string[] = y ? [
    `등락률: ${fmtNum(y.changePercent, 2)}%`,
    `거래량: ${fmtInt(y.volume)} (20일평균 ${fmtInt(y.vol20dAvg)})`,
    `이동평균: MA5=${fmtNum(y.ma5, 0)} / MA20=${fmtNum(y.ma20, 0)} / MA60=${fmtNum(y.ma60, 0)}`,
    `20일 고가: ${fmtNum(y.high20d, 0)} / 60일 고가: ${fmtNum(y.high60d, 0)}`,
    `ATR14: ${fmtNum(y.atr, 2)} / ATR20avg: ${fmtNum(y.atr20avg, 2)}`,
    `RSI14: ${fmtNum(y.rsi14, 1)} (5일 전 ${fmtNum(y.rsi5dAgo, 1)})`,
    `MACD(히스토그램): ${fmtNum(y.macdHistogram, 2)} (5일 전 ${fmtNum(y.macd5dHistAgo, 2)})`,
    `주봉 RSI(9): ${fmtNum(y.weeklyRSI, 1)} / MA60 추세 상승: ${y.ma60TrendUp ? 'Y' : 'N'}`,
  ] : ['(Yahoo 기술지표 데이터 없음 — fetchYahooQuote 실패)'];

  const linesFin: string[] = data.dart ? [
    `ROE: ${fmtNum(data.dart.roe, 1)}% | OPM: ${fmtNum(data.dart.opm, 1)}%`,
    `부채비율: ${fmtNum(data.dart.debtRatio, 1)}% | OCF비율: ${fmtNum(data.dart.ocfRatio, 1)}%`,
    `재무 기준년도: ${data.dart.year}`,
  ] : ['(DART 재무 데이터 없음 — API 키 미설정 또는 조회 실패)'];

  const linesValuation: string[] = [
    `PER: ${fmtNum(perFinal, 2)}`,
    `PBR: ${fmtNum(data.krxPbr, 2)}`,
  ];

  return [
    `종목: ${ref.name} (${ref.code})`,
    '',
    '## 수급 (KIS 실계좌)',
    ...linesKis,
    '',
    '## 기술지표 (Yahoo 실계산)',
    ...linesTech,
    '',
    '## 재무 (DART 실계산)',
    ...linesFin,
    '',
    '## 밸류에이션 (KRX/Yahoo)',
    ...linesValuation,
    '',
    data.errors.length > 0
      ? `## 수집 오류 (참고)\n${data.errors.map(e => `- ${e}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n');
}

/** 테스트·디버깅용 — collectAll 의 결과를 외부에서 확인. */
export async function _debugCollect(ref: StockRef): Promise<CollectedData> {
  return collectAll(ref);
}
