/**
 * macroIndexEngine.ts — 아이디어 11: ECOS + FRED 기반 MHS 자체 계산 엔진
 *
 * Before: batchIntel Phase A 가 Gemini 에게 BOK 금리·GDP·M2 등을 추론시켰다.
 * After:  ECOS(한국) + FRED(미국) 원시 데이터를 서버에서 직접 수집하고, 기존
 *         src/services/quant/macroEngine.ts 의 4축 규칙과 동일한 공식을 서버
 *         사이드에서 재현해 MHS(Macro Health Score, 0~100) 를 결정적으로 도출한다.
 *
 * Gemini 는 "해석 코멘트" 만 생성 — 숫자/분류는 결정적 알고리즘이 담당하므로
 * Phase A 토큰 ~80% 절감, 지수 신뢰도는 ECOS/FRED 공식 데이터라 오히려 상승.
 *
 * 공식 (4축 × 25점 = 100점):
 *   1. 금리 축: BOK 방향 + US10Y 수준 + 한미 금리차 역전 여부
 *   2. 유동성 축: M2 YoY vs GDP + 은행 대출 증가율
 *   3. 경기 축: OECD CLI 근사(수출·GDP 합성) + 수출 증가율 3M 평균
 *   4. 리스크 축: VKOSPI + VIX + FRED 금융스트레스지수(FSI) + HY 스프레드
 *
 * 한계:
 *   - VKOSPI·VIX·samsungIri 는 ECOS/FRED 커버리지 밖 → 호출자가 주입(선택).
 *     주입이 없으면 중립값(18·18·1.0)으로 가정해 리스크 축을 보수적으로 계산.
 *   - ECOS/FRED 양쪽 전부 실패하면 default MHS=50 (NEUTRAL) 반환 → 기존 macroState
 *     기본값과 동일 → regime 전환 알림이 폭주하지 않는다.
 */

import { fetchEcosSnapshot, type EcosSnapshot, type BokRateDirection } from '../clients/ecosClient.js';
import { fetchFredSnapshot, type FredSnapshot } from '../clients/fredClient.js';
import { callGeminiInterpret } from '../clients/geminiClient.js';

export interface MacroIndexPreloadedSources {
  ecos?: EcosSnapshot;
  fred?: FredSnapshot;
}

// ── 상수 (src/constants/thresholds.ts 와 동기화) ─────────────────────────────

const MACRO_AXIS_MAX = 25;
const MHS_THRESHOLDS = { BULL: 70, NEUTRAL: 50, DEFENSE: 30 } as const;
const VKOSPI_T        = { CALM: 20, ELEVATED: 25, FEAR: 30, EXTREME: 35 } as const;
const VIX_T           = { ELEVATED: 20, FEAR: 30, CONTRARIAN: 35 } as const;
const US10Y_HIGH      = 4.5;
const KR_US_INVERSION = -1.0;

/** FRED FSI 해석: > 0 = 스트레스 / > 1 = 극단 스트레스. 자체 보정 완충 구간. */
const FSI_ELEVATED = 0.5;
const FSI_EXTREME  = 1.5;
/** US HY 스프레드(%): 정상 3-4, 경고 >5, 위기 >7 (2020/3 같은 극단). */
const HY_ELEVATED = 5.0;
const HY_EXTREME  = 7.0;

// ── 타입 ─────────────────────────────────────────────────────────────────────

export type MhsRegime = 'BULL' | 'NEUTRAL_HIGH' | 'NEUTRAL_LOW' | 'DEFENSE';

export interface MhsAxisDetails {
  interestRate: number; // 0~25
  liquidity:    number;
  economy:      number;
  risk:         number;
}

/** 호출자가 실시간 시장 기반으로 주입하는 보조값 (Yahoo 등에서). */
export interface OptionalMarketInputs {
  vkospi?:     number;
  vix?:        number;
  samsungIri?: number;   // 0.5~1.5 범위 (1.0 = 중립)
  us10yYield?: number;   // 주입되지 않으면 FRED 미제공 시 4.3 기본
  usShortRate?: number;  // 한미 금리차 계산용 (없으면 FRED SOFR 사용)
}

export interface MacroIndexResult {
  mhs: number;                // 0~100, 정수
  regime: MhsRegime;
  buyingHalted: boolean;       // MHS < 30
  axis: MhsAxisDetails;
  /** 각 축에 영향을 준 핵심 시그널 (리포트·알림용). */
  drivers: string[];
  /** ECOS/FRED 수집 스냅샷 + 호출자 주입값 — Gemini 해석 프롬프트 주입용. */
  inputs: {
    ecos: EcosSnapshot;
    fred: FredSnapshot;
    vkospi:     number | null;
    vix:        number | null;
    samsungIri: number | null;
  };
  sourcesOk: { ecos: boolean; fred: boolean };
  computedAt: string;
}

