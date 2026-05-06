// @responsibility SECTOR_INDEX_MASTER SSOT — krxIndexCode/sectorKey/aliases SSOT 매핑 (ADR-0399)
/**
 * sectorEnergyMaster.ts (ADR-0399 = 사용자 명시 ADR-0374 — Sector Energy Source Restoration)
 *
 * 의도된 정책 명칭: ADR-0374 — Sector Energy Source Restoration (사용자 명시, 실제 발급 0399).
 *
 * 핵심 정책 (사용자 명시 절대 변경 금지):
 *   1. indexName 단독 매칭 금지 (ADR-0370 default OFF 강화 + 본 PR 영구 차단)
 *   2. krxIndexCode 또는 sectorKey 기반 SSOT 매핑 사용
 *   3. 12 표준 섹터 등재 (반도체/이차전지/바이오/금융/조선/철강/화학/건설/유통/IT/자동차/기타)
 *   4. 외부 의존성 0 (순수 정적 데이터 + lookup 헬퍼)
 *
 * 매트릭스 출처: KRX 공식 indexCode (코스피/코스닥 섹터지수). 일부 코드는 KRX 공개 시리즈에서
 * 가용한 가장 가까운 섹터지수 코드를 채택. yahooProxySymbol 은 Yahoo ETF L4 (ADR-0397) 보험.
 *
 * 호출자 wiring 정합:
 *   - sectorEnergyProvider 의 normalizeKrxSectorRows() 가 indexCode 우선 매칭에 사용
 *   - aliases 는 진단·legacy 매핑 추적용 (재매칭 SSOT 에서는 indexCode 우선)
 *   - sectorKey 는 운영자 진단 SSOT (`/sector_energy_diag` 메시지 한국어 라벨 합성)
 */

/** ADR-0399: 12 표준 섹터키 union — `displayName` 한국어 라벨과 1:1 매핑. */
export type SectorKey =
  | 'SEMICONDUCTOR'
  | 'BATTERY'
  | 'BIO_HEALTHCARE'
  | 'FINANCE'
  | 'SHIPBUILDING'
  | 'STEEL'
  | 'CHEMICAL'
  | 'CONSTRUCTION'
  | 'CONSUMER_RETAIL'
  | 'IT_INTERNET'
  | 'AUTOMOTIVE'
  | 'OTHER';

/** ADR-0399: SECTOR_INDEX_MASTER entry — 12 표준 섹터당 1 row. */
export interface SectorIndexMasterEntry {
  /** 표준 섹터키 (운영자 진단 SSOT). */
  sectorKey: SectorKey;
  /** 한국어 displayName ('반도체' / '이차전지' 등) — 텔레그램·UI 노출. */
  displayName: string;
  /** KRX 공식 indexCode — SSOT 매칭의 단일 입력. */
  krxIndexCode: string;
  /** 시장 분리 — KOSPI vs KOSDAQ 동일 이름 sub-index 의 silent overwrite 방지. */
  market: 'KOSPI' | 'KOSDAQ';
  /** legacy indexName + 동의어 — 진단·매핑 추적 전용 (매칭 SSOT 에서는 indexCode 우선). */
  aliases: string[];
  /** Yahoo ETF L4 fallback 심볼 (ADR-0397, 옵셔널). */
  yahooProxySymbol?: string;
}

// ─── SECTOR_INDEX_MASTER SSOT (12 표준 섹터, 절대 변경 금지) ──────────────────

/**
 * ADR-0399: SECTOR_INDEX_MASTER SSOT — 12 표준 섹터.
 *
 * KRX indexCode 출처: KRX 공식 시장지수/업종지수 코드. KOSPI 200 섹터지수 우선,
 * 가용하지 않은 섹터는 KOSPI 업종지수 또는 KOSDAQ 산업별지수 대체. 코드 변경 시
 * 본 매트릭스 한 곳만 수정 — 호출자 모두 자동 정합.
 *
 * 사용자 명시 12 섹터 (절대 변경 금지):
 *   반도체 / 이차전지 / 바이오 / 금융 / 조선 / 철강 / 화학 / 건설 / 유통 / IT / 자동차 / 기타
 */
