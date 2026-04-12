/**
 * pipelineHelpers.ts — 자동 발굴 파이프라인 공통 상수 및 유틸리티
 *
 * universeScanner.ts 에서 분리된 도메인 상수와 내부 헬퍼 함수.
 *   SECTOR_MAP          — 종목 코드 → 섹터 매핑
 *   LEADING_SECTORS     — 레짐별 주도 섹터
 *   STOP_RATES          — 레짐 × 프로파일별 손절 비율
 *   TARGET_RATES        — 레짐 × 프로파일별 목표가 비율
 *   addBusinessDays()   — 영업일 기준 날짜 덧셈
 *   calcStage1Score()   — Stage 1 종목 정량 점수 계산
 *   getLeadingSectors() — 레짐별 주도 섹터 조회
 *   callGeminiForScreening() — Gemini 스크리닝 배치 호출
 *   buildScreeningPrompt()   — Gemini 프롬프트 빌더
 *   parseScreeningResponse() — Gemini 응답 JSON 파서
 */

import { getGeminiClient } from '../clients/geminiClient.js';
import { AI_MODELS } from '../constants.js';
import type { YahooQuoteExtended } from './stockScreener.js';
import type { ConfluenceResult } from '../trading/confluenceEngine.js';
import type { MacroState } from '../persistence/macroStateRepo.js';
import type { RegimeLevel } from '../../src/types/core.js';

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface CandidateStock {
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
  // Phase 2 컨플루언스 결과 (Stage 2 → Stage 3 전달)
  confluenceResult?: ConfluenceResult;
}

