/**
 * @responsibility 워치리스트 sector alias → SectorKey 12-표준 carry payload SSOT — Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 diagnostic-only path.
 *
 * Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 — 사용자 직접 명시 framing 정합:
 *
 *   "프로그램 수급/시장 프로그램 매매/섹터/섹터에너지 부분을 좀 더 잘 적용해야하는데
 *    데이터 와이어링을 정밀하게 해줘"
 *
 *   우선순위 #3 — 섹터 분류 carry wiring (Option A: separate PR + ENV default OFF +
 *   LIVE body 0-line + 기존 endpoint만 사용 + 회귀 ≥20).
 *
 * Phase 1 audit 결과:
 *
 *   • Producer SSOT (`server/clients/sectorEnergyMaster.ts` ADR-0399) 는 12 표준 SectorKey
 *     union + SECTOR_INDEX_MASTER Object.freeze 12-entry array + getSectorByAlias()
 *     reverse lookup (displayName 우선 + aliases 배열 fallback) 모두 정상 작동.
 *   • Watchlist entries (`watchlistRepo.ts:316`) 는 `sector?: string` Korean displayName
 *     필드 영속 (sector map updater 가 채움 — ADR-0060 PR-Z1 정합).
 *   • Consumer 측 normalSupplyPreview 본체는 candidate 의 sectorClassification 필드를
 *     아직 read 하지 않음 — 본 PR 은 *carry wiring 만* (read-ready 상태 정착).
 *   • 후속 PR 에서 normalSupplyPreview / Gate evaluation / supply forensic 등이 본
 *     carry payload 를 자연 consumer 로 활용 (CandidateWithSupplyContext 의 Record
 *     extension pattern 정합).
 *
 * 본 SSOT 는 watchlist entries 의 sector alias 를 SectorKey 12-표준으로 정규화 + 종목별
 * carry payload 합성 — 호출자 측 inline lookup / 부분 carry / 직접 SECTOR_INDEX_MASTER
 * import 의 drift 위험 영구 차단.
 *
 * 절대 invariants (사용자 명시 직접 인용 verbatim — 절대 변경 금지):
 *
 *   • diagnostic-only carry — LIVE 매매 의사결정 입력 절대 금지
 *     (executionImpact: 'NONE' / providerIssue: false / marketSignal: false literal
 *     type 컴파일 타임 강제)
 *   • SectorEnergy 진단 BLOCKED 상태가 매수 차단 신호 변환 금지 (ADR-0448 정합 —
 *     일반 BUY 차단 0, STRONG_BUY 만 차단)
 *   • indexName 단독 매칭 영구 차단 (ADR-0370/0399 정합 — sectorEnergyMaster 의
 *     `getSectorByAlias` 가 displayName 정확 매칭 우선 + aliases 매칭 fallback)
 *   • SECTOR_INDEX_MASTER 12 표준 섹터 등재 무수정 (사용자 명시 절대 변경 금지)
 *   • ENV 정확 비교 의무 (ADR-0157) — `=== 'true'` 만, `'TRUE'` / `'1'` / `'yes'` 거부
 *   • 호출자 측 inline `process.env.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED`
 *     검사 0건 (`isSectorClassificationCarryWiringDisabled()` SSOT 위임 의무)
 *   • LIVE 매매 본체 0줄 변경 — `signalScanner.ts` / `signalScanner/perSymbol*` /
 *     `signalScanner/preflight.ts` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` /
 *     `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` / `buyPipeline.ts`
 *     모두 0줄 (normalSupplyPreviewRunner.ts 의 1 wiring 블록만 — diagnostic-only path)
 *   • KIS/KRX/Yahoo/Naver outbound 0건 추가 (watchlist read-only consumer 만 —
 *     `sectorEnergyMaster` 는 정적 SSOT, sector map updater 가 별도 cron 으로 채움)
 *   • ENV `SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED=true` 1줄 즉시 legacy 100% 복원
 *     (default OFF — 현행 동작 보존이 default)
 *   • ADR 발급 0건 (patch type), INDEX.md 갱신 0건
 *
 * 잘못된 해결 방법 영구 차단:
 *
 *   • 호출자 측 inline `process.env` 검사 (SSOT 위임 의무)
 *   • 호출자 측 직접 `SECTOR_INDEX_MASTER` import + 인라인 lookup (SSOT 위임 의무 — drift
 *     차단)
 *   • `sectorClassification` 결과를 매매 의사결정 입력 (literal type 컴파일 타임 차단)
 *   • `sectorEnergyMaster.ts` 본체 변경 (read-only consumer 의무)
 *   • `SECTOR_INDEX_MASTER` 12 표준 섹터 외 추가 (사용자 명시 절대 변경 금지 — 새 섹터는
 *     별도 ADR + sector map updater 갱신 + Yahoo proxy 등 동시 의무)
 *   • indexName 단독 매칭 (ADR-0370/0399 위반 — `getSectorByAlias` 가 displayName 정확
 *     매칭 우선이라 자연 차단되지만 본 SSOT 도 fallback 매칭에서 partial substring 매칭
 *     금지)
 *   • 신규 외부 API 호출 (watchlist read-only 만 — KIS/KRX/Yahoo/Naver outbound 0)
 *   • ENV default ON (운영 회귀 안전망 — default OFF 의무)
 *   • SectorEnergy 진단 BLOCKED → 매수 차단 변환 (ADR-0448 위반 — 일반 BUY 차단 0)
 */

