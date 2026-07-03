# ADR-0661 — DART Gate2 Eval-Path Fetch Unification + Batch Throttle (평가 경로 fetch 통일 + 배치 스로틀)

## Status
Accepted (2026-07-03 — 구현·검증 완료, PR-A `fe278cc`·PR-B `5f5d936`.
**Amendment 2026-07-03: default ON 승격** — 운영자 명시 지시("default on")로 flag 를
`!== 'false'` default ON 으로 전환 (kisFinancePrimaryFlag 와 동일 부호 방향). §Decision 의
"default OFF 출고" 및 Alternatives §4 기각 사유는 운영자 승인으로 대체됨 — ADR-0157 opt-in
원칙의 예외는 운영자 결정 명시로 충족. 롤백은 ENV `=false` 1줄로 불변.)

<details><summary>이전 Status (Phase 0)</summary>
Proposed (2026-07-03 — Phase 0. architect: 본 ADR · INDEX 0661→0662 · 필드 단위 계약
(`_workspace/2026-07-03_dart-icr-ocfni-wiring/architect/field-contract.md`) · flag 스펙까지.
코드 구현·테스트는 engine-dev 인계. 운영자 진단 요청 기반 — 3일 연속 `missingFields=ocfToNi,icr`.)
</details>

## Context

3일 연속 스캔 실측: ICR 항상 null · `missingFields=ocfToNi,icr` · earnings_quality UNAVAILABLE 다수 ·
`dartConnectionStatus CONNECTION_DEGRADED=24`. 근본원인 조사 결과(코드 인용 검증 완료):

### 1. ICR 구조적 null — 평가 경로가 레거시 fetcher 에 배선

- 평가 경로 `getGate2DartFinancialsForEvaluation`(`server/trading/gate2/gate2ExternalDataProvider.ts:784`)의
  DART leg(:799)는 **레거시** `getDartFinancials`(`server/clients/dartFinancialClient.ts`)를 호출한다.
  레거시 `DartFinancials` 는 `roe/opm/debtRatio/ocfRatio`(전부 %) 4필드만 반환 — **interestExpense ·
  operatingCashFlow(raw) · netIncome(raw) 미추출** → `interestCoverageRatio` 산출 원천 불가.
- ICR 을 실제 산출하는 **모듈 B** `fetchDartFinancialsForGate2`(:371, DART `fnlttSinglAcntAll` raw →
  `normalizeDartFinancials` → `interestCoverageRatio = 영업이익/이자비용`, `dartFinancialNormalizer.ts:340`)는
  **배치 경로** `refreshGate2ExternalData`(:1137)에만 배선되어 있다.
- KIS 는 이자비용을 bsop_non_expn(영업외비용)에 묶어 노출해 ICR 산출 불가(ADR-0655 검증) —
  ICR 은 DART(L2) 잔존 축이며, `mergeKisPrimaryWithDartResidual`(:769)이 이미 DART 잔여로 머지하도록
  설계되어 있으나 평가 경로 입력(레거시)이 항상 null 을 공급해 왔다.

### 2. 단위 함정 — 동일 필드명 `ocfRatio` 의 이중 의미

| 산출처 | `ocfRatio` 의미 | 스케일 |
|--------|----------------|--------|
| 레거시 `dartFinancialClient.ts:164` | OCF / 매출 × 100 | **%** |
| 모듈 B `dartFinancialNormalizer.ts:333` (`safeRatio(OCF, NI)`) | OCF / 순이익 | **배수** |

- `earningsQualityEvaluator`(`server/quant/conditions/evaluators.ts:790-824`)의 임계
  `>=5.0`(양호)/`>=1.0`(기본)은 **레거시 % 스케일 전제**다.
- `calculateGate2DerivedMetrics`(`gate2ExternalDataProvider.ts:539-554`)의
  `earningsQualityScore`/`ocfGreaterThanNetIncome(>=1)` 은 **배수 스케일 전제**다.
- 따라서 fetcher 를 단순 교체하면 evaluator 스케일이 붕괴한다(예: OCF/NI=1.3배 → 1.3% 로 오독).
- **잠복 결함(현행)**: cache-hit 재구성 `projectionToQmpDartFinancials`(:733)가
  `ocfRatio: metrics.earningsQualityScore`(배수)를 넣으므로, 배치(모듈 B)가 채운 캐시를 평가 경로가
  히트하면 이미 오늘도 evaluator 가 배수를 % 임계로 오독한다. 본 ADR 의 단위 계약이 이 결함도 봉인한다.

### 3. CONNECTION_DEGRADED 24 — 재무 배치 rate-limit

