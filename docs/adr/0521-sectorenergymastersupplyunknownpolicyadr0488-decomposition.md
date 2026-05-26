# ADR-0521: sectorEnergyMasterSupplyUnknownPolicyAdr0488 decomposition

@responsibility refactor — sectorEnergyMasterSupplyUnknownPolicyAdr0488 decomposition

## Status

Accepted

## Context

`server/trading/signalScanner/sectorEnergyMasterSupplyUnknownPolicyAdr0488.ts` (1568 LoC) 는
절대 규칙 #6 (1500줄 한계) 위반으로 ADR-0133 BASELINE_TECHNICAL_DEBT 카탈로그에 등재된 6 파일 중 하나다.
`@responsibility` 헤더가 명시하듯 **SHADOW_ONLY, no live execution** 진단/표시 전용 모듈이다.

### 현재 구조 (1568 LoC)

| 영역 | 라인 범위 | 내용 |
|------|----------|------|
| imports + 헤더 | L1-15 | 외부 타입/모듈 + ADR 주석 |
| **타입/인터페이스 17종** | **L17-258, L1441-1450** | status/rootCause 유니온 4 + 리포트·입력·레지스트리 인터페이스 13 |
| 상수 + 순수 헬퍼 | L260-588 | REQUIRED_SCORE·numeric/string/diagnostic 추출 헬퍼 |
| master 리포트 빌더 | L590-1164 | `buildSectorEnergyMasterReportAdr0488` 등 |
| supply-unknown 정책 | L1165-1364 | `buildSupplyUnknownPolicyReportAdr0488` 등 |
| 포매터/레지스트리/observation | L1366-1568 | compact/detail/observationRows 등 표시 함수 |

### 외부 importer

타입·빌더·포매터는 `sectorEnergyMasterSupplyUnknownPolicyAdr0488.js` 경로로 외부에서 import 된다
(scanBlockers/runtimeResolverTrace 등). 분해는 **import 경로 변경 0건**을 보장해야 한다.

## Decision

타입 정의 17종을 `sectorEnergyMasterSupplyUnknownPolicyAdr0488/types.ts` 단일 책임 모듈로 추출하고,
원본 파일은 해당 타입을 `import` 후 `export *` 로 **byte-equivalent 재export** 한다 (public API·런타임 무변).
runtime 함수(빌더·정책·포매터)는 본 PR 에서 이동하지 않는다 — 공유 헬퍼(`pct`/`round1`) 결합으로
순환 import 위험이 있어 후속 PR 로 분리한다 (no broad rewrite).

```
server/trading/signalScanner/
├── sectorEnergyMasterSupplyUnknownPolicyAdr0488.ts   # 빌더·정책·포매터 + types re-export
└── sectorEnergyMasterSupplyUnknownPolicyAdr0488/
    └── types.ts                                       # 타입/인터페이스 17종 SSOT
```

- **`types.ts`** @responsibility: "ADR-0488 SectorEnergy master·supply-unknown 정책 진단 리포트/입력/레지스트리 타입 계약 SSOT".

## Consequences

- 1568 → 1500 미만 (타입 ~240 LoC 추출) → ADR-0133 BASELINE 카탈로그에서 정식 제거 → 재초과 시 즉시 fail.
- 외부 importer 경로 변경 0건 (`export *` 재export). 런타임 byte-equivalent, executionImpact=NONE.
- 회귀: `sectorEnergyMasterSupplyUnknownPolicyAdr0488.test.ts` + scanBlockersEnergy.cmd.test 등 무변 통과.
- 후속: 포매터(`formatters.ts`)·공유 헬퍼(`helpers.ts`) 분리는 별도 patch (본 ADR 범위 밖).

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
