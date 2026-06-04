// @responsibility Gate2 후보별 sectorThemeCycle.sector 생산 — 종목→canonical 섹터명 매칭으로 SECTOR_THEME_CYCLE_MISSING 해소 (진단 전용).

/**
 * sectorThemeCycleProducer.ts (ADR-0571 — ADR-0423/0568/0570 완결편)
 *
 * 배경: normalizeSectorThemeCycleForGate2 는 input.sectorThemeCycle.sector 를 읽어
 * getSectorEnergyScore(sectorEnergyResult, sector) 로 sectorReturn20d 를 매칭한다. 그러나
 * repo 전체에서 sectorThemeCycle 을 *생산*하는 코드가 0건이라 sector 가 항상 null(UNKNOWN)
 * → SECTOR_THEME_CYCLE_MISSING → "Sector 0/25". 0568(sectorEnergyResult→Gate2 thread)·
 * 0570(sectorReturn20d 데이터)을 다 켜도 이 producer 부재로 0/25 였다.
 *
 * 본 모듈: Gate2 external coverage 입력에서 후보별로
 *   sectorThemeCycle.sector = canonicalize(stock.sector || getSectorByCode(code))
 * 를 합성한다. sectorEnergyResult.scores[].name 은 canonical 11/12 KRX 섹터명
 * ('반도체'/'바이오/헬스케어' 등)이므로, getSectorByCode 의 세분화 라벨('반도체소재'·
 * '2차전지'·'헬스케어' 등)을 정확히 같은 canonical 포맷으로 정규화해야 매칭 성공.
 *
 * ★ 정합 규칙(절대):
 *  - canonicalize 결과가 KRX_SECTOR_CANONICAL 에 없으면 undefined → producer 가 sector 미설정
 *    → normalizer 가 quote.sector/stockMaster.sector 기존 경로로 fallback (byte-equal 보존).
 *  - '미분류'/빈/UNKNOWN → undefined → normalizer FIELD_MISSING graceful(그 종목만 MISSING, crash 0).
 *  - flag(SECTOR_ENERGY_GATE2_WIRING_ENABLED) OFF 면 호출자가 본 모듈을 부르지 않아 미생산 =
 *    현행 byte-identical. ON 일 때만 sector 합성.
 *  - 호출자가 이미 sectorThemeCycle 을 명시 제공했으면 본 모듈은 호출되지 않는다(override 금지).
 *  - marketSignal/executionImpact 무영향 — 본 모듈은 분류 라벨만 생산(KIS 신규콜 0, sectorMap SSOT 재사용).
 */

import { getSectorByCode } from '../../screener/sectorMap.js';

/**
 * sectorEnergyResult.scores[].name 과 정합하는 canonical KRX 섹터명 SSOT.
 * src/types/sectorEnergy.ts KrxSectorName / sectorEnergyProvider.CANONICAL_SECTORS 와 동일.
 */
export const KRX_SECTOR_CANONICAL = [
  '반도체',
  '이차전지',
  '바이오/헬스케어',
  '인터넷/플랫폼',
  '자동차',
  '조선',
  '방산',
  '금융',
  '유통/소비재',
  '건설/부동산',
  '에너지/화학',
  '통신/유틸리티',
] as const;

export type KrxSectorCanonical = (typeof KRX_SECTOR_CANONICAL)[number];

const CANONICAL_SET: ReadonlySet<string> = new Set(KRX_SECTOR_CANONICAL);

/**
 * getSectorByCode 세분화 라벨 → canonical KRX 섹터명 정규화 매핑.
 *
 * sectorEnergyProvider.KRX_INDEX_TO_SECTOR(KRX 지수명 기준 regex)와 동일 결과를 내되,
 * sectorMap.SECTOR_MAP 의 *종목 분류 어휘*('반도체소재'·'AI반도체'·'IT서비스'·'화장품' 등)을
 * 정확히 커버한다. 신규 섹터 도입 0 — 모두 기존 12 canonical 로 귀속.
 */