export const SECTOR_INDEX_MASTER: ReadonlyArray<SectorIndexMasterEntry> = Object.freeze([
  {
    sectorKey: 'SEMICONDUCTOR',
    displayName: '반도체',
    krxIndexCode: '1KSI3030', // KRX KOSPI 200 반도체 (사용자 명시 SSOT)
    market: 'KOSPI',
    aliases: ['반도체', 'KOSPI 200 반도체', 'KRX 반도체', '전기전자', 'IT 하드웨어'],
    yahooProxySymbol: 'SOXX',
  },
  {
    sectorKey: 'BATTERY',
    displayName: '이차전지',
    krxIndexCode: '1KSI3025', // KRX KOSPI 이차전지 (가용한 가장 가까운 코드)
    market: 'KOSPI',
    aliases: ['이차전지', '2차 전지', '배터리', '전지'],
    yahooProxySymbol: 'LIT',
  },
  {
    sectorKey: 'BIO_HEALTHCARE',
    displayName: '바이오/헬스케어',
    krxIndexCode: '1KSI3020', // KRX KOSPI 200 헬스케어
    market: 'KOSPI',
    aliases: ['바이오', '헬스케어', '의약', '제약', '의료'],
    yahooProxySymbol: 'XBI',
  },
  {
    sectorKey: 'FINANCE',
    displayName: '금융',
    krxIndexCode: '1KSI3010', // KRX KOSPI 200 금융
    market: 'KOSPI',
    aliases: ['금융', '은행', '증권', '보험'],
    yahooProxySymbol: 'XLF',
  },
  {
    sectorKey: 'SHIPBUILDING',
    displayName: '조선',
    krxIndexCode: '1KSI3040', // KRX KOSPI 운수장비 (조선 포함)
    market: 'KOSPI',
    aliases: ['조선', '기계', '운수장비'],
    yahooProxySymbol: undefined, // Yahoo ETF L4 가용 미지정 (정성 분류 부재)
  },
  {
    sectorKey: 'STEEL',
    displayName: '철강',
    krxIndexCode: '1KSI3050', // KRX KOSPI 철강금속
    market: 'KOSPI',
    aliases: ['철강', '비금속', '철강금속'],
    yahooProxySymbol: 'SLX',
  },
  {
    sectorKey: 'CHEMICAL',
    displayName: '에너지/화학',
    krxIndexCode: '1KSI3060', // KRX KOSPI 화학
    market: 'KOSPI',
    aliases: ['화학', '에너지', '석유', '종이', '목재'],
    yahooProxySymbol: 'XLE',
  },
  {
    sectorKey: 'CONSTRUCTION',
    displayName: '건설/부동산',
    krxIndexCode: '1KSI3070', // KRX KOSPI 건설업
    market: 'KOSPI',
    aliases: ['건설', '부동산', '리츠', '건설업'],
    yahooProxySymbol: 'XHB',
  },
  {
    sectorKey: 'CONSUMER_RETAIL',
    displayName: '유통/소비재',
    krxIndexCode: '1KSI3080', // KRX KOSPI 유통업
    market: 'KOSPI',
    aliases: ['유통', '소비재', '음식료', '섬유', '유통업'],
    yahooProxySymbol: 'XLY',
  },
  {
    sectorKey: 'IT_INTERNET',
    displayName: '인터넷/플랫폼',
    krxIndexCode: '1KSI3035', // KRX KOSPI 서비스업 (인터넷/플랫폼 포함)
    market: 'KOSPI',
    aliases: ['인터넷', '플랫폼', '서비스업', '소프트웨어', 'S/W', '게임', '미디어'],
    yahooProxySymbol: 'XLK',
  },
  {
    sectorKey: 'AUTOMOTIVE',
    displayName: '자동차',
    krxIndexCode: '1KSI3045', // KRX KOSPI 자동차 (운수장비 sub)
    market: 'KOSPI',
    aliases: ['자동차'],
    yahooProxySymbol: 'CARZ',
  },
  {
    sectorKey: 'OTHER',
    displayName: '기타',
    krxIndexCode: '1KSI3000', // KRX KOSPI 종합 (catch-all fallback)
    market: 'KOSPI',
    aliases: ['기타', '미분류'],
    yahooProxySymbol: undefined,
  },
]);

/** SECTOR_INDEX_MASTER 의 displayName Set — sectorEnergyProvider 의 StrategicSector 검증용. */
export const KNOWN_DISPLAY_NAMES: ReadonlySet<string> = new Set(
  SECTOR_INDEX_MASTER.map((e) => e.displayName),
);

// ─── SSOT lookup 헬퍼 ────────────────────────────────────────────────────

/**
 * indexCode → SectorIndexMasterEntry 조회.
 * 정확 매칭 — indexName 단독 매칭 영구 차단 (ADR-0399 핵심 원칙 #1).
 */
export function getSectorByIndexCode(indexCode: string | null | undefined): SectorIndexMasterEntry | null {
  if (!indexCode || typeof indexCode !== 'string') return null;
  const normalized = indexCode.trim();
  if (!normalized) return null;
  return SECTOR_INDEX_MASTER.find((e) => e.krxIndexCode === normalized) ?? null;
}

/**
 * sectorKey → SectorIndexMasterEntry 조회.
 * 운영자 진단 SSOT (`/sector_energy_diag` 메시지 등).
 */
export function getSectorByKey(sectorKey: string | null | undefined): SectorIndexMasterEntry | null {
  if (!sectorKey || typeof sectorKey !== 'string') return null;
  return SECTOR_INDEX_MASTER.find((e) => e.sectorKey === sectorKey) ?? null;
}

/**
 * displayName 또는 alias → SectorIndexMasterEntry 조회.
 *
 * 진단·legacy 매핑 추적 전용 — 매칭 SSOT 에서는 indexCode 우선 사용 의무.
 * indexName 만 사용한 매칭이 default 경로가 되지 않도록 호출자가 indexCode 우선 시도 후
 * fallback 으로만 호출. 동일 alias 가 여러 entry 에 매칭되면 첫 번째 entry 반환 (정렬 정합).
 */
export function getSectorByAlias(alias: string | null | undefined): SectorIndexMasterEntry | null {
  if (!alias || typeof alias !== 'string') return null;
  const normalized = alias.trim();
  if (!normalized) return null;
  // 1) displayName 정확 매칭 우선
  const byDisplayName = SECTOR_INDEX_MASTER.find((e) => e.displayName === normalized);
  if (byDisplayName) return byDisplayName;
  // 2) aliases 배열 포함 매칭 (대소문자 무관)
  const lower = normalized.toLowerCase();
  return (
    SECTOR_INDEX_MASTER.find((e) =>
      e.aliases.some((a) => a.toLowerCase() === lower),
    ) ?? null
  );
}

/** 12 displayName 배열 (CANONICAL_SECTORS 호환 — sectorEnergyProvider 와 정합). */
export function getCanonicalDisplayNames(): string[] {
  return SECTOR_INDEX_MASTER.map((e) => e.displayName);
}

/** ADR-0399: 호출자 측 inline ENV 검사 0건 — SSOT 위임 패턴 (ADR-0185~0189 정합). */
export function isSectorEnergySourceRestorationDisabled(): boolean {
  return process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED === 'true';
}