import {
  getSectorByAlias,
  type SectorIndexMasterEntry,
  type SectorKey,
} from '../../clients/sectorEnergyMaster.js';

/**
 * Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 — SSOT ENV gate (ADR-0157 정확 비교).
 *
 * default OFF — 현행 동작 100% 보존이 default. 운영 회귀 발견 시
 * `SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED=true` 1줄 즉시 legacy 동작 복원.
 *
 * ADR-0157 정합 — `=== 'true'` 만 비활성. `'TRUE'` / `'1'` / `'yes'` 모두 거부 (오타
 * 또는 다른 환경의 boolean 표기 우회 차단).
 */
export function isSectorClassificationCarryWiringDisabled(): boolean {
  return process.env.SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED === 'true';
}

/**
 * Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 — sourceTier SSOT.
 *
 *   • WATCHLIST_ALIAS — watchlist entry 의 sector 필드를 alias 로 사용해
 *     `getSectorByAlias()` 매칭 성공 (정상 경로).
 *   • OTHER_FALLBACK — sector 필드 부재 또는 매칭 실패 시 OTHER 섹터로 분류
 *     (12 표준 외 신규 섹터는 발급되지 않음 — sectorEnergyMaster 정합).
 */
type SectorClassificationSourceTier = 'WATCHLIST_ALIAS' | 'OTHER_FALLBACK';

/**
 * Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 — caller-facing carry payload.
 *
 * `injected.candidates` 의 각 candidate 에 `sectorClassification?` 옵셔널 필드로
 * 첨부. literal type 3 필드 (`executionImpact: 'NONE'` / `providerIssue: false` /
 * `marketSignal: false`) 는 TypeScript 컴파일 타임에 호출자 측 invariant 위반 즉시
 * fail — `sectorClassification` 결과가 매매 의사결정 입력으로 변환되는 것 영구 차단.
 */
export interface SectorClassificationCarryPayload {
  /** 종목코드 6자리 (대문자 zero-pad 정규화). */
  readonly stockCode: string;
  /** 표준 SectorKey 12-value union (`sectorEnergyMaster.SectorKey` SSOT). */
  readonly sectorKey: SectorKey;
  /** 한국어 displayName ('반도체' / '이차전지' 등 — 텔레그램/UI 노출 용). */
  readonly displayName: string;
  /** 시장 분리 — KOSPI vs KOSDAQ 동일 이름 sub-index 의 silent overwrite 방지. */
  readonly market: 'KOSPI' | 'KOSDAQ';
  /** KRX 공식 indexCode — SSOT 매칭의 단일 입력 (sectorEnergyMaster 정합). */
  readonly krxIndexCode: string;
  /** Yahoo ETF L4 fallback 심볼 (ADR-0397, 옵셔널). */
  readonly yahooProxySymbol?: string;
  /** sourceTier — watchlist alias 매칭 vs OTHER fallback. */
  readonly sourceTier: SectorClassificationSourceTier;
  /** 원본 watchlist sector alias (진단 추적 전용 — read-only). */
  readonly rawAlias?: string;
  /** literal type 컴파일 타임 강제 — 매매 결정 입력 영구 차단 (ADR-0451 정합). */
  readonly executionImpact: 'NONE';
  /** literal type — DATA_UNAVAILABLE != providerIssue (ADR-0416/0421 정합). */
  readonly providerIssue: false;
  /** literal type — sector 분류는 bearish 변환 금지 (사용자 명시). */
  readonly marketSignal: false;
}

/**
 * Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 — sanitize 6자리 stockCode.
 *
 * input → 정규화 → 6자리 zero-pad string 또는 null. 비유한 입력은 모두 null fallback
 * (silent skip — 매매 흐름 차단 0).
 */
function normalizeStockCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // 1~6자리 숫자만이면 6자리 zero-pad (KRX 표준)
  if (/^\d{1,6}$/.test(trimmed)) return trimmed.padStart(6, '0');
  // 그 외 (예: 'AAPL') 는 그대로 반환 — KRX 6자리 정규화 대상 아님
  return trimmed;
}