export interface GeminiScreenResult {
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
export const SECTOR_MAP: Record<string, string> = {
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
export const LEADING_SECTORS: Record<string, string[]> = {
  R1_TURBO:   ['반도체', '방산', '조선', '원자력', '2차전지'],
  R2_BULL:    ['반도체', '2차전지', 'IT서비스', '바이오'],
  R3_EARLY:   ['금융', '조선', '소재', '원자력'],
  R4_NEUTRAL: ['화장품', '헬스케어', 'IT서비스', '바이오'],
  R5_CAUTION: ['통신', '에너지', '금융', '제약'],
  R6_DEFENSE: ['통신', '유틸리티', '제약', '금융'],
};

/** 레짐 × 프로파일별 손절 비율 */
export const STOP_RATES: Record<string, Record<string, number>> = {
  R1_TURBO:   { A: -0.08, B: -0.10, C: -0.12, D: -0.15 },
  R2_BULL:    { A: -0.08, B: -0.10, C: -0.12, D: -0.15 },
  R3_EARLY:   { A: -0.09, B: -0.11, C: -0.13, D: -0.16 },
  R4_NEUTRAL: { A: -0.10, B: -0.12, C: -0.15, D: -0.18 },
  R5_CAUTION: { A: -0.07, B: -0.09, C: -0.11, D: -0.13 },
  R6_DEFENSE: { A: -0.06, B: -0.08, C: -0.10, D: -0.12 },
};

/** 레짐 × 프로파일별 목표가 비율 */
export const TARGET_RATES: Record<string, Record<string, number>> = {
  R1_TURBO:   { A: 0.15, B: 0.20, C: 0.25, D: 0.30 },
  R2_BULL:    { A: 0.12, B: 0.15, C: 0.20, D: 0.25 },
  R3_EARLY:   { A: 0.10, B: 0.13, C: 0.17, D: 0.22 },
  R4_NEUTRAL: { A: 0.10, B: 0.12, C: 0.15, D: 0.20 },
  R5_CAUTION: { A: 0.08, B: 0.10, C: 0.12, D: 0.15 },
  R6_DEFENSE: { A: 0.07, B: 0.08, C: 0.10, D: 0.12 },
};

// ── 내부 유틸 ─────────────────────────────────────────────────────────────────

export function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

export function calcStage1Score(q: YahooQuoteExtended): number {
  let score = 0;
  score += Math.min(q.changePercent / 5, 2);                             // 상승률 (최대 2점)
  score += Math.min(q.volume / Math.max(q.avgVolume, 1) - 1, 2);        // 거래량 배수 (최대 2점)
  score += q.price >= q.ma5 ? 0.5 : 0;                                  // 5일선 위
  score += q.price >= q.high20d * 0.98 ? 1 : 0;                         // 20일 신고가 근접
  score += q.atr > 0 && q.atr20avg > 0 && q.atr < q.atr20avg * 0.7 ? 1 : 0; // VCP
  return score;
}

export function getLeadingSectors(regime: RegimeLevel): string[] {
  return LEADING_SECTORS[regime] ?? LEADING_SECTORS['R4_NEUTRAL'];
}

/** Gemini 스크리닝용 — maxOutputTokens 4096으로 배치 분석 */
export async function callGeminiForScreening(prompt: string): Promise<string | null> {
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

export function buildScreeningPrompt(
  candidates: CandidateStock[],
  regime: RegimeLevel,
  macroState: MacroState | null,
): string {
  const stockLines = candidates.map((c) => {
    const q          = c.quote;
    const techPassed = c.gateDetails?.join('|') ?? '';
    const cf         = c.confluenceResult;

    // DART 실데이터 포함 (있을 경우)
    const dartStr = c.dartFin
      ? `ROE:${c.dartFin.roe?.toFixed(1) ?? 'N/A'}% OPM:${c.dartFin.opm?.toFixed(1) ?? 'N/A'}% DR:${c.dartFin.debtRatio?.toFixed(0) ?? 'N/A'}%`
      : 'DART:미수집';

    // KIS 수급 실데이터 (있을 경우)
    const kisStr = c.kisFlow
      ? `외인${c.kisFlow.foreignNetBuy >= 0 ? '+' : ''}${(c.kisFlow.foreignNetBuy / 1000).toFixed(0)}천주 기관${c.kisFlow.institutionalNetBuy >= 0 ? '+' : ''}${(c.kisFlow.institutionalNetBuy / 1000).toFixed(0)}천주`
      : 'KIS:미수집';

    // 컨플루언스 요약 — 대괄호 금지(JSON 파서 충돌 방지): 소괄호 사용
    const cfStr = cf
      ? `컨플루언스:${cf.signal} ${cf.bullishAxes}/4축 기술${cf.technicalAxis.score}·수급${cf.supplyAxis.score}·펀더${cf.fundamentalAxis.score}·매크로${cf.macroAxis.score} ${cf.cyclePosition}사이클 촉매${cf.catalystGrade}`
      : '';

    return (
      `${c.name}(${c.code}): ${q.price.toLocaleString()}원 ` +
      `등락${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(1)}% ` +
      `RSI${q.rsi14.toFixed(0)}(5일전${q.rsi5dAgo.toFixed(0)}) MACD${q.macdHistogram >= 0 ? '상승' : '하락'} ` +
      `정배열:${q.price > q.ma5 && q.ma5 > q.ma20 ? 'Y' : 'N'} ` +
      `VCP:${q.atr > 0 && q.atr < q.atr20avg * 0.7 ? 'Y' : 'N'} ` +
      `섹터:${c.sector} ` +
      `Gate:${c.gateScore?.toFixed(1) ?? '?'}/10 ${techPassed} ` +
      `${dartStr} ${kisStr} ${cfStr}`
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

export function parseScreeningResponse(text: string): GeminiScreenResult[] {
  // '[{' 로 시작하는 JSON 배열 탐색 — 대괄호가 포함된 앞 텍스트(프롬프트 echo 등)에 의한
  // 그리디 오매칭 방지. 못 찾으면 첫 '[' fallback.
  const arrayStart = (() => {
    const idx = text.indexOf('[{');
    if (idx !== -1) return idx;
    const idx2 = text.indexOf('[');
    return idx2 !== -1 ? idx2 : -1;
  })();
  if (arrayStart === -1) return [];

  // 괄호 깊이 추적으로 짝이 맞는 ']' 찾기
  let depth = 0;
  let arrayEnd = -1;
  for (let i = arrayStart; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') { depth--; if (depth === 0) { arrayEnd = i; break; } }
  }
  if (arrayEnd === -1) return [];

  try {
    const parsed = JSON.parse(text.slice(arrayStart, arrayEnd + 1)) as unknown[];
    return parsed.filter(
      (item): item is GeminiScreenResult =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as GeminiScreenResult).code === 'string' &&
        typeof (item as GeminiScreenResult).signal === 'string',
    );
  } catch (e) {
    console.warn('[Pipeline/Stage3] JSON 파싱 실패:', e instanceof Error ? e.message : e);
    return [];
  }
}