운영자 확인: DART 연결·공시 수신 정상. DEGRADED 24 는 배치 재무 호출(심볼 × 보고서 후보 × CFS/OFS
조합 폭증)의 rate-limit/timeout 유력 — provider 장애가 아니며 market signal 도 아니다(불변식 6).

## Decision

### §1 (PR-A) 평가 경로를 모듈 B 로 flag-gated 통일 + 단위 계약 고정

신규 ENV flag **`GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED === 'true'` — default OFF**
(ADR-0157 opt-in · SSOT `isGate2DartEvalUnifiedFetchEnabled()` —
`server/trading/gate2/gate2DartEvalUnifiedFetchFlag.ts` 신규, `kisFinancePrimaryFlag.ts` 동일 스타일).

flag ON 시 `getGate2DartFinancialsForEvaluation` 의 DART leg(:799)를
`getDartFinancials` → `fetchDartFinancialsForGate2` 로 교체하되, **evaluator 경계 단위 어댑터**를
통과시켜 아래 필드 단위 계약을 고정한다:

| 필드 | 의미 (동결) | 단위 | 산출 |
|------|-------------|------|------|
| `ocfRatio` | OCF / 매출 (기존 evaluator 계약 **동결**) | % | OCF·매출 raw 에서 재산출, 결손 시 null |
| `ocfToNi` (**신규 옵셔널**) | OCF / 순이익 | 배수 | 모듈 B `safeRatio(OCF, NI)` |
| `interestCoverageRatio` (=icr) | 영업이익 / 이자비용 | 배수 | 모듈 B normalizer 산출값 |

- `earningsQualityEvaluator` 입력(`dartFin.ocfRatio`)·임계(>=5.0/>=1.0) **무변경** — 임계 자동 변경 금지,
  변경 필요 판명 시 별도 운영자 승인.
- `mergeKisPrimaryWithDartResidual`(:769-782) 기존 잔여 축 4줄(ocfRatio/operatingCashFlow/
  interestExpense/interestCoverageRatio) **byte-무변경** — `ocfToNi` carry 1줄만 additive.
- `calculateGate2DerivedMetrics` 는 `ocfToNi`-first(부재 시 기존 식 그대로 → byte-equivalent).
- cache-hit 재구성(:733)의 배수→% 오독은 flag ON 에서만 단위 정합 재구성으로 봉인(OFF byte-identical).
- 모듈 B normalizer 계산식 무변경 — `ocfToNi` 필드 additive 만.

시그니처·분기 위치 파일:라인 상세는 field-contract.md (본 ADR 의 구현 SSOT 부속 문서).

### §2 (PR-B) DART 재무 배치 스로틀

- 배치 호출 페이싱 **≤4 req/s** (최소 간격 ~250ms).
- rate-limit 응답(DART status `020`/`021` · HTTP 429) 감지 시 해당 사이클 잔여 보고서 후보/심볼
  조기 중단(early-abort) — 실패 누적으로 DEGRADED 를 증폭시키지 않는다.
- 캐시 재사용 강화(신선 VERIFIED projection 재fetch skip · `_finCache` TTL 존중).
- `dartFinancialClient.ts` 반환 타입 무변경 — 판정 로직 0줄.

## Environment Variable Rollback

- §1: `GATE2_DART_EVAL_UNIFIED_FETCH_ENABLED` **미설정/`false` = default OFF = 레거시 경로
  byte-equivalent** (출고 기본). 운영자 관측 후 `=true` 1줄 ON, 롤백은 ENV 1줄 제거/`false`.
- §2: 스로틀 상수 revert 1커밋.

## Consequences

### Positive
- ICR·ocfToNi 가 평가 경로에 실값 유입 → `/scan_blockers` missingFields 감소 ·
  HIGH_CONVICTION 판정 데이터화 · earnings_quality UNAVAILABLE 감소.
- 단일 필드 이중 의미(ocfRatio)를 명시 필드 분리로 봉인 — cache-hit 잠복 오독 포함.
- fetch 경로 단일화(모듈 B)로 평가/배치 데이터 정합 — 배치 캐시와 평가 결과 불일치 해소.
- DART 429/timeout 감소 → CONNECTION_DEGRADED 분포 감축 (판정 로직 무변경).

### Negative
- flag ON 시 평가 경로가 DART raw fetch(모듈 B)를 타므로 cache-miss 시 지연 소폭 증가
  (배치 pre-populate + 캐시 재사용으로 상쇄, PR-B 가 총 호출량 감축).
- `QmpDartFinancials.ocfRatio` 는 normalizer 산출(배수)과 evaluator 경계(%)의 이중 의미가
  어댑터 경계 밖(배치 내부 진단 소비자)에 잔존 — 전면 rename 은 후속 정리 ADR 후보.

