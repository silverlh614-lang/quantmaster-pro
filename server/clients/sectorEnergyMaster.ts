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
    aliases: [
      '바이오',
      '헬스케어',
      '의약',
      '제약',
      '의료',
      // ★ ADR-0447 신규
      '의약품',
      '제약업종',
    ],
    yahooProxySymbol: 'XBI',
  },
  {
    sectorKey: 'FINANCE',
    displayName: '금융',
    krxIndexCode: '1KSI3010', // KRX KOSPI 200 금융
    market: 'KOSPI',
    aliases: [
      '금융',
      '은행',
      '증권',
      '보험',
      // ★ ADR-0447 신규
      '은행업종',
      '증권업종',
      '보험업종',
      '금융업종',
    ],
    yahooProxySymbol: 'XLF',
  },
  {
    sectorKey: 'SHIPBUILDING',
    displayName: '조선',
    krxIndexCode: '1KSI3040', // KRX KOSPI 운수장비 (조선 포함)
    market: 'KOSPI',
    aliases: [
      '조선',
      '기계',
      '운수장비',
      // ★ ADR-0447 신규
      '운수장비업종',
      '기계업종',
    ],
    yahooProxySymbol: undefined, // Yahoo ETF L4 가용 미지정 (정성 분류 부재)
  },
  {
    sectorKey: 'STEEL',
    displayName: '철강',
    krxIndexCode: '1KSI3050', // KRX KOSPI 철강금속
    market: 'KOSPI',
    aliases: [
      '철강',
      '비금속',
      '철강금속',
      // ★ ADR-0447 신규
      '금속',
      '비금속광물',
      '철강금속업종',
    ],
    yahooProxySymbol: 'SLX',
  },
  {
    sectorKey: 'CHEMICAL',
    displayName: '에너지/화학',
    krxIndexCode: '1KSI3060', // KRX KOSPI 화학
    market: 'KOSPI',
    aliases: [
      '화학',
      '에너지',
      '석유',
      '종이',
      '목재',
      // ★ ADR-0447 신규
      '종이·목재',
      '종이목재',
      '에너지화학',
      '석유화학',
    ],
    yahooProxySymbol: 'XLE',
  },
  {
    sectorKey: 'CONSTRUCTION',
    displayName: '건설/부동산',
    krxIndexCode: '1KSI3070', // KRX KOSPI 건설업
    market: 'KOSPI',
    aliases: [
      '건설',
      '부동산',
      '리츠',
      '건설업',
      // ★ ADR-0447 신규
      '건설업종',
    ],
    yahooProxySymbol: 'XHB',
  },
  {
    sectorKey: 'CONSUMER_RETAIL',
    displayName: '유통/소비재',
    krxIndexCode: '1KSI3080', // KRX KOSPI 유통업
    market: 'KOSPI',
    aliases: [
      '유통',
      '소비재',
      '음식료',
      '섬유',
      '유통업',
      // ★ ADR-0447 신규
      '음식료·담배',
      '음식료품',
      '섬유·의류',
      '섬유의복',
      '유통업종',
    ],
    yahooProxySymbol: 'XLY',
  },
  {
    sectorKey: 'IT_INTERNET',
    displayName: '인터넷/플랫폼',
    krxIndexCode: '1KSI3035', // KRX KOSPI 서비스업 (인터넷/플랫폼 포함)
    market: 'KOSPI',
    aliases: [
      '인터넷',
      '플랫폼',
      '서비스업',
      '소프트웨어',
      'S/W',
      '게임',
      '미디어',
      // ★ ADR-0447 신규
      '통신업',
      '정보기술',
      'IT업종',
    ],
    yahooProxySymbol: 'XLK',
  },
  {
    sectorKey: 'AUTOMOTIVE',
    displayName: '자동차',
    krxIndexCode: '1KSI3045', // KRX KOSPI 자동차 (운수장비 sub)
    market: 'KOSPI',
    aliases: [
      '자동차',
      // ★ ADR-0447 신규
      '자동차부품',
    ],
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

// ─── ADR-0424: indexName → indexCode 역변환 SSOT (이름 기반 backfill 전용) ─────

/**
 * ADR-0424: SectorEnergy indexCode 백필 출처 분류 SSOT.
 *
 * `RAW`             — KRX OpenAPI 가 직접 IDX_IND_CD 제공 (HIGH confidence, default 경로).
 * `NAME_LOOKUP`     — KRX 가 indexName 만 제공 + SECTOR_INDEX_MASTER alias 매칭으로 backfill
 *                     (HIGH confidence — KRX 공식 매핑이고 표준 이름과 1:1).
 * `STOCK_DAILY_DERIVED` — STOCK_DAILY fallback 입력에서 sectorName 매칭으로 backfill
 *                         (LOW confidence — synthetic 입력이라 leadership confidence 격하 의무).
 *
 * 핵심 불변식 (사용자 §C 정합):
 *   - STATIC_MAP / NAME_LOOKUP backfill 은 *coverage 격상 효과만* — sourceTier 변경 0.
 *   - sourceTier='STOCK_DAILY' 시 ADR-0423 결정 트리 §C-5 가 dataQuality=PARTIAL 강제 → leadership BLOCKED 유지.
 *   - 정상 KRX_CODE 경로에서 indexName 만 있는 row 도 NAME_LOOKUP 으로 회복 시 *fallback 미발생*.
 */
export type IndexCodeSource = 'RAW' | 'NAME_LOOKUP' | 'STOCK_DAILY_DERIVED';

/**
 * ADR-0424: indexName 기반 SECTOR_INDEX_MASTER 역변환 SSOT.
 *
 * 동작: `getSectorByAlias(indexName)` 위임 (displayName 정확 매칭 우선 → aliases 부분 매칭).
 * KRX 가 indexName 만 제공하고 IDX_IND_CD 가 비어있는 운영 시나리오 (ADR-0365 data-dbg fallback)
 * 에서 *KRX 공식 표준 이름 → indexCode 변환* 으로 재구성.
 *
 * 빈/공백/null/undefined → null. 대소문자 무관.
 *
 * 외부 부작용 0 (순수 함수). 외부 호출 0건.
 *
 * 사용자 §C 정합:
 *   - 본 helper 는 *NAME_LOOKUP HIGH confidence backfill* 에만 사용.
 *   - STOCK_DAILY 같은 synthetic 입력 backfill 은 별도 source 표시 의무 (`STOCK_DAILY_DERIVED`).
 */
export function resolveIndexCodeBySectorName(
  indexName: string | null | undefined,
): string | null {
  if (!indexName || typeof indexName !== 'string') return null;
  const entry = getSectorByAlias(indexName);
  return entry ? entry.krxIndexCode : null;
}

// ─── ENV gate (호출자 측 inline 검사 0건 — SSOT 위임) ─────────────────────────────

/**
 * ADR-0424: indexCode 백필 비활성 ENV (default OFF).
 *
 * 활성 시: provider 가 backfill 을 수행하지 않고 raw KRX 응답 그대로 처리 → 회귀 1줄 즉시 롤백.
 * 정확 비교 (`=== 'true'`) — ADR-0157 의무 정합.
 */
export function isSectorIndexCodeBackfillDisabled(): boolean {
  return process.env.SECTOR_INDEX_CODE_BACKFILL_DISABLED === 'true';
}

/** ADR-0399: 호출자 측 inline ENV 검사 0건 — SSOT 위임 패턴 (ADR-0185~0189 정합). */
export function isSectorEnergySourceRestorationDisabled(): boolean {
  return process.env.SECTOR_ENERGY_SOURCE_RESTORATION_DISABLED === 'true';
}
