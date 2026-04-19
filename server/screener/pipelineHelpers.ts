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
 *
 * Stage 3 결정화 (Idea 5):
 *   computeDeterministicScreening() — qualScore/signal/profile 결정적 산출 (재현성 보장)
 *   runStage3Screening()            — 결정적 결과 + Gemini topReasons 자연어만 호출 (1024토큰)
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

/**
 * 주요 종목 수동 오버라이드 (세분화된 분류).
 *
 * KRX 자동 스냅샷(data/krx-sector-map.json) 은 '전기전자' 같은 대분류만 제공하므로,
 * '반도체소재/반도체장비/2차전지소재/조선엔진' 등 LEADING_SECTORS 매칭에 필요한
 * 세분화는 이 상수로 유지한다. 나머지 전종목 섹터는 sectorMap.ts::getSectorByCode
 * 가 KRX 맵에서 자동 조회하므로 Gemini 에 섹터 재추론 요청이 필요 없다.
 */
export const SECTOR_MAP: Record<string, string> = {
  // 반도체
  '005930': '반도체', '000660': '반도체', '042700': '반도체',
  '357780': '반도체소재', '095340': '반도체소재', '058470': '반도체부품',
  '403870': '반도체장비', '039030': '반도체장비', '240810': '반도체장비', '336260': '반도체장비',
  '222160': '반도체', '454910': 'AI반도체',
  // 2차전지
  '373220': '2차전지', '006400': '2차전지', '247540': '2차전지소재',
  '086520': '2차전지소재', '383310': '2차전지소재', '003670': '2차전지소재',
  '078600': '2차전지소재',
  // 조선·방산
  '009540': '조선', '010620': '조선', '042660': '조선',
  '012450': '방산', '047810': '방산', '064350': '방산',
  // 에너지·원자력·전력기기
  '034020': '원자력', '015760': '에너지', '009830': '신재생에너지',
  '298040': '전력기기', '103590': '전력기기', '267260': '전력기기',
  '042670': '건설기계',
  // 바이오·제약·헬스케어
  '207940': '바이오', '068270': '바이오', '196170': '바이오',
  '141080': '바이오', '298380': '바이오', '000100': '제약',
  '328130': '바이오AI', '145020': '바이오', '950160': '바이오',
  '226330': '바이오AI', '086900': '바이오', '195940': '제약',
  '099430': '바이오', '041920': '헬스케어', '099190': '헬스케어',
  '443060': '바이오',
  // IT·플랫폼·AI
  '035420': 'IT서비스', '035720': 'IT서비스', '259960': 'IT서비스',
  '323410': '핀테크', '377300': '핀테크',
  '108860': 'AI', '067160': 'IT서비스',
  '080010': 'AI', '278990': 'AI',
  // 자동차
  '005380': '자동차', '000270': '자동차', '012330': '자동차부품',
  // 금융
  '105560': '금융', '055550': '금융', '086790': '금융', '316140': '금융',
  '024110': '금융', '006800': '금융', '138930': '금융',
  '211050': '금융',
  // 소재·철강
  '051910': '화학', '011170': '화학', '005490': '철강',
  '004020': '철강', '010130': '금속', '006260': '소재',
  '298020': '화학', '025900': '소재',
  // 전기·통신
  '066570': '가전', '011070': '전자부품', '009150': '전자부품',
  '017670': '통신', '030200': '통신',
  '272110': '반도체장비',
  // 해운·물류·엔진
  '011200': '해운', '003490': '항공', '180640': '항공',
  '039440': '조선엔진',
  // 엔터·소비
  '035900': '엔터테인먼트', '041510': '엔터테인먼트', '122870': '엔터테인먼트',
  '253450': '엔터테인먼트',
  '002790': '화장품', '090430': '화장품', '021240': '생활용품',
  '257720': '화장품', '214150': '의료미용',
  // 로봇·AI
  '322510': 'AI', '352480': 'AI',
  // 기타
  '348150': '반도체장비', '389030': '생활용품',
  // 조선·해양 확장
  '010140': '조선', '267250': '조선', '082740': '조선엔진',
  '044490': '조선기자재', '075580': '조선기자재',
  // 방산 확장
  '079550': '방산', '273640': '방산', '000880': '방산',
  '067390': '방산', '099320': '방산', '101930': '방산부품',
  '024740': '방산부품', '003570': '방산',
  // 원자력·SMR 확장
  '052690': '원자력', '015750': '원자력', '092200': '원자력부품',
  '064260': '원자력', '023800': '원자력부품',
  // 전력기기 확장
  '033100': '전력기기',
  // 로봇
  '277810': '로봇',
  // 반도체 장비·소재 확장
  '089030': '반도체장비', '131970': '반도체장비', '014680': '반도체소재',
  // 2차전지소재 확장
  '278280': '2차전지소재', '121600': '2차전지소재',
  // 바이오·의료 확장
  '950210': '바이오', '237690': '바이오', '335890': '의료미용',
  '340570': '헬스케어', '043150': '헬스케어',
  // AI·소프트웨어 확장
  '039980': 'AI', '394280': 'AI반도체',
  // 소비재 확장
  '432720': '화장품', '003230': '식품',
  // 건설
  '375500': '건설', '006360': '건설',
  // 자동차IT
  '307950': 'IT서비스',
  // 게임
  '078340': '게임', '194480': '게임',
  // 반도체 2차 확장
  '033640': '반도체', '319660': '반도체장비', '067310': '반도체',
  '064760': '반도체소재', '084370': '반도체장비', '140860': '반도체장비',
  '074600': '반도체소재', '183300': '반도체소재', '094360': '반도체',
  '200710': '반도체', '045390': '반도체장비',
  // 2차전지 2차 확장
  '066970': '2차전지소재', '005070': '2차전지소재', '336370': '2차전지소재',
  // 바이오·제약 2차 확장
  '214450': '바이오', '293780': '바이오', '078160': '바이오',
  '009420': '바이오', '128940': '제약', '006280': '바이오',
  '084110': '제약',
  // 방산 2차 확장
  '082920': '방산', '357550': '방산',
  // 전력기기·전자부품 확장
  '010120': '전력기기',
  '353200': '전자부품', '090460': '전자부품', '007660': '전자부품',
  '222800': '전자부품',
  // 로봇 2차 확장
  '090360': '로봇', '348340': '로봇',
  // AI·IT·보안 확장
  '304100': 'AI', '119860': 'IT서비스', '053800': 'IT보안',
  '263860': 'IT보안', '022100': 'IT서비스',
  // 조선기자재 2차 확장
  '014620': '조선기자재', '017960': '조선기자재', '238490': '조선기자재',
  // 화장품 2차 확장
  '192820': '화장품', '161890': '화장품',
  // 게임 2차 확장
  '462870': '게임',
  // 자동차부품 확장
  '204320': '자동차부품', '011210': '자동차부품', '064960': '자동차부품',
  '005760': '자동차부품',
  // 디스플레이·자동화
  '213420': '디스플레이', '056190': '자동화장비',
  // 통신장비·원자력·철강 확장
  '189300': '통신장비', '105840': '원자력부품', '001430': '철강',
};

