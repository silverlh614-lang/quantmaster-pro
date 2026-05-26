# ADR-0522: regimeLearningBank analytics helper decomposition

@responsibility refactor — regimeLearningBank analytics helper decomposition

## Status

Accepted

## Context

`server/learning/regimeLearningBank.ts` (1656 LoC) 는 절대 규칙 #6 (1500줄) 위반으로 ADR-0133
BASELINE_TECHNICAL_DEBT 카탈로그에 등재된 잔여 파일 중 하나다. `@responsibility` 가 명시하듯
**diagnostic/read-only** 모듈 (레짐별 Shadow Learning Bank). 타입은 이미 `regimeLearningTypes.ts` 로
외부화돼 있어(`export type *`) 타입 추출 여지는 없고, 함수 분해가 필요했다.

라인 47-303 의 라벨 상수 5종 + 순수 분석/품질/포맷 헬퍼 24개 (`round`·`avg`·`pct`·`qualityStatus`·
`whyNotReliable`·`patternText` 등) 는 `collect*` 빌더나 후방 정의 함수를 참조하지 않는 **leaf 클러스터**로,
순환 import 위험 없이 단독 분리 가능하다.

## Decision

해당 leaf 클러스터를 `regimeLearningBank/analytics.ts` 단일 책임 모듈로 추출하고, 본체는 필요한
이름을 named import 후 사용 (one-directional: regimeLearningBank → analytics). 공개 API 인
`R6_MIN_RESOLVED_SAMPLE_FOR_PROMOTION` 은 `export { ... } from './regimeLearningBank/analytics.js'` 로
재export 해 byte-equivalent 유지. `REGIME_LEARNING_PHASES`·`export type *`·`collect*`/`format*` export 무변.

```
server/learning/
├── regimeLearningBank.ts            # collect*/format* + 본체 (analytics 소비)
└── regimeLearningBank/
    └── analytics.ts                 # 라벨 상수 + 순수 분석/품질/포맷 헬퍼 SSOT
```

- **`analytics.ts`** @responsibility: "Regime Shadow Learning Bank 순수 분석/품질/포맷 헬퍼 + 라벨 상수 (diagnostic/read-only)".

## Consequences

- 1656 → **1431 LoC** (analytics.ts 270 LoC 추출) → ADR-0133 BASELINE 카탈로그에서 정식 제거 → 재초과 시 즉시 fail.
- 외부 importer 경로 변경 0건 (public export 무변). 런타임 byte-equivalent, Shadow Learning 동작 무변 (불변식 #2 보존), executionImpact=NONE.
- 회귀: `regimeLearningBank.test.ts` + `regimeLearning.cmd.test.ts` 23/23 통과. lint EXIT=0.
- 후속: 잔여 대형 함수(`buildStatsForPhase`·`collectRegimeLearningBank`) 분해는 별도 patch (본 ADR 범위 밖).

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
