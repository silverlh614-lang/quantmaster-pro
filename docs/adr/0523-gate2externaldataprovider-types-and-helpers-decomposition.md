# ADR-0523: gate2ExternalDataProvider types and helpers decomposition

@responsibility refactor — gate2ExternalDataProvider types and helpers decomposition

## Status

Accepted

## Context

`server/trading/gate2/gate2ExternalDataProvider.ts` (1714 LoC) 는 절대 규칙 #6 (1500줄) 위반으로
ADR-0133 BASELINE_TECHNICAL_DEBT 카탈로그에 등재된 잔여 파일 중 하나다. `@responsibility`:
"Gate2 external financial snapshot, derived metrics, and safe projection helpers." 타입/인터페이스가
인라인으로 21종 누적되어 있고, 상단에 순수 leaf 헬퍼(I/O 무관)도 혼재한다.

## Decision

타입/인터페이스 21종(라인 22-274 블록 + `DartReportCandidate` + `Gate2PerValuationResult`)을
`gate2ExternalDataProvider/types.ts` 로, 순수 leaf 헬퍼 7개(`nowIso`·`cleanSymbol`·`isRecord`·
`finiteNumber`·`toDartAmount`·`responseStatusCode`·`compactKorean`)를 `gate2ExternalDataProvider/helpers.ts`
로 추출. 본체는 named import + `export * from './gate2ExternalDataProvider/types.js'` 로 public API
byte-equivalent 재export. fetch/DART/KIS I/O 함수는 본체에 잔류 (one-directional: 본체 → types/helpers).

```
server/trading/gate2/
├── gate2ExternalDataProvider.ts      # fetch/projection/refresh 본체 (types·helpers 소비)
└── gate2ExternalDataProvider/
    ├── types.ts                      # Gate2 외부데이터 타입/인터페이스 SSOT
    └── helpers.ts                    # 순수 leaf 헬퍼 (no I/O)
```

- **`types.ts`** @responsibility: "Gate2 external financial snapshot/projection/refresh 타입·인터페이스 계약 SSOT".
- **`helpers.ts`** @responsibility: "Gate2 external data 순수 포맷/파싱 leaf 헬퍼 (no I/O)".

## Consequences

- 1714 → **1435 LoC** (types 279 + helpers 39 추출) → ADR-0133 BASELINE 카탈로그에서 정식 제거 → 재초과 시 즉시 fail.
- 외부 importer 경로 변경 0건 (public type 은 `export *` 로 동일 경로 유지). 런타임 byte-equivalent, executionImpact=NONE.
- `Gate2InstrumentClass`·`DartReportCandidate` 는 내부→export 로 격상(경계 횡단 import 필요) — 순수 additive, 기존 export 무손실.
- 회귀: `gate2ExternalDataProvider.test.ts` + `gate2ExternalCommands.test.ts` 15/15 통과. lint EXIT=0.
- 후속: 대형 fetch/refresh 함수(`refreshGate2ExternalData` 207 LoC 등) 분해는 별도 patch (본 ADR 범위 밖).

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
