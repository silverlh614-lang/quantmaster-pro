# ADR-0580: marketDataRefresh ACMA imminent-limit type and pure-helper extraction

@responsibility refactor — byte-equivalent type + pure-leaf-helper extraction for marketDataRefresh.ts (ACMA 1500-line imminent)

## Status

Accepted

## Context

`server/trading/marketDataRefresh.ts` (1498~1499줄) 는 절대 규칙 #6 의 1,500줄 ACMA 한계
(`scripts/check_complexity.js`, `over = value > 1500`)에 **1~2줄 차로 도달**해, 다음 1줄 수정에
빌드/커밋이 차단되는 상태였다 ([[ADR-0579]] 임박 파일 선제 분해의 후속 — 그 PR 에서 trading 도메인이라
executionImpact 확인 후 분리 처리하기로 deferred 한 파일).

이 모듈은 RegimeVariables/MacroState 를 갱신해 regime 엔진(→ maxPositions/execution)에 영향을 주는
**execution-relevant** 파일이다. 따라서 로직 분해는 금지하고, 런타임 byte-equivalent 가 보장되는
**타입 + 순수 leaf 헬퍼 추출**만 적용한다 (ADR-0523/0524/0579 패턴).

## Decision

`type`/`interface` 선언과 **순수 leaf 헬퍼**(모듈 mutable state·I/O 무참조)만 형제 서브모듈로 추출하고,
본체는 `export *` 재노출 + named import 로 public API 를 byte-equivalent 보존한다. 거대 함수
`refreshMarketRegimeVars`(~739줄, execution 로직)와 stateful/impure 함수(`getYahooHealthSnapshot`·
`fetch*`·`log*`·`computeFssVars` 등)는 **무접촉**.

```
server/trading/
├── marketDataRefresh.ts                  # refresh 로직 본체 (types·helpers 소비)
└── marketDataRefresh/
    ├── types.ts                          # 타입 8종 (MacroRefreshReason·ProgramMarket*·ShortSelling*·DailyBar·YahooHealthSnapshot)
    └── helpers.ts                        # 순수 leaf 헬퍼 11 (format/parse/sma/nDayReturn/normalizeMarketProgramLeg 등)
```

## Consequences

- `marketDataRefresh.ts` 1499 → **1327줄** (types 53 + helpers 159 추출). ACMA 한계 173줄 여유 확보.
- executionImpact=**NONE** — 컴파일타임 소거 타입 + 순수함수 재배치, 런타임 byte-equivalent (로직 라인 추가 0, diff 28+/199-).
- 외부 importer 경로 변경 0건 — `export * from './marketDataRefresh/types.js'` 로 ShortSelling*/DailyBar/YahooHealthSnapshot 공개 표면 보존.
- 회귀: lint(tsc client+server) EXIT=0 · `validate:complexity` OK(3131 파일) · 관련 테스트 9파일/130 통과.
- `refreshMarketRegimeVars`(739줄, cc146) GodFunctionGuard WARN 는 **선존·무접촉** — 비차단(WARN), execution 로직이라 별도 후속(함수 분해는 cc-noise·고위험, 본 ADR 범위 밖).

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