### Neutral / 안전성 (불변식 보존)
- **executionImpact=NONE** — `entryHardBlockImpact='NO'` · `highConvictionImpact ≤
  BLOCK_STRONG_BUY_UPGRADE`(useScope ≤ HIGH_CONVICTION_ONLY) · `marketSignal=false` 타입 계약
  그대로(`Gate2ExternalProjection` 불변 필드). Gate2 pass 판정·임계·requiredScore=70 무변경.
- **불변식 6** — DART 실패/rate-limit 시 graceful null(providerIssue=true, marketSignal=false),
  provider 장애 ≠ bearish.
- **불변식 7** — DART 는 L2(Gate 용도). live execution 직접 사용 없음. L4 미개입.
- 불변식 2 — SHADOW_LEARNING_CONTINUES_WITH_PARTIAL_FINANCIALS 유지(부분 재무로도 기록 지속).
- KIS/KRX quota 0 침범(KIS 호출 무변경) · autoTradeEngine/buyPipeline/SourceSnapshot 생성기/
  `gate2FinancialBaseline` invariant 배열/`src/**` 무접촉.

## Alternatives Considered

1. **fetcher 단순 교체 (어댑터 없이)** — 기각. `ocfRatio` 배수/% 스케일 붕괴로
   earnings_quality 오판정(§Context 2).
2. **모듈 B normalizer 의 `ocfRatio` 를 OCF/매출% 로 의미 변경** — 기각. 배치 경로 소비자
   (`dataLineClassification`·`formatters` 등 "ocfToNi 는 ocfRatio 로 대표" 전제)에 파급 —
   계산식 무변경 원칙(Patch Plan) 위반.
3. **evaluator 임계를 배수 스케일로 재조정** — 기각. 임계 자동 변경 금지 원칙(별도 운영자 승인 필요),
   forbidden files(`evaluators.ts` 임계).
4. **default ON 출고** — 기각. behavior change 는 shadow 관측 선행(ADR-0157) — 운영자 관측 후
   default-ON flip 후속 ADR.
5. **레거시 클라이언트에 interestExpense 추출 추가** — 기각. 동일 재무를 두 fetcher 가 이중 산출하는
   구조 고착(단일 통로 역행) — 모듈 B 통일이 정합.

## Implementation (engine-dev 인계)

- 구현 SSOT: `_workspace/2026-07-03_dart-icr-ocfni-wiring/architect/field-contract.md`
  (시그니처 · 파일:라인 분기 위치 · flag helper 스펙 · 테스트 매핑).
- 수정 파일: `gate2ExternalDataProvider.ts`(eval 분기 + 어댑터 + derived/투영 ocfToNi-first) ·
  `dartFinancialNormalizer.ts`(`ocfToNi` additive) · `dartFinancialClient.ts`(PR-B 스로틀만) ·
  `gate2DartEvalUnifiedFetchFlag.ts`(신규) · `.env.example` · `scripts/gate_flag_lifecycle.json`
  1행 SHADOW_OFF(ADR-0641 거버넌스 — patch-plan allowedFiles 에 동 파일 추가 승인 필요).
- 회귀 테스트: flag OFF byte-equivalent · flag ON icr/ocfToNi 산출 · DART 실패 graceful null
  (providerIssue=true·marketSignal=false) · % vs 배수 필드 분리 회귀 · `gate2FinancialBaseline`
  LOCKED_OK · entryHardBlock=false · HIGH_CONVICTION_ONLY 상한 · PR-B 스로틀/캐시 히트.

## References

- ADR-0532: KIS Finance Primary (Phase 3 — eval 경로 KIS 머지·cache self-heal 선례)
- ADR-0529: Gate2 canonical merge (Gate2ExternalProjection SSOT)
- ADR-0655: Gate2 Financial-Risk Penalty (KIS ICR 산출 불가 검증 — ICR=DART 잔존 근거)
- ADR-0416: DART 재무 부재 시 DATA_UNAVAILABLE (earningsQualityEvaluator 결손 처리 계약)
- ADR-0561: KIS Primary Absolute (Yahoo-first 차단 — 본 건 DART L2 경로만)
- ADR-0157: 신규 flag default OFF opt-in 원칙 · ADR-0641: flag-lifecycle 거버넌스
- ADR-0530: Patch Scope Guard · ADR-0146: PR 자가 review 5 카테고리
- 운영자 진단 (2026-07-03): 3일 연속 `missingFields=ocfToNi,icr` · CONNECTION_DEGRADED=24 ·
  DART 연결/공시 정상 확인