/** 레짐별 주도 섹터 (확장: 전력기기·방산·AI반도체·의료미용·로봇·건설 추가) */
export const LEADING_SECTORS: Record<string, string[]> = {
  R1_TURBO:   ['반도체', 'AI반도체', '방산', '조선', '원자력', '2차전지', '전력기기', '조선엔진', '로봇'],
  R2_BULL:    ['반도체', 'AI반도체', '2차전지', 'IT서비스', '바이오', 'AI', '전력기기', '로봇'],
  R3_EARLY:   ['금융', '조선', '소재', '원자력', '전력기기', '방산', '건설기계', '건설'],
  R4_NEUTRAL: ['화장품', '헬스케어', 'IT서비스', '바이오', '의료미용', 'AI', '바이오AI'],
  R5_CAUTION: ['통신', '에너지', '금융', '제약', '헬스케어', '생활용품'],
  R6_DEFENSE: ['통신', '유틸리티', '제약', '금융', '헬스케어'],
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

/**
 * 눌림목(Pullback) 셋업 판별.
 *
 * 조건:
 *  1. 60일 고점 대비 3~20% 조정 (적정 눌림, 붕괴 아님)
 *  2. 가격 > MA60 (장기 추세 유지)
 *  3. VCP(변동성 축소) 또는 거래량 마름 (에너지 응축)
 *  4. RSI 30~62 (완화 — 강한 추세에서 RSI 56~62 첫 눌림 포착)
 */
export function isPullbackSetup(q: YahooQuoteExtended): boolean {
  if (q.high60d <= 0) return false;
  const drawdown = (q.high60d - q.price) / q.high60d * 100;
  if (drawdown < 3 || drawdown > 20) return false;         // 고점 대비 3~20% 조정
  if (q.ma60 <= 0 || q.price < q.ma60) return false;       // 장기 추세 유지
  const isVCP = q.atr > 0 && q.atr20avg > 0 && q.atr < q.atr20avg * 0.75;
  if (!isVCP && !q.dailyVolumeDrying) return false;         // 압축 또는 거래량 마름
  if (q.rsi14 < 30 || q.rsi14 > 62) return false;          // 완화: 강한 추세 첫 눌림 허용
  return true;
}

/**
 * Stage 1 정량 필터 임계값 — KIS/Yahoo 양 경로 공통 적용.
 * 수치 변경 시 여기 한 곳만 수정하면 된다.
 */
export const STAGE1_THRESHOLDS = {
  MIN_PRICE: 3000,              // 저가주 제외
  MAX_OVERHEAT_PCT: 8,          // 당일 과열 상한
  MAX_DRAWDOWN_PCT: -2,         // 눌림목이라도 하락 허용 하한
  MIN_VOLUME_MULTIPLIER: 1.2,   // 평균 대비 최소 거래량 배수
  VCP_ATR_RATIO: 0.75,          // ATR < 20일평균 × 비율 = VCP
  MAX_PER: 60,                  // PER 상한 (0 이하는 미적용)
  MAX_RETURN_5D: 15,            // 5일 누적 수익률 상한 (급등주 제외)
} as const;

/**
 * Stage 1 정량 필터 — KIS 랭킹 경로와 Yahoo 유니버스 경로에서 동일하게 사용.
 * 필터 순서는 저비용 → 고비용 순서로 정렬.
 */
export function passesStage1Filter(quote: YahooQuoteExtended): boolean {
  const t = STAGE1_THRESHOLDS;
  if (quote.price < t.MIN_PRICE) return false;
  if (quote.isHighRisk) return false;                            // 거래중지/관리종목/위험 분류 제외
  if (quote.changePercent >= t.MAX_OVERHEAT_PCT) return false;   // 당일 과열 제외
  const pullback = isPullbackSetup(quote);
  if (quote.changePercent < 0 && !pullback) return false;        // 음봉 제외 (눌림목 통과)
  if (quote.changePercent < t.MAX_DRAWDOWN_PCT) return false;    // 눌림목이라도 과도한 하락 제외
  const isVCP = quote.atr > 0 && quote.atr20avg > 0 && quote.atr < quote.atr20avg * t.VCP_ATR_RATIO;
  if (quote.volume < quote.avgVolume * t.MIN_VOLUME_MULTIPLIER && !isVCP && !pullback) return false;
  if (quote.per > 0 && quote.per > t.MAX_PER) return false;
  if (quote.ma20 > 0 && quote.price < quote.ma20 && !pullback) return false;
  if (quote.return5d > t.MAX_RETURN_5D) return false;            // 5일 과급등 제외
  return true;
}

export function calcStage1Score(q: YahooQuoteExtended): number {
  let score = 0;
  score += Math.min(q.changePercent / 10, 1);                            // 상승률 비중 축소 (최대 1점, 기존 2점)
  score += Math.min(q.volume / Math.max(q.avgVolume, 1) - 1, 2);        // 거래량 배수 (최대 2점)
  score += q.price >= q.ma5 ? 0.5 : 0;                                  // 5일선 위
  score += q.price >= q.high20d * 0.98 ? 1 : 0;                         // 20일 신고가 근접
  score += q.atr > 0 && q.atr20avg > 0 && q.atr < q.atr20avg * 0.7 ? 1 : 0; // VCP
  score += q.rsi14 >= 40 && q.rsi14 <= 65 ? 1 : 0;                     // RSI 건강구간 (과열 제외)
  score += (q.rsi14 - q.rsi5dAgo) >= 3 ? 1 : 0;                        // RSI 가속 (추세 초기 신호)
  score += q.return5d < 8 ? 0.5 : 0;                                    // 5일 과급등 아닌 종목 우대
  if (isPullbackSetup(q)) score += 2;                                    // 눌림목 프리미엄 (모멘텀 부족분 보상)
  return score;
}

export function getLeadingSectors(regime: RegimeLevel): string[] {
  return LEADING_SECTORS[regime] ?? LEADING_SECTORS['R4_NEUTRAL'];
}

// ── Stage 3 결정화 (Idea 5) ─────────────────────────────────────────────────
//
// 종전 구조: Gemini가 12개 질적 조건 자체를 평가 + qualScore/totalGateScore/signal/profile
//            모두 추정 → 동일 입력에 매번 다른 출력 (재현성 0).
// 신 구조  : 12개 조건을 모두 결정적 검사기로 이식 (confluenceResult/dartFin/macroState).
//            Gemini는 BUY 종목의 topReasons 2~3문장만 자연어 생성. maxOutputTokens 1024.
//            "기계적 매매" 원칙 — 같은 입력 → 같은 신호.

const QUAL_CONDITION_KEYS = [
  'qual_cycle_alignment',     // 1. 주도주 사이클 적합성
  'qual_regime_fit',          // 2. 시장 환경 부합
  'qual_not_prev_leader',     // 3. 신규 주도주 여부
  'qual_economic_moat',       // 4. 경제적 해자
  'qual_target_upside',       // 5. 목표가 여력
  'qual_earnings_surprise',   // 6. 실적 서프라이즈 가능성
  'qual_policy_macro',        // 7. 정책/매크로 부합
  'qual_psychology',          // 8. 심리적 객관성
  'qual_fib_elliott',         // 9. 피보나치/엘리엇 위치
  'qual_catalyst',            // 10. 촉매제 유무
  'qual_margin_accel',        // 11. 이익 모멘텀 가속도
  'qual_structural',          // 12. 기타 구조적 강점
] as const;

const RISK_ON_REGIMES: ReadonlyArray<RegimeLevel> = ['R1_TURBO', 'R2_BULL', 'R3_EARLY'];

/**
 * 12개 질적 조건을 결정적으로 평가.
 * confluenceResult(4축 점수, cyclePosition, catalystGrade) + dartFin(ROE/OPM)
 * + macroState(MHS) + Yahoo quote(RSI/return5d)에서 모든 신호를 도출.
 */
export function computeDeterministicScreening(
  candidates: CandidateStock[],
  regime: RegimeLevel,
  macroState: MacroState | null,
): GeminiScreenResult[] {
  const regimeIsRiskOn = RISK_ON_REGIMES.includes(regime);
  const mhs = macroState?.mhs ?? 0;

  return candidates.map<GeminiScreenResult>((c) => {
    const cf = c.confluenceResult;
    const q = c.quote;
    const dart = c.dartFin;
    const realGateScore = c.gateScore ?? 0;

    // ── 신호 결정 (HOLD는 Stage 2에서 이미 제거되지만 안전망) ──
    const signal: GeminiScreenResult['signal'] =
      !cf || cf.signal === 'HOLD'                ? 'SKIP'
      : cf.signal === 'CONFIRMED_STRONG_BUY'    ? 'STRONG_BUY'
      :                                           'BUY';

    // ── 프로파일 (포지션 사이즈/손절 폭 결정용) ──
    // A: 강한 게이트 + EARLY 사이클 (대형 주도주)
    // B: 양호한 게이트 (중형 성장주)
    // C: 평균 (소형 모멘텀주)
    // D: 약함 (촉매제 플레이)
    const profile: GeminiScreenResult['profile'] =
      realGateScore >= 8 && cf?.cyclePosition === 'EARLY' ? 'A'
      : realGateScore >= 6                                ? 'B'
      : realGateScore >= 4                                ? 'C'
      :                                                     'D';

    // ── 12개 질적 조건 결정적 검사 ──
    const checks: Array<{ key: typeof QUAL_CONDITION_KEYS[number]; pass: boolean }> = [
      // 1. 주도주 사이클: EARLY/MID는 진입 가치 있음, LATE는 후기
      { key: 'qual_cycle_alignment',   pass: cf?.cyclePosition === 'EARLY' || cf?.cyclePosition === 'MID' },
      // 2. 시장 환경: Risk-On 레짐(R1/R2/R3)
      { key: 'qual_regime_fit',        pass: regimeIsRiskOn },
      // 3. 신규 주도주: 5일 누적 수익률 < 15% (이미 폭등한 종목 제외)
      { key: 'qual_not_prev_leader',   pass: q.return5d < 15 },
      // 4. 경제적 해자: ROE >= 15% (DART 실데이터)
      { key: 'qual_economic_moat',     pass: (dart?.roe ?? 0) >= 15 },
      // 5. 목표가 여력: macroAxis 양호 + 사이클 LATE 아님 (구조적 헤드룸)
      { key: 'qual_target_upside',     pass: (cf?.macroAxis.score ?? 0) >= 60 && cf?.cyclePosition !== 'LATE' },
      // 6. 실적 서프라이즈: OPM >= 8% (높은 영업이익률은 어닝 서프 확률 높음)
      { key: 'qual_earnings_surprise', pass: (dart?.opm ?? 0) >= 8 },
      // 7. 정책/매크로 부합: MHS >= 55 (Macro Health Score)
      { key: 'qual_policy_macro',      pass: mhs >= 55 },
      // 8. 심리적 객관성: RSI 40~65 (과매수/과매도 모두 회피)
      { key: 'qual_psychology',        pass: q.rsi14 >= 40 && q.rsi14 <= 65 },
      // 9. 피보나치/엘리엇: 사이클 LATE 아님 (5파 종료 후 진입 위험)
      { key: 'qual_fib_elliott',       pass: cf?.cyclePosition !== 'LATE' },
      // 10. 촉매제: 등급 A 또는 B (technical+fundamental+supply 종합)
      { key: 'qual_catalyst',          pass: cf?.catalystGrade === 'A' || cf?.catalystGrade === 'B' },
      // 11. 이익 모멘텀 가속도: OPM > 0 (적자 기업 제외)
      { key: 'qual_margin_accel',      pass: (dart?.opm ?? 0) > 0 },
      // 12. 기타 구조적 강점: confluenceScore >= 65 (4축 가중 합산)
      { key: 'qual_structural',        pass: (cf?.confluenceScore ?? 0) >= 65 },
    ];

    const passedQual = checks.filter(ck => ck.pass);
    const qualScore = passedQual.length;
    const passedConditionKeys = passedQual.map(ck => ck.key);

    // totalGateScore: realGateScore × 1.5 + qualScore (0~27 범위 클램프)
    const totalGateScore = Math.max(0, Math.min(27,
      parseFloat((realGateScore * 1.5 + qualScore).toFixed(1)),
    ));

    return {
      code:                c.code,
      name:                c.name,
      signal,
      qualScore,
      totalGateScore,
      profile,
      sector:              c.sector,
      topReasons:          [],   // Gemini가 BUY/STRONG_BUY 종목에만 채움
      passedConditionKeys,
    };
  });
}

interface GeminiReasonRow { code: string; topReasons: string[] }

/**
 * BUY/STRONG_BUY 종목의 topReasons 2~3문장만 Gemini에 위임.
 * maxOutputTokens 1024 (기존 4096 → 75% 축소).
 * 호출 실패/SKIP만 있는 경우 빈 Map 반환 → 결정적 결과는 이미 확정되어 있으므로 안전.
 */
async function generateTopReasons(
  candidates: CandidateStock[],
  detResults: GeminiScreenResult[],
): Promise<Map<string, string[]>> {
  const ai = getGeminiClient();
  const buyTargets = detResults.filter(r => r.signal !== 'SKIP');
  if (!ai || buyTargets.length === 0) {
    if (!ai) console.warn('[Pipeline/Reasons] Gemini 키 미설정 — topReasons 빈값 사용');
    return new Map();
  }

  const lines = buyTargets.map(r => {
    const c = candidates.find(cd => cd.code === r.code);
    if (!c) return '';
    const cf = c.confluenceResult;
    const dart = c.dartFin;
    const kis = c.kisFlow;
    const segs = [
      `${r.name}(${r.code})`,
      `${r.signal}/Profile${r.profile}`,
      `${c.sector}`,
      `Gate${c.gateScore?.toFixed(1) ?? '?'}+Qual${r.qualScore}/12=${r.totalGateScore}/27`,
      cf ? `${cf.cyclePosition}사이클·촉매${cf.catalystGrade}·기술${cf.technicalAxis.score}·수급${cf.supplyAxis.score}·펀더${cf.fundamentalAxis.score}·매크로${cf.macroAxis.score}` : '',
      dart ? `ROE${dart.roe?.toFixed(0) ?? 'N/A'}%·OPM${dart.opm?.toFixed(0) ?? 'N/A'}%` : '',
      kis ? `외인${kis.foreignNetBuy >= 0 ? '+' : ''}${(kis.foreignNetBuy/1000).toFixed(0)}천주` : '',
    ].filter(Boolean);
    return `- ${segs.join(' | ')}`;
  }).filter(Boolean).join('\n');

  const prompt =
    `다음 ${buyTargets.length}개 한국 종목에 대해 매수 사유를 자연어로 작성하세요.\n` +
    `점수와 신호는 이미 시스템이 결정했습니다 (재평가 금지). 핵심 강점만 2~3문장으로 간결하게.\n\n` +
    `${lines}\n\n` +
    `JSON 배열로만 응답 (다른 텍스트 금지):\n` +
    `[{"code":"종목코드","topReasons":["사유1","사유2","사유3"]}]`;

  try {
    const res = await ai.models.generateContent({
      model:    AI_MODELS.SERVER_SIDE,
      contents: prompt,
      // 기존 4096 → 1024 (자연어 사유 2~3문장만 필요). temperature 0.4로 약간의 다양성 허용.
      config:   { temperature: 0.4, maxOutputTokens: 1024 },
    });
    const text = res.text ?? '';
    const arrStart = text.indexOf('[');
    if (arrStart === -1) return new Map();
    let depth = 0;
    let arrEnd = -1;
    for (let i = arrStart; i < text.length; i++) {
      if (text[i] === '[') depth++;
      else if (text[i] === ']') { depth--; if (depth === 0) { arrEnd = i; break; } }
    }
    if (arrEnd === -1) return new Map();
    const parsed = JSON.parse(text.slice(arrStart, arrEnd + 1)) as unknown[];
    const map = new Map<string, string[]>();
    for (const item of parsed) {
      if (item && typeof item === 'object') {
        const row = item as Partial<GeminiReasonRow>;
        if (typeof row.code === 'string' && Array.isArray(row.topReasons)) {
          const reasons = row.topReasons.filter((r): r is string => typeof r === 'string');
          if (reasons.length > 0) map.set(row.code, reasons);
        }
      }
    }
    return map;
  } catch (e) {
    console.warn('[Pipeline/Reasons] Gemini topReasons 호출 실패 — 빈값 폴백:', e instanceof Error ? e.message : e);
    return new Map();
  }
}

/**
 * Stage 3 메인 진입점 — 결정적 평가 + Gemini topReasons 자연어 생성을 통합.
 * 호출자(universeScanner.ts::stage3AIScreenAndRegister)는 이 함수만 호출하면 된다.
 */
export async function runStage3Screening(
  candidates: CandidateStock[],
  regime: RegimeLevel,
  macroState: MacroState | null,
): Promise<GeminiScreenResult[]> {
  const detResults = computeDeterministicScreening(candidates, regime, macroState);
  const reasonsMap = await generateTopReasons(candidates, detResults);
  return detResults.map(r => ({
    ...r,
    topReasons: reasonsMap.get(r.code) ?? r.topReasons,
  }));
}