// ── 유틸 ─────────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function regimeFromMhs(mhs: number): MhsRegime {
  if (mhs >= MHS_THRESHOLDS.BULL)    return 'BULL';
  if (mhs >= MHS_THRESHOLDS.NEUTRAL) return 'NEUTRAL_HIGH';
  if (mhs >= MHS_THRESHOLDS.DEFENSE) return 'NEUTRAL_LOW';
  return 'DEFENSE';
}

function oeciCliApprox(exportGrowth3mAvg: number | null, nominalGdpGrowth: number | null): number {
  // src/services/stock/batchIntel.ts#estimateOeciCliKorea 과 동일 공식.
  const ex = exportGrowth3mAvg ?? 0;
  const gdp = nominalGdpGrowth ?? 3.5;
  const exportContrib = clamp(ex / 5, -5, 5);
  const gdpContrib    = clamp(gdp - 3.5, -2, 2);
  return parseFloat((100 + exportContrib + gdpContrib).toFixed(2));
}

// ── 4축 점수 ────────────────────────────────────────────────────────────────

function scoreInterestRate(
  bokDir: BokRateDirection,
  us10y: number,
  krUsSpread: number | null,
  drivers: string[],
): number {
  let s = 20;
  if (bokDir === 'HIKING') { s -= 10; drivers.push('금리: BOK 인상 사이클(-10)'); }
  else if (bokDir === 'CUTTING') { s += 5; drivers.push('금리: BOK 인하 사이클(+5)'); }
  else drivers.push('금리: BOK 동결');
  if (us10y > US10Y_HIGH) { s -= 5; drivers.push(`US10Y ${us10y.toFixed(2)}% 고금리(-5)`); }
  if (krUsSpread !== null && krUsSpread < KR_US_INVERSION) {
    s -= 5;
    drivers.push(`한미금리차 ${krUsSpread.toFixed(2)}pp 역전 심화(-5)`);
  }
  return clamp(s, 0, MACRO_AXIS_MAX);
}

function scoreLiquidity(
  m2Yoy: number | null,
  nominalGdp: number | null,
  bankLendingYoy: number | null,
  drivers: string[],
): number {
  let s = 15;
  if (m2Yoy != null && nominalGdp != null) {
    if (m2Yoy > nominalGdp) { s += 10; drivers.push(`M2(${m2Yoy.toFixed(1)}%)>GDP(${nominalGdp.toFixed(1)}%) 잉여(+10)`); }
    else                      { s -= 5;  drivers.push(`M2(${m2Yoy.toFixed(1)}%)≤GDP(${nominalGdp.toFixed(1)}%) 긴축(-5)`); }
  } else {
    drivers.push('유동성: M2/GDP 데이터 부족 — 중립 유지');
  }
  if (bankLendingYoy != null) {
    if (bankLendingYoy > 5) { s += 3; drivers.push(`대출 ${bankLendingYoy.toFixed(1)}% 확장(+3)`); }
    else if (bankLendingYoy < 0) { s -= 5; drivers.push(`대출 ${bankLendingYoy.toFixed(1)}% 역성장(-5)`); }
  }
  return clamp(s, 0, MACRO_AXIS_MAX);
}

function scoreEconomy(
  exportGrowth3m: number | null,
  nominalGdp: number | null,
  drivers: string[],
): number {
  const cli = oeciCliApprox(exportGrowth3m, nominalGdp);
  let s = 15;
  if (cli > 101) { s += 5; drivers.push(`OECD CLI 근사 ${cli} 확장(+5)`); }
  else if (cli < 99) { s -= 5; drivers.push(`OECD CLI 근사 ${cli} 수축(-5)`); }
  if (exportGrowth3m != null) {
    if (exportGrowth3m > 5) { s += 5; drivers.push(`수출 3M평균 +${exportGrowth3m.toFixed(1)}% 호조(+5)`); }
    else if (exportGrowth3m < -5) { s -= 10; drivers.push(`수출 3M평균 ${exportGrowth3m.toFixed(1)}% 급감(-10)`); }
  } else {
    drivers.push('경기: 수출 데이터 부재 — 중립');
  }
  return clamp(s, 0, MACRO_AXIS_MAX);
}