const SECTOR_LABEL_TO_CANONICAL: Array<[RegExp, KrxSectorCanonical]> = [
  // 반도체·전자 (전자부품/가전 포함)
  [/반도체|전기\s*전자|전자\s*부품|가전|IT\s*하드|IT\s*H\/?W/i, '반도체'],
  // 이차전지 (2차전지/배터리/전지소재)
  [/이차\s*전지|2\s*차\s*전지|배터리|전지/, '이차전지'],
  // 바이오/헬스케어 (바이오/제약/헬스케어/의료/의약/의료미용)
  [/바이오|헬스\s*케어|제약|의약|의료/, '바이오/헬스케어'],
  // 인터넷/플랫폼 (IT서비스/AI/소프트웨어/게임/핀테크/엔터/미디어/플랫폼)
  [/플랫폼|인터넷|IT\s*서비스|소프트\s*웨어|S\/?W|게임|핀테크|엔터|미디어|로봇|AI/i, '인터넷/플랫폼'],
  // 자동차 (자동차/자동차부품/운수장비)
  [/자동차|운수\s*장비|운송\s*장비/, '자동차'],
  // 조선 (조선/조선엔진/조선기자재/해운/항공)
  [/조선|해운|항공/, '조선'],
  // 방산 (방산/방산부품/원자력/원자력부품)
  [/방산|국방|원자력|SMR/i, '방산'],
  // 금융 (금융/은행/증권/보험)
  [/은행|증권|보험|금융/, '금융'],
  // 유통/소비재 (유통/소비재/음식료/식품/화장품/생활용품/섬유)
  [/유통|소비재|음식료|식품|화장품|생활\s*용품|섬유/, '유통/소비재'],
  // 건설/부동산 (건설/부동산/리츠/건설기계)
  [/건설|부동산|리츠|건설\s*기계/, '건설/부동산'],
  // 에너지/화학 (에너지/화학/철강/금속/소재/신재생/전력기기)
  [/에너지|화학|철강|금속|소재|신재생|전력\s*기기|석유|비금속|종이|목재/, '에너지/화학'],
  // 통신/유틸리티 (통신/전기가스/유틸리티)
  [/통신|전기\s*가스|유틸리티/, '통신/유틸리티'],
];

/**
 * 임의 섹터 라벨 → canonical KRX 섹터명. 매칭 실패/미분류 시 undefined.
 *
 *  - 이미 canonical 이면 그대로 (정확 일치 우선).
 *  - 세분화 라벨이면 SECTOR_LABEL_TO_CANONICAL regex 로 귀속.
 *  - '미분류'/빈/UNKNOWN/영문 미지 라벨 → undefined (FIELD_MISSING graceful).
 */
export function canonicalizeSectorName(label: string | null | undefined): KrxSectorCanonical | undefined {
  if (!label) return undefined;
  const trimmed = String(label).trim();
  if (!trimmed || trimmed === '미분류' || trimmed.toUpperCase() === 'UNKNOWN') return undefined;
  if (CANONICAL_SET.has(trimmed)) return trimmed as KrxSectorCanonical;
  for (const [pattern, canonical] of SECTOR_LABEL_TO_CANONICAL) {
    if (pattern.test(trimmed)) return canonical;
  }
  return undefined;
}

export interface SectorThemeCycleProducerInput {
  /** 후보 종목코드 (quoteSymbol 결과 — 6자리 zero-pad 가능). */
  symbol?: string | null;
  /** stock/quote 가 이미 보유한 섹터 라벨(세분화 가능). */
  stockSector?: string | null;
  /** 호출자가 이미 명시 제공한 sectorThemeCycle (있으면 producer 미개입). */
  existingSectorThemeCycle?: unknown;
}

/**
 * 후보별 sectorThemeCycle 합성. canonical 섹터명을 매칭 가능한 경우에만 { sector } 를 생산한다.
 *
 * 반환:
 *  - 호출자가 이미 sectorThemeCycle 제공 → 그대로 반환(override 금지).
 *  - canonical 매칭 성공 → { sector } (stockReturn20d 는 normalizer 가 quote.return20d 로 alias).
 *  - 매칭 실패/미분류 → undefined (normalizer 가 FIELD_MISSING graceful 처리).
 */
export function produceSectorThemeCycleForGate2(
  input: SectorThemeCycleProducerInput,
): { sector: KrxSectorCanonical } | undefined {
  if (isNonEmptyRecord(input.existingSectorThemeCycle)) {
    // 명시 제공된 sectorThemeCycle 은 그대로 — producer 가 덮어쓰지 않는다.
    return undefined;
  }
  const fromStock = canonicalizeSectorName(input.stockSector);
  if (fromStock) return { sector: fromStock };
  const fromCode = canonicalizeSectorName(getSectorByCode(input.symbol ?? null));
  if (fromCode) return { sector: fromCode };
  return undefined;
}

function isNonEmptyRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}
