# ADR-0446 — SectorEnergy indexCodeCoverage Recovery Phase 2 + Sanity Violation Decomposition

## 1. 배경

ADR-0445 (PR #702) 적용 이후에도 운영 로그에서 SectorEnergy 가 다음 상태 누적:

```
[SectorEnergy] ADR-0424 indexCode backfill (17/91 rows recovered via SECTOR_INDEX_MASTER NAME_LOOKUP)
KRX IDX_IND_CD 응답 결손 의심, data-dbg fallback 가능성

[SectorEnergy] sanity-violation pct=32.67% sector=건설/부동산 bound=30%
[SectorEnergy] sanity-violation pct=56.69% sector=바이오/헬스케어 bound=30%
[safePctChange] sanity 위반 @sectorEnergy.stockVolume:454910 → 4445.27% > 1000%
[safePctChange] sanity 위반 @sectorEnergy.stockReturn:336260 → 120.87% > 90%

dataQuality: STALE / sourceTier: STOCK_DAILY / coverage: 83.3% (10/12)
indexCodeCoverage: 18.7% / missingIndexCodeCount: 74/91
fallbackUsed: STOCK_DAILY / leadershipConfidence: BLOCKED / repairStatus: PARTIAL
```

ADR-0423 가 진단 schema 자체는 도입했지만 *missingIndexCodeCount=74/91 의 row 단위
분해* + *sanity violation 구조화 진단* + *normalization 확장 alias* 부재. 운영자가
"왜 row 가 missing 인지" / "어느 sector/stock 에서 sanity violation 이 났는지" /
"backfill 효과가 있는지" 추적 불가능.

본 ADR 의 목적은 *Gate2 완화가 아니라* SectorEnergy 데이터 복구율 격상 + 진단 해상도
격상 + fallback 신뢰도 차단 유지.

## 2. 결정

SectorEnergy Recovery Phase 2 진단 인프라 도입:

1. **`SectorIndexCodeRecoveryDiagnostic` SSOT** — row 단위 missing 원인 분해 + alias
   normalization 확장 + sourceTier breakdown + recoveryStatus.
2. **`SectorEnergySanityViolationDiagnostic` SSOT** — sector pct vs stock-level
   violation 분리 + topViolatingSectors/Stocks + confidenceImpact.
3. **`/sector_energy_diag` Phase 2 + Sanity 두 섹션** + **`/scan_blockers` compact
   한 줄**.
4. **Telegram HTML 안전성** — plain text safe formatter + escapeHtml SSOT + 긴
   메시지 truncation HTML 깨짐 방지.

## 3. SectorIndexCodeMissingReason 11-value union (사용자 §1)

```ts
export type SectorIndexCodeMissingReason =
  | 'EMPTY_INDEX_NAME'                  // indexName 자체 빈 문자열 / null
  | 'UNKNOWN_INDEX_NAME'                // 매칭 0개 + alias 등록 의도 없음
  | 'ALIAS_NOT_REGISTERED'              // KRX 신규 업종명 — alias 등록 필요
  | 'AMBIGUOUS_ALIAS'                   // 후보 ≥2개 — 자동 backfill 금지
  | 'MARKET_PREFIX_MISMATCH'            // 코스피·코스닥 접두/접미 차이
  | 'NORMALIZATION_MISMATCH'            // 공백/괄호/특수문자 차이
  | 'STOCK_DAILY_ROW_NO_INDEX_SOURCE'   // STOCK_DAILY 합성 row — index 출처 없음
  | 'ETF_OR_DERIVED_ROW'                // ETF/derived row — index 부적합
  | 'CACHE_ROW_MISSING_INDEX_CODE'      // CACHE row 인데 indexCode 부재
  | 'DATA_DBG_ROW_MISSING_IDX_IND_CD'   // KRX data-dbg fallback row
  | 'UNKNOWN';                          // 분류 실패 fallback
```

## 4. SectorIndexRowSourceTier 6-value union (사용자 §3)

```ts
export type SectorIndexRowSourceTier =
  | 'KRX_CODE'      // raw KRX response 의 IDX_IND_CD 직접 제공 — RAW HIGH confidence
  | 'STOCK_DAILY'   // STOCK_DAILY synthetic fallback — leadership 금지
  | 'ETF'           // Yahoo ETF L4 fallback — leadership 금지
  | 'CACHE'         // 영속 cache — fresh 시 가능, stale 시 leadership 금지
  | 'DATA_DBG'      // KRX data-dbg fallback — IDX_IND_CD 누락 의심
  | 'UNKNOWN';
```

## 5. SectorIndexCodeRecoveryDiagnostic schema (사용자 §1)

```ts
export interface SectorIndexCodeRecoveryDiagnostic {
  totalRows: number;
  rowsWithIndexCode: number;
  rowsMissingIndexCode: number;
  beforeIndexCodeCoverage: number;          // backfill 이전
  afterIndexCodeCoverage: number;           // backfill 이후
  backfilledByNameLookup: number;           // SECTOR_INDEX_MASTER 정확 매칭
  backfilledByAliasExpansion: number;       // normalize 후 매칭
  stillMissing: number;
  missingReasonBreakdown: Record<SectorIndexCodeMissingReason, number>;
  topMissingIndexNames: Array<{
    rawName: string;
    normalizedName: string;
    count: number;
    reason: SectorIndexCodeMissingReason;
  }>;
  ambiguousAliases: Array<{ normalizedName: string; candidates: string[] }>;
  sourceTierBreakdown: Record<SectorIndexRowSourceTier, number>;
  recoveryStatus: 'RECOVERED' | 'PARTIAL' | 'STILL_STALE' | 'NOT_NEEDED';
  leadershipConfidence: 'OK' | 'DEGRADED' | 'BLOCKED';
}
```

## 6. SectorEnergySanityViolationKind 7-value union (사용자 §7)

```ts
export type SectorEnergySanityViolationKind =
  | 'SECTOR_PCT_BOUND_EXCEEDED'           // sector pct > RETURN_SANITY_BOUND_PCT (30%)
  | 'STOCK_VOLUME_PCT_CHANGE_EXCEEDED'    // stockVolume pct > 1000%
  | 'STOCK_RETURN_PCT_CHANGE_EXCEEDED'    // stockReturn pct > 90%
  | 'BASE_ZERO_OR_TINY'                   // base 0 또는 micro
  | 'CURRENT_OUTLIER'                     // current 비정상 outlier
  | 'STALE_BASELINE'                      // baseline 시점 과거
  | 'UNKNOWN';
```

## 7. SectorEnergySanityViolationDiagnostic schema (사용자 §6)

```ts
export interface SectorEnergySanityViolationDiagnostic {
  totalViolations: number;
  sectorPctViolations: number;
  stockVolumeViolations: number;
  stockReturnViolations: number;
  topViolatingSectors: Array<{ sector: string; pct: number; bound: number; count: number }>;
  topViolatingStocks: Array<{
    code: string;
    metric: 'stockVolume' | 'stockReturn';
    pct: number;
    current?: number;
    base?: number;
    reason: SectorEnergySanityViolationKind;
  }>;
  baseZeroOrTinyCount: number;
  staleBaselineCount: number;
  sourceTierBreakdown: Record<SectorIndexRowSourceTier, number>;
  confidenceImpact: 'NONE' | 'DEGRADED' | 'BLOCKED';
}
```

confidenceImpact 결정 트리 (사용자 §"진단 원칙"):
- totalViolations === 0 → NONE
- totalViolations > 0 → DEGRADED (최소)
- stockReturnViolations > 5 OR stockVolumeViolations > 5 OR baseZeroOrTinyCount > 3
  OR STOCK_DAILY fallback 우세 → BLOCKED

## 8. recoveryStatus 결정 트리 SSOT (절대 변경 금지)

```
fallbackUsed='NONE' && backfilled=0 && coverage>=0.8 && symmetry → NOT_NEEDED
fallbackUsed='NONE' && coverage>=0.8 && symmetry && backfilled>0 → RECOVERED
coverage>0 && (fallback≠NONE || !symmetry || sanity>0) → PARTIAL
그 외 → STILL_STALE
```

핵심 불변식 (사용자 §"절대 불변식"):
- fallbackUsed !== 'NONE' → RECOVERED 금지
- symmetryValidation !== PASSED → RECOVERED 금지
- indexCodeCoverage < 0.8 → RECOVERED 금지
- sanityViolationCount > 0 → RECOVERED 금지 또는 최소 DEGRADED
- STOCK_DAILY fallback → leadershipConfidence BLOCKED 또는 DEGRADED
- freshness=FRESH 단독으로 leadershipConfidence=OK 금지

## 9. leadershipConfidence 결정 트리

```
recoveryStatus='STILL_STALE' || fallbackUsed='STOCK_DAILY'/'ETF' || coverage=0 → BLOCKED
recoveryStatus='PARTIAL' || coverage<0.8 || sanity confidenceImpact!='NONE' → DEGRADED
recoveryStatus='NOT_NEEDED' || (RECOVERED && sanity NONE) → OK
```

## 10. alias normalization 확장

`getSectorByAlias` 위에 `normalizeIndexNameForLookup` 추가:
- 양쪽 공백 trim
- 다중 공백 → 단일 공백
- 괄호 `()` `[]` 내부 텍스트 제거
- 특수문자 (`·`, `·`, `/`, `,`) 제거
- 코스피/코스닥 접두/접미 제거 (`코스피`, `KOSPI`, `코스닥`, `KOSDAQ`)
- 한글-영문 혼용 정합 (대소문자 무관)

ambiguous 처리:
- 정확 1개 매칭 → backfill (NAME_LOOKUP)
- 2개+ 후보 → AMBIGUOUS_ALIAS 진단만, 자동 backfill 절대 금지
- 0개 → UNKNOWN_INDEX_NAME 또는 ALIAS_NOT_REGISTERED

## 11. ENV 우회

```
SECTOR_ENERGY_RECOVERY_PHASE2_DISABLED=true   # default OFF (ADR-0157 정확 비교)
SECTOR_ENERGY_SANITY_DIAGNOSTIC_DISABLED=true  # default OFF
```

활성 시 진단 layer 자체 skip — ADR-0445 동작 100% 복원.

## 12. 호출자 wiring 매트릭스

| 위치 | 변경 |
|------|------|
| `sectorEnergyMaster.ts` | `normalizeIndexNameForLookup` 추가 — `getSectorByAlias` 본체는 무수정 (후방호환) |
| `sectorEnergyProvider.ts` `pushDelta` | sanity violation 발생 시 진단 SSOT 에 기록 (state 주입) |
| `sectorEnergyProvider.ts` `backfillIndexCodes` | Phase 2 진단 합성 (옵셔널 호출, 후방호환) |
| `sectorEnergyQualityDiagnostic.ts` | `sectorIndexRecovery?` + `sanityViolation?` 옵셔널 필드 추가 |
| `sectorEnergyDiag.cmd.ts` | Phase 2 + Sanity 두 섹션 추가 (plain text 우선) |
| `scanBlockers.cmd.ts` | compact 한 줄 추가 |
| **LIVE 매매 본체** | **0줄 변경** (signalScanner / entryEngine / exitEngine / kisClient / orchestrator / autoTradeEngine / trancheExecutor / buyPipeline 모두) |

## 13. 운영 출력 기대값 (사용자 §"운영 출력 기대값")

`/sector_energy_diag` 패치 후:

```
🧩 SectorEnergy indexCode Recovery Phase 2
  • beforeCoverage: 18.7%
  • afterCoverage: 42.5%
  • backfilledByNameLookup: 17
  • backfilledByAliasExpansion: 21
  • stillMissing: 53
  • missingReasons:
    - ALIAS_NOT_REGISTERED: 31
    - AMBIGUOUS_ALIAS: 12
    - DATA_DBG_ROW_MISSING_IDX_IND_CD: 10
  • sourceTierBreakdown:
    - KRX_CODE: 38
    - STOCK_DAILY: 53
    - DATA_DBG: 0
  • recoveryStatus: PARTIAL
  • leadershipConfidence: BLOCKED

🧪 SectorEnergy Sanity
  • totalViolations: 31 (sectorPct 18 / stockVolume 8 / stockReturn 5)
  • topSectors:
    1. 반도체 pct=80.57% bound=30%
    2. 바이오/헬스케어 pct=56.69% bound=30%
  • confidenceImpact: BLOCKED
  • operatorAction: source mapping / baseline 점검 전 leadership 사용 금지
```

`/scan_blockers` 한 줄:
```
SectorEnergy Recovery: PARTIAL · indexCodeCoverage 18.7% · missing 74/91 · sanity 31 · fallback STOCK_DAILY · leadership BLOCKED
```

## 14. 절대 불변식 (사용자 §"절대 불변식")

1. LIVE 매매 본체 0줄 변경
2. KIS 주문 함수 5종 import 0건
3. autoTradeEngine / orderExecutor / trancheExecutor import 0건
4. Gate threshold + condition weight + STRONG_BUY + SELL_ONLY 0 변경
5. STOCK_DAILY fallback trusted leadership source 금지
6. freshness=FRESH 단독 confidence=OK 금지
7. fallbackUsed !== NONE 시 RECOVERED 금지
8. symmetryValidation FAILED 시 RECOVERED 금지
9. sanityViolationCount > 0 시 leadershipConfidence OK 금지
10. sanity violation clamp 후 OK 표시 금지
11. ambiguous alias 자동 backfill 금지
12. KIS/KRX/Yahoo/Naver outbound 빈도 0 변경

## 15. 회귀 테스트 매트릭스 (목표 45+)

상세 56 항목은 `_workspace/2026-05-08_adr0446-sector-energy-recovery-phase2/
architect/plan.md` 참조. 핵심:

- indexCode 이미 보유 → NOT_NEEDED
- 정확 1:1 backfill (NAME_LOOKUP)
- 공백/괄호/특수문자 normalization 후 매칭
- AMBIGUOUS_ALIAS 자동 backfill 차단
- UNKNOWN_INDEX_NAME / EMPTY_INDEX_NAME 분류
- DATA_DBG row IDX_IND_CD 부재 분류
- STOCK_DAILY row trusted leadership 금지
- fallbackUsed=STOCK_DAILY → RECOVERED 금지
- symmetryValidation FAILED → RECOVERED 금지
- coverage<0.8 → RECOVERED 금지
- sanityViolationCount>0 → confidenceImpact ≥ DEGRADED
- count 정확성 (backfilled / stillMissing / missingReasonBreakdown / sourceTierBreakdown)
- topMissing / topViolatingSectors / topViolatingStocks 정렬
- freshness=FRESH 단독 confidence=OK 차단
- sector pct > 30% → SECTOR_PCT_BOUND_EXCEEDED
- stockVolume > 1000% → STOCK_VOLUME_PCT_CHANGE_EXCEEDED
- stockReturn > 90% → STOCK_RETURN_PCT_CHANGE_EXCEEDED
- base 0/tiny → BASE_ZERO_OR_TINY
- ENV 정확 비교 (`'true'` 만)
- KIS 주문 함수 5종 import 0건 (정적 grep)
- Gate threshold / STRONG_BUY override / SectorEnergy scoring 변경 부재
- ADR-0423 / 0424 / 0370 무회귀
- HTML escape `<` `>` `&`

## 16. 잘못된 해결 방법 영구 차단

- Gate2 threshold 변경
- SectorEnergy weight / confidence formula 완화
- STRONG_BUY 조건 완화
- STOCK_DAILY 를 OK 로 승격 (사용자 §"절대 불변식" #5 명시)
- SELL_ONLY 해제
- autoTradeEngine 변경
- sanity violation 단순 clamp 후 OK 처리 (사용자 §"절대 불변식" #13)
- ambiguous alias 자동 backfill (사용자 §10)
- raw KRX response body 전체 영속 (ADR-0445 정합)
- ADR-0423 / 0424 schema 의 본체 변경 (옵셔널 필드 추가만 허용)

## 17. 잔여 후속 PR (scope 외)

- SECTOR_INDEX_MASTER 신규 alias 등록 (운영 데이터 누적 후 — `topMissingIndexNames`
  분포 기반)
- KRX data-dbg fallback 자체 차단 (KRX OpenAPI 측 이슈, 별도 ADR)
- STOCK_DAILY synthetic 입력 trusted source 도입 검토 (현재 절대 금지, 별도 ADR)
- LAST_GOOD_STALE 임계 (ADR-0445 14일) ENV 화 (운영 데이터 후 재조정)