function scoreRisk(
  vkospi: number,
  vix: number,
  samsungIri: number,
  fsi: number | null,
  hySpreadPct: number | null,
  drivers: string[],
): number {
  let s = MACRO_AXIS_MAX;
  if (vkospi > VKOSPI_T.ELEVATED) { s -= 12; drivers.push(`VKOSPI ${vkospi.toFixed(1)} 고공포(-12)`); }
  else if (vkospi > VKOSPI_T.CALM) { s -= 6; drivers.push(`VKOSPI ${vkospi.toFixed(1)} 경계(-6)`); }
  if (vix > VIX_T.FEAR) { s -= 10; drivers.push(`VIX ${vix.toFixed(1)} 공포(-10)`); }
  else if (vix > VIX_T.ELEVATED) { s -= 5; drivers.push(`VIX ${vix.toFixed(1)} 경계(-5)`); }
  if (samsungIri < 0.7) { s -= 5; drivers.push(`삼성IRI ${samsungIri.toFixed(2)} 약세(-5)`); }

  // FRED 보완: FSI / HY 스프레드가 극단이면 추가 감점.
  if (fsi != null) {
    if (fsi > FSI_EXTREME) { s -= 8; drivers.push(`FSI ${fsi.toFixed(2)} 극단 스트레스(-8)`); }
    else if (fsi > FSI_ELEVATED) { s -= 3; drivers.push(`FSI ${fsi.toFixed(2)} 스트레스(-3)`); }
  }
  if (hySpreadPct != null) {
    if (hySpreadPct > HY_EXTREME) { s -= 8; drivers.push(`HY ${hySpreadPct.toFixed(2)}% 극단(-8)`); }
    else if (hySpreadPct > HY_ELEVATED) { s -= 3; drivers.push(`HY ${hySpreadPct.toFixed(2)}% 경계(-3)`); }
  }
  return clamp(s, 0, MACRO_AXIS_MAX);
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * ECOS + FRED 원시 데이터를 수집해 MHS 를 계산한다.
 * 모든 소스가 실패하면 MHS=50(NEUTRAL_HIGH) · buyingHalted=false 로 보수 폴백.
 */
export async function computeMacroIndex(
  market: OptionalMarketInputs = {},
  preloaded: MacroIndexPreloadedSources = {},
): Promise<MacroIndexResult> {
  const [ecos, fred] = await Promise.all([
    preloaded.ecos ? Promise.resolve(preloaded.ecos) : fetchEcosSnapshot(),
    preloaded.fred ? Promise.resolve(preloaded.fred) : fetchFredSnapshot(),
  ]);

  const vkospi     = market.vkospi    ?? null;
  const vix        = market.vix       ?? null;
  const samsungIri = market.samsungIri ?? null;
  // 한미 금리차: ECOS bokRate.rate - (Yahoo usShortRate || FRED SOFR).
  const bokRate = ecos.bokRate;
  const us10y = market.us10yYield ?? 4.3;
  const usShortRate = market.usShortRate ?? fred.sofrPct ?? null;
  const krUsSpread =
    bokRate && usShortRate != null
      ? parseFloat((bokRate.rate - usShortRate).toFixed(2))
      : null;

  const drivers: string[] = [];

  const interestRate = scoreInterestRate(
    bokRate?.direction ?? 'HOLDING',
    us10y,
    krUsSpread,
    drivers,
  );
  const liquidity = scoreLiquidity(
    ecos.m2YoyPct,
    ecos.nominalGdpGrowth,
    ecos.bankLendingYoyPct,
    drivers,
  );
  const economy = scoreEconomy(
    ecos.exportGrowth3mAvg,
    ecos.nominalGdpGrowth,
    drivers,
  );
  const risk = scoreRisk(
    vkospi    ?? 18,    // 중립값 (VKOSPI.CALM 미만)
    vix       ?? 18,    // 중립값 (VIX.ELEVATED 미만)
    samsungIri ?? 1.0,  // 중립
    fred.financialStress,
    fred.hySpreadPct,
    drivers,
  );

  const ecosOk = !!bokRate || ecos.m2YoyPct != null || ecos.exportGrowth3mAvg != null;
  const fredOk = fred.yieldCurve10y2y != null || fred.sofrPct != null || fred.hySpreadPct != null;

  let mhs = Math.round(interestRate + liquidity + economy + risk);
  // 양쪽 소스가 전부 죽었을 때는 보수적으로 NEUTRAL(50) 반환.
  if (!ecosOk && !fredOk) {
    mhs = 50;
    drivers.push('데이터 소스 전면 실패 — MHS 50(NEUTRAL) 폴백');
  }
  mhs = clamp(mhs, 0, 100);

  return {
    mhs,
    regime: regimeFromMhs(mhs),
    buyingHalted: mhs < MHS_THRESHOLDS.DEFENSE,
    axis: { interestRate, liquidity, economy, risk },
    drivers,
    inputs: { ecos, fred, vkospi, vix, samsungIri },
    sourcesOk: { ecos: ecosOk, fred: fredOk },
    computedAt: new Date().toISOString(),
  };
}

// ── Gemini 주입용 포맷터 ─────────────────────────────────────────────────────

/**
 * callGeminiInterpret() 에 바로 넣을 "[사전 수집 실데이터]" 블록 빌더.
 * 실패한 필드는 "데이터 없음"으로 자연 수렴 — 프롬프트 구조 안정.
 */
export function buildMacroInterpretContext(result: MacroIndexResult): string {
  const f = (v: number | null, d = 2, suffix = '') =>
    v == null ? '데이터 없음' : `${v.toFixed(d)}${suffix}`;

  const { ecos, fred, vkospi, vix, samsungIri } = result.inputs;
  const lines: string[] = [
    `## MHS (자체 계산)  : ${result.mhs}/100  [${result.regime}${result.buyingHalted ? ', 매수중단' : ''}]`,
    `   axis: 금리=${result.axis.interestRate} / 유동성=${result.axis.liquidity} / 경기=${result.axis.economy} / 리스크=${result.axis.risk}`,
    '',
    '## ECOS (한국은행)',
    `BOK 기준금리: ${ecos.bokRate ? `${ecos.bokRate.rate}% (${ecos.bokRate.direction}, ${ecos.bokRate.date})` : '데이터 없음'}`,
    `M2 YoY: ${f(ecos.m2YoyPct, 2, '%')}  |  실질 GDP QoQ: ${f(ecos.nominalGdpGrowth, 2, '%')}`,
    `수출 3M 평균 YoY: ${f(ecos.exportGrowth3mAvg, 2, '%')}  |  은행 대출 YoY: ${f(ecos.bankLendingYoyPct, 2, '%')}`,
    `USD/KRW: ${f(ecos.usdKrw, 2)}`,
    '',
    '## FRED (미국 연준)',
    `T10Y2Y(장단기): ${f(fred.yieldCurve10y2y, 2, '%')}  |  US HY 스프레드: ${f(fred.hySpreadPct, 2, '%')}`,
    `SOFR: ${f(fred.sofrPct, 2, '%')}  |  STLFSI4: ${f(fred.financialStress, 2)}  |  WTI: ${f(fred.wtiCrude, 2)}`,
    '',
    '## 시장 보조 (호출자 주입)',
    `VKOSPI: ${f(vkospi, 1)}  |  VIX: ${f(vix, 1)}  |  SamsungIRI: ${f(samsungIri, 2)}`,
    '',
    '## 핵심 드라이버 (점수 기여)',
    ...result.drivers.map(d => `- ${d}`),
  ];
  if (ecos.errors.length > 0 || fred.errors.length > 0) {
    lines.push('', '## 수집 오류 (참고)');
    for (const e of ecos.errors) lines.push(`- ecos.${e}`);
    for (const e of fred.errors) lines.push(`- fred.${e}`);
  }
  return lines.join('\n');
}

/**
 * Gemini 해석 코멘트 생성.
 * 숫자/분류는 computeMacroIndex()가 이미 결정했으므로, Gemini 에게는 검색 금지
 * 프리앰블이 붙은 "해석 전용" 모드로 짧은 한국어 코멘트만 요청한다.
 * 키 미설정 / 예산 차단 / 네트워크 실패는 모두 null 로 자연 수렴.
 */
export async function generateMacroCommentary(
  result: MacroIndexResult,
): Promise<string | null> {
  const context = buildMacroInterpretContext(result);
  const instruction =
    '위 MHS/축별 점수와 ECOS·FRED 실데이터를 해석하여,\n' +
    '1) 현재 거시 환경의 한 줄 요약(30자 이내),\n' +
    '2) 투자자 관점의 주요 리스크 1개,\n' +
    '3) 향후 2주 내 주목할 지표 1개를 각각 Bullet 로 작성하라.\n' +
    '숫자는 반드시 [사전 수집 실데이터] 블록의 값만 사용한다.';
  return callGeminiInterpret(context, instruction, 'macro-index');
}
