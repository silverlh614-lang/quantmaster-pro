# ADR-0447 — SectorEnergy Alias Registry Expansion + Non-Sector Aggregate Row Filtering

## 1. 배경

ADR-0446 (PR #703 머지, sha `9ad8adc`) 이 SectorEnergy Recovery Phase 2 진단 + Sanity Violation Decomposition 인프라를 도입했지만, 적용 후 운영 진단에서 다음 잔존 결함 누적:

```
ALIAS_NOT_REGISTERED:        140
UNKNOWN sourceTier:          148
EMPTY_INDEX_NAME:              8   (예: "코스피 (외국주포함)")
indexCodeCoverage:           낮음 유지
recoveryStatus:              PARTIAL / STILL_STALE
leadershipConfidence:        BLOCKED / DEGRADED
```

근본 원인 3종:

1. **SECTOR_INDEX_MASTER alias 부족** — KRX 가 표기하는 업종명 변형 (`음식료·담배` / `섬유·의류` / `종이·목재` / `금속` 등) 이 12 표준 섹터 entry 의 `aliases` 배열에 미등록 → `expandAliasCandidates(normalized)` 매칭 0건 → `ALIAS_NOT_REGISTERED` 누적.
2. **`normalizeIndexNameForLookup` 단계 부족** — 중점 문자(`·`, `ㆍ`, `/`, `-`), 전각·반각, "업종" 접미, KOSPI·KOSDAQ prefix·suffix 처리 미흡 → 같은 의미의 KRX 변형 표기가 다른 normalized 키로 분리 → alias 매칭 실패.
3. **`NON_SECTOR_AGGREGATE_ROW` 분리 부재** — `"코스피 (외국주포함)"` / `"전체"` / `"합계"` / `"시장전체"` 같은 시장 종합 row 가 `EMPTY_INDEX_NAME` 또는 `ALIAS_NOT_REGISTERED` 로 잘못 묶이거나 sector alias 등록 candidate 로 잘못 분류 → 운영자가 *진짜 섹터 alias 결손* vs *비섹터 aggregate row* 구분 불가능.

ADR-0446 의 §"잔여 후속 PR" 명시 *"alias 등록 확장 (SECTOR_INDEX_MASTER 본체 갱신 별도 PR scope)"* 가 본 ADR 의 진입점.

## 2. 결정

SectorEnergy Recovery Phase 3 — 4 축 격상:

1. **SECTOR_INDEX_MASTER alias 확장** — KRX 업종명 변형을 12 표준 섹터 entry 의 `aliases` 배열에 추가 (정확 1:1 매핑만, 다중 후보 ambiguous 자동 차단).
2. **`normalizeIndexNameForLookup` 강화** — 10 단계 normalize 매트릭스 (중점 문자 / 전각·반각 / 한글 축약 / "업종" suffix / KOSPI·KOSDAQ prefix·suffix).
3. **`NON_SECTOR_AGGREGATE_ROW` 12-value union 격상** — 시장 종합 row 분리 (sector alias 등록 절대 금지).
4. **Schema 격상** — `aliasExpansionRecovered` / `nonSectorAggregateIgnored` / `topRecoveredAliases` 옵셔널 필드 추가 (후방호환).
5. **UI 격상** — `/sector_energy_diag` 🧩 Alias Expansion 섹션 + `/scan_blockers` compact 한 줄.

본 ADR 의 목적은 *Gate threshold 완화 0* + *KRX 응답 schema 변경 추정 0* + *외부 API 신규 호출 0* + 데이터 복구율 격상 + 진단 해상도 격상 + fallback 신뢰도 차단 보존.

## 3. 12-value union 매트릭스 (NON_SECTOR_AGGREGATE_ROW 신규)

```ts
export type SectorIndexCodeMissingReason =
  | 'EMPTY_INDEX_NAME'                  // indexName 자체 빈 문자열 / null
  | 'NON_SECTOR_AGGREGATE_ROW'          // ★ 신규 — 시장 종합 row (코스피/코스닥/전체/합계)
  | 'UNKNOWN_INDEX_NAME'                // 매칭 0개 + alias 등록 의도 없음
  | 'ALIAS_NOT_REGISTERED'              // KRX 신규 업종명 — alias 등록 필요
  | 'AMBIGUOUS_ALIAS'                   // 후보 ≥2개 — 자동 backfill 금지
  | 'MARKET_PREFIX_MISMATCH'            // 코스피·코스닥 접두/접미 차이
  | 'NORMALIZATION_MISMATCH'            // 공백/괄호/특수문자 차이
  | 'STOCK_DAILY_ROW_NO_INDEX_SOURCE'
  | 'ETF_OR_DERIVED_ROW'
  | 'CACHE_ROW_MISSING_INDEX_CODE'
  | 'DATA_DBG_ROW_MISSING_IDX_IND_CD'
  | 'UNKNOWN';
```

ADR-0446 의 11-value union 위에 `NON_SECTOR_AGGREGATE_ROW` 1종 추가 (12-value).

## 4. NON_SECTOR_AGGREGATE_ROW 매칭 규칙 (사용자 §"NON_SECTOR_AGGREGATE_ROW" 정합)

`isNonSectorAggregateRow(rawIndexName)` SSOT 헬퍼 — 다음 키워드 중 하나라도 정확 매칭 시 `true`:

```
NON_SECTOR_AGGREGATE_KEYWORDS = [
  '코스피',          // 단독 — '코스피 (외국주포함)' 도 매칭
  '코스닥',          // 단독
  '전체',            // 단독 또는 '시장전체'
  '합계',
  '시장전체',
  '외국주포함',      // 코스피 변형
  'KOSPI',           // 영문 단독
  'KOSDAQ',          // 영문 단독
  'ALL',             // 영문 전체
];
```

매칭 알고리즘 SSOT (절대 변경 금지):

1. `rawIndexName` 을 `normalizeForAggregateCheck(name)` 로 1차 정규화 (괄호 strip + 공백 strip + lower-case).
2. 키워드 set 에 정확 매칭 → `true`.
3. **부분 매칭 — 단어 경계 단위만**: `KOSPI` 가 `KOSPI200` 안에 부분 매칭 영구 차단 (단어 경계 검증 의무).
4. *섹터 분류 가능* 한 alias 와 충돌 시 sector 우선 (예: `코스피 200 반도체` → `반도체` alias 매칭 우선, aggregate 아님).

분류 결과 → `NON_SECTOR_AGGREGATE_ROW` reason + `nonSectorAggregateIgnored` counter 증가 + `ALIAS_NOT_REGISTERED` 분류 차단 (사용자 §"잘못된 해결 방법" — aggregate row 를 OTHER 섹터로 강제 분류 금지).

## 5. SECTOR_INDEX_MASTER alias 확장 (사용자 §"alias 확장 후보")

12 표준 섹터 entry 중 **alias 추가만** (sectorKey / displayName / krxIndexCode / market / yahooProxySymbol 변경 0건). 정확 1:1 매핑만 등록 — 다중 sector 매칭 가능한 모호 alias 등록 영구 차단:

| sectorKey | displayName | 신규 alias |
|---|---|---|
| `CONSUMER_RETAIL` | 유통/소비재 | `음식료·담배` / `음식료품` / `섬유·의류` / `섬유의복` / `유통업종` |
| `CHEMICAL` | 에너지/화학 | `종이·목재` / `종이목재` / `에너지화학` / `석유화학` |
| `STEEL` | 철강 | `금속` / `비금속광물` / `철강금속업종` |
| `IT_INTERNET` | 인터넷/플랫폼 | `통신업` / `정보기술` / `IT업종` |
| `BIO_HEALTHCARE` | 바이오/헬스케어 | `의약품` / `제약업종` |
| `FINANCE` | 금융 | `은행업종` / `증권업종` / `보험업종` / `금융업종` |
| `CONSTRUCTION` | 건설/부동산 | `건설업종` |
| `SHIPBUILDING` | 조선 | `운수장비업종` / `기계업종` |
| `AUTOMOTIVE` | 자동차 | `자동차부품` |
| `BATTERY` | 이차전지 | (변경 없음 — 기존 alias 충분) |
| `SEMICONDUCTOR` | 반도체 | (변경 없음 — 기존 alias 충분) |
| `OTHER` | 기타 | (변경 없음 — catch-all 외 추가 alias 영구 금지) |

**ambiguous 검증 의무** — 신규 alias 등록 후 회귀 테스트가 *모든 alias × normalized form* 에 대해 정확 1개 entry 만 매칭하는지 자동 검증. 다중 매칭 시 등록 reject + ADR §"잘못된 해결 방법" 위반.

## 6. normalizeIndexNameForLookup 강화 매트릭스 (10 단계, 사용자 §10 정합)

ADR-0446 의 6 단계 → 10 단계로 확장:

| 단계 | 입력 예시 | 출력 |
|---|---|---|
| 1. trim 양쪽 공백 | `"  반도체  "` | `"반도체"` |
| 2. 다중 공백 → 단일 공백 | `"음식료  담배"` | `"음식료 담배"` |
| 3. 괄호 내부 + 괄호 자체 제거 | `"코스피 (외국주포함)"` | `"코스피 "` |
| 4. **중점 문자 → 공백** (`·` `ㆍ` `/` `-`) | `"음식료·담배"` | `"음식료 담배"` |
| 5. **전각·반각 통일** (전각 영문/숫자 → 반각, 전각 공백 → 반각) | `"KOSPI 200"` (전각) | `"KOSPI 200"` (반각) |
| 6. 특수문자 (`,` `&`) → 공백 | `"음식료,담배"` | `"음식료 담배"` |
| 7. KOSPI·KOSDAQ prefix·suffix 제거 | `"코스피 반도체"` | `" 반도체"` |
| 8. **"업종" suffix 제거** (단어 경계) | `"섬유의복업종"` | `"섬유의복"` |
| 9. 다중 공백 → 단일 공백 (재 trim) | `"  반도체  "` | `"반도체"` |
| 10. lower-case 변환 | `"KOSPI 200"` | `"kospi 200"` (단계 7 에서 KOSPI 제거됨, "200" 만 남거나 빈 문자열) |

**핵심 입력 → 출력 예시 (운영 검증용)**:

```
"코스피 (외국주포함)"      → ""               → NON_SECTOR_AGGREGATE_ROW
"음식료·담배"             → "음식료 담배"     → CONSUMER_RETAIL alias 매칭
"섬유·의류"               → "섬유 의류"      → CONSUMER_RETAIL alias 매칭
"종이·목재"               → "종이 목재"      → CHEMICAL alias 매칭
"섬유의복업종"            → "섬유의복"        → CONSUMER_RETAIL alias 매칭
"코스피 200 반도체"       → "200 반도체"     → SEMICONDUCTOR alias 매칭
"KOSPI"                  → ""               → NON_SECTOR_AGGREGATE_ROW
"전체"                    → "전체"           → NON_SECTOR_AGGREGATE_ROW
```

## 7. classifyMissingReason 결정 트리 갱신

ADR-0446 결정 트리 위에 NON_SECTOR_AGGREGATE_ROW 분기 *EMPTY_INDEX_NAME 직후 + ALIAS_NOT_REGISTERED 보다 우선* 위치 (절대 변경 금지):

```
1. row.rowSourceTier='STOCK_DAILY' → STOCK_DAILY_ROW_NO_INDEX_SOURCE
2. row.rowSourceTier='ETF' → ETF_OR_DERIVED_ROW
3. row.rowSourceTier='CACHE' → CACHE_ROW_MISSING_INDEX_CODE
4. row.rowSourceTier='DATA_DBG' → DATA_DBG_ROW_MISSING_IDX_IND_CD
5. indexName empty/null → EMPTY_INDEX_NAME
6. ★ isNonSectorAggregateRow(indexName) → NON_SECTOR_AGGREGATE_ROW (신규)
7. expandAliasCandidates(normalized).length >= 2 → AMBIGUOUS_ALIAS
8. expandAliasCandidates(normalized).length === 0 → ALIAS_NOT_REGISTERED
9. (정상은 backfilledByAliasExpansion 으로 분류) → NORMALIZATION_MISMATCH
```

위치가 EMPTY 다음 + ALIAS_NOT_REGISTERED 보다 우선이라야 `"코스피 (외국주포함)"` 같이 단계 3 (괄호 strip) 후 `"코스피 "` 가 되어 단계 7 (KOSPI prefix 제거) 거치면 빈 문자열이 되는 케이스를 NON_SECTOR_AGGREGATE_ROW 로 정확히 분류.

## 8. Schema 확장 — `SectorIndexCodeRecoveryDiagnostic` (사용자 §"Schema 확장")

ADR-0446 schema 위에 옵셔널 후방호환 필드 3종 추가:

```ts
export interface SectorIndexCodeRecoveryDiagnostic {
  // ... ADR-0446 필드 (변경 0)

  /** 본 ADR-0447 alias 확장으로 backfill 된 row 수. */
  aliasExpansionRecovered?: number;

  /** 본 ADR-0447 aggregate row 자동 분리 카운트. */
  nonSectorAggregateIgnored?: number;

  /** 본 ADR-0447 alias 확장으로 새로 매칭된 alias Top N. */
  topRecoveredAliases?: Array<{
    indexName: string;       // KRX 가 보낸 raw indexName
    normalizedName: string;  // normalize 결과
    sectorKey: string;       // 매칭된 SECTOR_INDEX_MASTER entry
    displayName: string;
    count: number;           // 본 build 에서 매칭 횟수
  }>;
}
```

영속 schema (`macroStateRepo.sectorEnergyQualityDiagnostic`) 도 동일 옵셔널 후방호환 추가 — 기존 영속 데이터 무수정.

## 9. UI 격상

### 9.1 `/sector_energy_diag` — 🧩 Alias Expansion 섹션 추가

`formatPhase2RecoverySection` 출력에 신규 섹션 추가:

```
🧩 SectorEnergy Alias Expansion (ADR-0447)
  • aliasExpansionRecovered: N
  • nonSectorAggregateIgnored: M
  • topRecoveredAliases:
    1. "음식료·담배" → CONSUMER_RETAIL (유통/소비재) x3
    2. "섬유·의류" → CONSUMER_RETAIL (유통/소비재) x2
    3. "종이·목재" → CHEMICAL (에너지/화학) x2
    4. "섬유의복업종" → CONSUMER_RETAIL (유통/소비재) x1
    5. "금속" → STEEL (철강) x1
```

`escapePhase2Html` SSOT 위임 (HTML 안전성 보존, ADR-0446 정합).

### 9.2 `/scan_blockers` compact 한 줄 격상

기존 한 줄에 `aliasExpansion` + `aggregateIgnored` 추가:

```
🧩 SectorEnergy Alias: recovered 5 · aggregateIgnored 8 · aliasMissing 12 · confidence BLOCKED
```

`aliasMissing` = `ALIAS_NOT_REGISTERED + AMBIGUOUS_ALIAS + UNKNOWN_INDEX_NAME` 합산. confidence 는 ADR-0446 leadershipConfidence 그대로.

## 10. ENV 우회 (default OFF, ADR-0157 정확 비교)

```bash
SECTOR_ENERGY_ALIAS_REGISTRY_EXPANSION_DISABLED=true
```

활성 시 효과:

- `isNonSectorAggregateRow()` 항상 `false` 반환 → ADR-0446 결정 트리 동작 100% 복원
- 신규 alias (음식료·담배 등) 매칭 차단 → 기존 alias만 사용
- `normalizeIndexNameForLookup` 강화 단계 4·5·8 skip → ADR-0446 6 단계 동작 복원
- `aliasExpansionRecovered` / `nonSectorAggregateIgnored` / `topRecoveredAliases` 영속 0 (옵셔널 부재)

`isSectorEnergyAliasRegistryExpansionDisabled()` SSOT 헬퍼 — 호출자 측 inline ENV 검사 0건 (ADR-0185~0189 정합).

## 11. 호출자 wiring 매트릭스

| 호출자 | 변경 내용 |
|---|---|
| `sectorEnergyMaster.ts` | SECTOR_INDEX_MASTER 8 entry 의 `aliases` 배열 확장. sectorKey / displayName / krxIndexCode / market / yahooProxySymbol 변경 0건. |
| `sectorEnergyIndexCodeRecoveryDiagnostic.ts` | (1) `SectorIndexCodeMissingReason` 12-value union 격상 + (2) `isNonSectorAggregateRow` SSOT + `NON_SECTOR_AGGREGATE_KEYWORDS` SSOT 신규 + (3) `normalizeIndexNameForLookup` 단계 4/5/8 추가 + (4) `classifyMissingReason` NON_SECTOR_AGGREGATE_ROW 분기 추가 + (5) `evaluateIndexCodeRecovery` 결과 schema 3 옵셔널 필드 추가 + (6) `formatPhase2RecoverySection` 🧩 Alias Expansion 섹션 추가 + (7) `formatPhase2RecoveryCompactLine` aliasExpansion / aggregateIgnored 추가 + (8) `isSectorEnergyAliasRegistryExpansionDisabled` ENV 헬퍼. |
| `sectorEnergyProvider.ts` | `withQualityDiagnostic` 가 `aliasExpansionRecovered` / `nonSectorAggregateIgnored` / `topRecoveredAliases` 카운트 누적 → diagnostic 전달. backfill 본체 결정 트리 변경 0 (alias 매칭 효과는 expandAliasCandidates 위임). |
| `sectorEnergyQualityDiagnostic.ts` | `SectorEnergyQualityDiagnostic` 옵셔널 후방호환 — `aliasExpansionRecovered?` / `nonSectorAggregateIgnored?` / `topRecoveredAliases?` 추가. ADR-0399 4-axis 무수정. |
| `macroStateRepo.ts` | 영속 schema 옵셔널 후방호환 — 위 3 필드 영속. 기존 영속 데이터 무수정. |
| `sectorEnergyDiag.cmd.ts` | 🧩 Alias Expansion 섹션 추가 wiring (formatPhase2RecoverySection 결과 그대로 노출). |
| `scanBlockers.cmd.ts` | compact 한 줄 격상 — `formatPhase2RecoveryCompactLine` 결과 그대로 노출. |

LIVE 매매 본체 (`signalScanner` / `signalScanner/**` / `entryEngine` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor` / `buyPipeline`) 0줄 변경.

## 12. 절대 불변식 (사용자 §"절대 불변식" 14종 + 본 ADR 5종)

### ADR-0446 14종 모두 보존:

1. `fallbackUsed !== 'NONE'` → `recoveryStatus='RECOVERED'` 금지
2. `symmetryValidation !== PASSED` → RECOVERED 금지
3. `indexCodeCoverage < 0.8` → RECOVERED 금지
4. `sanityViolationCount > 0` → `leadershipConfidence='OK'` 금지
5. STOCK_DAILY fallback → trusted leadership source 아님
6. `freshness=FRESH` 단독 → `confidence='OK'` 금지
7. ambiguous alias 자동 backfill 절대 금지 (다중 후보 시 진단만 기록)
8. SECTOR_INDEX_MASTER 본체 변경 0 (sectorKey / displayName / krxIndexCode / market / yahooProxySymbol — alias 만 추가 허용)
9. KIS 주문 함수 5종 import 0건
10. `autoTradeEngine` / `orderExecutor` / `trancheExecutor` import 0건
11. Gate threshold + condition weight + STRONG_BUY + SELL_ONLY 조건 0 변경
12. 외부 API 신규 호출 0
13. 영속 schema 옵셔널 후방호환만
14. LIVE 매매 본체 0줄 변경

### 본 ADR-0447 추가 5종:

15. **market aggregate row 를 sector alias 로 등록 절대 금지** — `isNonSectorAggregateRow` 로 분리 후 `NON_SECTOR_AGGREGATE_ROW` reason 부여 + `ALIAS_NOT_REGISTERED` 분류 차단
16. **신규 alias 등록 시 ambiguous 자동 검증 의무** — 회귀 테스트가 모든 alias × normalized form 정확 1개 entry 매칭만 인정
17. **NON_SECTOR_AGGREGATE_KEYWORDS SSOT 단어 경계 매칭** — 부분 매칭 시 단어 경계 검증 의무 (`KOSPI` 가 `KOSPI200` 안에서 매칭 영구 차단)
18. **normalize 단계 4·5·8 default 동작** — ENV 우회로만 비활성, 호출자 측 inline 검사 0건
19. **`topRecoveredAliases` 영속 시 raw 값 / token / private metadata 0건** — `indexName` / `normalizedName` / `sectorKey` / `displayName` / `count` 만 영속

## 13. 잘못된 해결 방법 영구 차단

1. **ambiguous alias 강제 backfill** — ADR-0446 §"절대 불변식" #1 위반. 다중 후보 시 진단만 기록 의무.
2. **aggregate row 를 OTHER 섹터로 강제 분류** — sector alias 등록 절대 금지 (사용자 §"NON_SECTOR_AGGREGATE_ROW 매칭 규칙" 정합). `NON_SECTOR_AGGREGATE_ROW` reason 분리 의무.
3. **SECTOR_INDEX_MASTER displayName 변경** — 외부 매핑 / UI 라벨 / 운영 진단 SSOT 위반. alias 만 추가.
4. **SECTOR_INDEX_MASTER krxIndexCode 변경** — KRX 공식 indexCode SSOT 위반. ADR-0399 정합.
5. **SECTOR_INDEX_MASTER sectorKey 추가** — 12 표준 섹터 외 신규 sectorKey 발급 영구 금지 (사용자 명시 §3 정합). `OTHER` catch-all 사용 의무.
6. **`yahooProxySymbol` 변경** — ADR-0397 Yahoo ETF L4 fallback SSOT. 본 PR scope 외.
7. **외부 KRX/Naver/Yahoo API 신규 호출** — alias 매칭은 정적 lookup 만, 외부 호출 추가 금지.
8. **`recoveryStatus` 결정 트리 변경** — ADR-0446 §8 결정 트리 SSOT. 본 PR 은 schema 확장만.
9. **ENV default ON** — `=== 'true'` 정확 비교 + default OFF 의무 (ADR-0157 정합).
10. **호출자 측 inline `process.env.SECTOR_ENERGY_ALIAS_REGISTRY_EXPANSION_DISABLED` 검사** — `isSectorEnergyAliasRegistryExpansionDisabled()` SSOT 위임 의무.
11. **단어 경계 무시 부분 매칭** — `KOSPI200` 안의 `KOSPI` 가 NON_SECTOR_AGGREGATE_ROW 분류 영구 차단 (sector alias 매칭 우선 보존).
12. **raw `indexName` 외 metadata 영속** — `topRecoveredAliases` 는 schema 5 필드만 (private 정보 노출 차단).

## 14. 검증 매트릭스 (목표 ≥40)

총 50 회귀 케이스 — 카탈로그:

### 14.1 ENV gate (5)
- default OFF (`isSectorEnergyAliasRegistryExpansionDisabled() === false`)
- `'true'` → true
- `'1'` / `'TRUE'` / `'yes'` / `''` 모두 거부 (ADR-0157)
- `'false'` 명시 → false
- ENV 우회 시 ADR-0446 동작 100% 복원 (NON_SECTOR_AGGREGATE_ROW 분류 0)

### 14.2 NON_SECTOR_AGGREGATE_KEYWORDS SSOT (3)
- 9 키워드 (`코스피` / `코스닥` / `전체` / `합계` / `시장전체` / `외국주포함` / `KOSPI` / `KOSDAQ` / `ALL`) 정확 매칭
- 단어 경계 검증 — `KOSPI200` 안 `KOSPI` 부분 매칭 차단 (sector alias 우선)
- Object.freeze 검증 (drift 가드)

### 14.3 isNonSectorAggregateRow (8)
- `"코스피 (외국주포함)"` → true
- `"코스닥"` → true
- `"전체"` → true
- `"합계"` → true
- `"KOSPI"` → true
- `"KOSPI200"` → false (sector index code, 부분 매칭 차단)
- `"코스피 200 반도체"` → false (sector alias 매칭 우선)
- null / undefined / `""` / `"   "` → false (안전 fallback)

### 14.4 normalizeIndexNameForLookup 강화 (10 단계 — 10)
- 1~6 단계 ADR-0446 무회귀 (3 케이스)
- 단계 4 — 중점 문자: `"음식료·담배"` → `"음식료 담배"` / `"섬유ㆍ의류"` → `"섬유 의류"` / `"종이/목재"` → `"종이 목재"`
- 단계 5 — 전각·반각: 전각 영문/숫자/공백 → 반각 (1 케이스)
- 단계 8 — `"업종" suffix`: `"섬유의복업종"` → `"섬유의복"` / `"건설업종"` → `"건설"` (단어 경계 검증)
- 통합 — `"코스피 (외국주포함)"` → `""` 빈 문자열

### 14.5 SECTOR_INDEX_MASTER alias 확장 검증 (8)
- `"음식료·담배"` → CONSUMER_RETAIL 매칭
- `"섬유·의류"` → CONSUMER_RETAIL 매칭
- `"종이·목재"` → CHEMICAL 매칭
- `"섬유의복업종"` → CONSUMER_RETAIL 매칭
- `"금속"` → STEEL 매칭
- `"통신업"` → IT_INTERNET 매칭
- `"의약품"` → BIO_HEALTHCARE 매칭
- ambiguous 검증 — 모든 신규 alias × normalize 결과 정확 1개 entry 매칭

### 14.6 classifyMissingReason 결정 트리 (6)
- `"코스피 (외국주포함)"` → NON_SECTOR_AGGREGATE_ROW (EMPTY 다음 우선)
- `"음식료·담배"` (alias 미등록 시뮬) → ALIAS_NOT_REGISTERED
- `"음식료·담배"` (alias 등록 후) → backfilledByAliasExpansion (reason 분류 안 함)
- empty / null → EMPTY_INDEX_NAME (NON_SECTOR_AGGREGATE_ROW 보다 우선)
- 우선순위 — STOCK_DAILY tier 가 NON_SECTOR_AGGREGATE_ROW 보다 우선
- ENV 우회 시 NON_SECTOR_AGGREGATE_ROW 분류 0 → ALIAS_NOT_REGISTERED 또는 EMPTY_INDEX_NAME 자연 분류

### 14.7 evaluateIndexCodeRecovery 격상 (4)
- `aliasExpansionRecovered` 카운트 정합 (NAME_LOOKUP 다음 분기)
- `nonSectorAggregateIgnored` 카운트 정합 (missing rows 중 NON_SECTOR_AGGREGATE_ROW 합산)
- `topRecoveredAliases` 정렬 (count desc) + Top 5 절삭
- 옵셔널 필드 후방호환 — ADR-0446 호출자 (필드 미사용) 무영향

### 14.8 formatPhase2RecoverySection 🧩 Alias Expansion 섹션 (3)
- aliasExpansionRecovered=0 + nonSectorAggregateIgnored=0 → 섹션 미렌더 (잡음 차단)
- aliasExpansionRecovered>0 또는 nonSectorAggregateIgnored>0 → 섹션 렌더 + topRecoveredAliases Top 5
- escapePhase2Html SSOT 위임 (HTML 안전성)

### 14.9 formatPhase2RecoveryCompactLine 격상 (2)
- 정상 — `recovered N · aggregateIgnored N · aliasMissing N · confidence ...`
- aliasMissing 합산 정합 (ALIAS_NOT_REGISTERED + AMBIGUOUS_ALIAS + UNKNOWN_INDEX_NAME)

### 14.10 정적 grep 가드 + 안전 invariant (4)
- `SECTOR_INDEX_MASTER` 의 sectorKey / displayName / krxIndexCode 변경 0건 (정적 grep)
- KIS 주문 함수 5종 import 0건
- autoTradeEngine / orderExecutor / trancheExecutor import 0건
- 외부 API 호출 추가 0건 (fetch / axios / node-fetch)

## 15. 잔여 후속 PR (scope 외)

1. KRX 측 IDX_IND_CD 응답 결손 근본 원인 (ADR-0365 data-dbg fallback) 복구
2. STOCK_DAILY fallback row 의 sourceTier 별 confidence calibration 정밀화
3. `topRecoveredAliases` 의 7일 누적 ledger 영속 (운영 데이터 누적 후 alias 등록 후보 자동 제안)
4. `NON_SECTOR_AGGREGATE_KEYWORDS` 의 ENV 화 (운영 데이터 누적 후, 본 PR 은 정적 SSOT)
5. KRX 신규 업종명 자동 알림 (ALIAS_NOT_REGISTERED Top 5 가 7일 연속 동일 시 텔레그램)
