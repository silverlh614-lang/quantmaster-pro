# ADR-0579: ACMA imminent-limit files type-extraction decomposition

@responsibility refactor — preemptive type-only extraction for ACMA 1500-line imminent files

## Status

Accepted

## Context

`scripts/check_complexity.js` (ACMA) 는 절대 규칙 #6 으로 파일당 **1,500줄** 한계를 강제한다
(`over = value > 1500`, 즉 1,501 부터 fail). 2026-06-06 실측 결과 다음 2 파일이 **정확히 1,500줄
또는 1줄 차** 로 한계선에 도달해, 다음 1줄 수정에 빌드가 차단되는 상태였다:

- `server/trading/signalScanner/gate1DryRunObservationLedgerAdr0476.ts` — **1,500줄**.
  `@responsibility`: "ADR-0476 Gate1 dry-run observation ledger; SHADOW_ONLY, no live execution"
  → executionImpact=NONE (관측·진단 전용 ledger).
- `server/clients/sectorEnergyProvider.ts` — **1,499줄**. sectorEnergy 입력을 Gate2 로 공급하는
  provider (execution-adjacent).

둘 다 BASELINE_TECHNICAL_DEBT 미등재(아직 초과 아님)였으나, 한계선 방치는 절대 규칙 #6 위반
(차단 폭탄)이라 선제 분해한다. 또한 `docs/ai/01-architecture-map.md`·`docs/ai/09-refactor-rules.md`
의 복잡도 표가 이미 분해된 파일(signalScanner/entryFilterDecomposition/investorFlowProviderRouter/
minimumSignalScoreTrace)을 P0~P2 위반으로 잘못 표기 중이라, 본 PR 에서 실측 SSOT(`validate:complexity`)
기준으로 함께 동기화했다.

## Decision

ADR-0523/0524 와 동일한 **type-only 추출** 패턴(런타임 byte-equivalent)을 적용한다 — `type`/`interface`
선언만 각 파일의 형제 `<name>/types.ts` 서브모듈로 추출하고, 본체는 `export *` 로 재노출해 외부 importer
경로 변경 0건을 보장한다. `const`/함수/값/로직은 일절 이동하지 않는다.

```
server/trading/signalScanner/
├── gate1DryRunObservationLedgerAdr0476.ts        # build*/save/load/summarize 본체 (types 소비)
└── gate1DryRunObservationLedgerAdr0476/
    └── types.ts                                  # 관측 타입 13종 (ADR-0476 계약 SSOT)

server/clients/
├── sectorEnergyProvider.ts                        # build/aggregate 로직 본체 (consts·함수 잔류)
└── sectorEnergyProvider/
    └── types.ts                                  # SectorEnergy 타입 9종
```

`SymmetryValidationResult` 등이 `sectorEnergyProvider.ts` 본문에 literal 로 존재함을 정적 grep 으로
검증하던 가드 2건(`sectorEnergyProviderAdr0424.test.ts`·`sectorEnergyQualityDiagnosticAdr0423.test.ts`)은
본문 + `types.ts` 를 함께 read 하도록 갱신(ADR-0444 static-grep-guard 하드닝) — 향후 이동에도 견고.

## Consequences

- `gate1DryRunObservationLedgerAdr0476.ts` 1,500 → **1,242줄** (types 269 추출). executionImpact=NONE.
- `sectorEnergyProvider.ts` 1,499 → **1,343줄** (types 169 추출). type-only → 런타임 byte-equivalent.
- 외부 importer 경로 변경 0건 (`export *` 재노출). 값·함수·로직 0줄 변경.
- 회귀: lint(tsc 양 config) EXIT=0 · `validate:complexity` OK(3129 파일) · `validate:responsibility` 신규 0 ·
  gate1 모듈 테스트 25/25 · sector grep-guard 갱신 후 71/71. (`scanEvaluationState.test.ts` 2건은
  주말(2026-06-06 토) HOLIDAY 날짜 의존 선존 실패 — 본 분해 무관·미import.)
- 문서 동기화: `01-architecture-map.md`·`09-refactor-rules.md` 복잡도 표를 실측(BASELINE 2건 +
  임박 3건)으로 교체 + `docs/adr/INDEX.md` 푸터 카운트 갱신(SSOT=`validate:adrIndex`).

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