/**
 * Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 — sanitize alias string.
 *
 * 입력 trim + 빈 문자열 거부. 비-string / null / undefined 모두 undefined fallback.
 */
function sanitizeAlias(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

/**
 * Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 — single entry → carry payload.
 *
 * 결정 트리 (사용자 명시 절대 변경 금지):
 *   1. ENV `SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED === 'true'` → undefined
 *      (호출자가 `sectorClassification` 인자를 자연스럽게 미전달 처리)
 *   2. stockCode 정규화 실패 → undefined (silent skip)
 *   3. sector alias 부재 → OTHER_FALLBACK sourceTier 로 payload 합성 (OTHER 섹터 분류)
 *   4. sector alias 존재 + `getSectorByAlias()` 매칭 성공 → WATCHLIST_ALIAS sourceTier
 *   5. sector alias 존재 + `getSectorByAlias()` 매칭 실패 → OTHER_FALLBACK sourceTier
 *
 * SectorEnergyMaster 의 12-표준 SectorKey 외 신규 분류 발급 금지 — 모든 unknown alias
 * 는 OTHER 로 안전 fallback.
 */
export function buildSectorClassificationCarryPayload(input: {
  stockCode: unknown;
  sectorAlias?: unknown;
}): SectorClassificationCarryPayload | undefined {
  if (isSectorClassificationCarryWiringDisabled()) return undefined;
  const stockCode = normalizeStockCode(input.stockCode);
  if (!stockCode) return undefined;

  const alias = sanitizeAlias(input.sectorAlias);

  let entry: SectorIndexMasterEntry | null = null;
  let sourceTier: SectorClassificationSourceTier = 'OTHER_FALLBACK';

  if (alias) {
    const matched = getSectorByAlias(alias);
    if (matched) {
      entry = matched;
      sourceTier = 'WATCHLIST_ALIAS';
    }
  }

  // OTHER_FALLBACK 분기 — sector alias 부재 또는 매칭 실패.
  // SECTOR_INDEX_MASTER 마지막 entry 가 OTHER 라는 가정 없이, getSectorByAlias('기타') /
  // sectorKey='OTHER' 로 명시적 fallback.
  if (!entry) {
    const otherEntry = getSectorByAlias('기타');
    if (!otherEntry) {
      // sectorEnergyMaster 가 OTHER entry 를 가지지 않은 경우 (sanity guard) —
      // payload 합성 불가, undefined 반환 (호출자가 자연스럽게 skip).
      return undefined;
    }
    entry = otherEntry;
    sourceTier = 'OTHER_FALLBACK';
  }

  return {
    stockCode,
    sectorKey: entry.sectorKey,
    displayName: entry.displayName,
    market: entry.market,
    krxIndexCode: entry.krxIndexCode,
    yahooProxySymbol: entry.yahooProxySymbol,
    sourceTier,
    rawAlias: alias,
    executionImpact: 'NONE',
    providerIssue: false,
    marketSignal: false,
  };
}

/**
 * Patch-SECTOR-CLASSIFICATION-CARRY-WIRING-001 — watchlist entries → symbol-keyed Map.
 *
 * 호출자 (`normalSupplyPreviewRunner.ts`) 가 `loadWatchlist()` 1회 호출 후 본 SSOT 로
 * Map 합성 → `injected.candidates` 순회 시 O(1) symbol lookup 으로 첨부.
 *
 * ENV `SECTOR_CLASSIFICATION_CARRY_WIRING_DISABLED=true` 시 빈 Map 반환 —
 * 호출자 측 자연스러운 단락 (Map.get() 항상 undefined → continue).
 *
 * sector 필드 부재 entry 도 OTHER_FALLBACK 으로 payload 합성 (운영자 진단 정합 — 모든
 * 후보가 sectorClassification 부착, OTHER vs WATCHLIST_ALIAS sourceTier 로 식별).
 */
export function buildSectorClassificationCarryMap(
  entries:
    | ReadonlyArray<{ code?: string; sector?: string }>
    | null
    | undefined,
): Map<string, SectorClassificationCarryPayload> {
  const map = new Map<string, SectorClassificationCarryPayload>();
  if (isSectorClassificationCarryWiringDisabled()) return map;
  if (!entries || !Array.isArray(entries)) return map;
  for (const entry of entries) {
    const payload = buildSectorClassificationCarryPayload({
      stockCode: entry?.code,
      sectorAlias: entry?.sector,
    });
    if (payload) map.set(payload.stockCode, payload);
  }
  return map;
}
