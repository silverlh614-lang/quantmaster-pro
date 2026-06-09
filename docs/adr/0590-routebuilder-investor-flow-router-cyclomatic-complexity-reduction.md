# ADR-0590: routeBuilder investor flow router cyclomatic complexity reduction

@responsibility refactor — routeBuilder investor flow router cyclomatic complexity reduction

## Status

Accepted

## Context

`buildInvestorFlowProviderRouteResultAdr0477()` (routeBuilder.ts, **cc=363, ~955줄**) 는 코드베이스 최악의
단일 함수였다. 투자자 흐름(외인/기관) provider 라우팅 SSOT 로, Gate 판단에 들어가는
`selectedProvider`/`semanticNetBuy`/`routeStatus` 를 결정하며 ~15개 공유 mutable 지역상태를 다수 provider
블록이 순차 변형하는 구조다(트레이딩-코어). 파일은 1,500줄 이하라 파일한계 위반은 아니나 분기 폭증으로
테스트·회귀 추적이 사실상 불가능한 고-cc 부채.

## Decision

**byte-equivalent 가 cc 축소보다 절대 우선**이라는 원칙 하에 accumulator-context 패턴으로 분해한다:

- 모든 mutable scalar(`selectedProvider`/`routeStatus`/`semanticNetBuy`/`pending*` 등)를 단일
  `RouteAccumulatorAdr0477` 프로퍼티로 옮기고(`selectedProvider=X` → `acc.selectedProvider=X` 일관 재작성),
  누적 객체/배열(`diagnostics`/`providerStatuses`/`samplesByProvider`/`materializationDiagnostics` 등)은 참조 전달.
- `selectShadow` + 9개 provider-resolution 블록을 신규 leaf 모듈 `routeBlocks.ts` 의 helper 로 추출
  (`applyNaverFreshBlockAdr0477`/`applySemanticFreshBlockAdr0477`/`applySemanticNormalizationBlockAdr0477`/
  `applyNaverCollectorBlockAdr0477`/`applyPendingSelectionBlockAdr0477`/`applyCacheBlockAdr0477`/
  `applyKrxBlockAdr0477`/`applyKisBlockAdr0477`/`applyFssAndFlagsBlockAdr0477`).
- multiSource 선택 → diagnostic candidates → stale cache quarantine → 결과 build 섹션을 `routeResultBuilder.ts`
  `buildRouteResultAdr0477` 로 추출.
- downstream 다수 소비되는 순수-함수 const(`naverFreshDataSnapshot`/`freshNaver`/`semanticFreshDataSnapshot`/
  `freshSemantic`/`cacheLookup`/`cacheLookupSample`)는 prologue 에서 1회 선계산해 read-only 전달(부작용 0 → 출력 불변).

## Consequences

- `buildInvestorFlowProviderRouteResultAdr0477()` **cc 363 → ≤25** (GodFunctionGuard OK). routeBuilder.ts
  1,034 → 62줄(prologue + 순서 보존 블록 호출 + 결과 build 위임). 신규 `routeBlocks.ts` 580줄 + `routeResultBuilder.ts` 584줄.
- **잔존 WARN(비차단)**: `buildRouteResultAdr0477`(cc=208)·`applyKisBlockAdr0477`(cc=41)·`applyCacheBlockAdr0477`(cc=27).
  결과-build 섹션은 ~30개 상호의존 const + 거대 객체 리터럴이 한 표현망이라 추가 분리 시 값 보존 위험 → byte-equivalent
  우선으로 단일 helper 보존. 코드베이스 최악 단일함수(363)는 제거됐고 cc 가 더 작은 단위로 분산됨.
- byte-equivalent: lint EXIT=0(client+server). 지정 회귀 3스위트 54/54 + **signalScanner 디렉토리 전체 170파일/2420테스트 무회귀**.
- executionImpact=NONE(신규 KIS/KRX/Yahoo outbound 0건). 9대 불변식(#3 단일 SourceSnapshot·#9 Gate 내부 provider 직접조회 금지 등)
  무영향 — selectedProvider 결정 규칙(KRX CORE 직결 금지 포함)·블록 순서·`diagnostics.push` 문자열 전부 원문 보존.

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
