# ADR-0587: kisSectorEnergyProvider type-extraction decomposition

@responsibility refactor — kisSectorEnergyProvider type-extraction decomposition

## Status

Accepted

## Context

`server/clients/kisSectorEnergyProvider.ts` 가 1,520 LoC 로 ACMA 1,500줄 한계를 초과해
`BASELINE_TECHNICAL_DEBT` 카탈로그에 등재된 상태였다(2026-06-05 governance unblock, ADR-0574 KIS
섹터명 canonical 정규화 누적분). baseline 등재는 enforcement 면제이므로 분해 후 정식 제거가 필요하다.

## Decision

파일 내 **공개 타입 선언 13종**을 신규 leaf 모듈 `server/clients/kisSectorEnergyProvider/types.ts` 로
추출한다 (런타임 코드·판단 로직 0줄 변경):

- `KisSectorEnergySourceTier`, `KisSectorEnergyLeadershipConfidence`, `KisSectorEnergyCoverageBreakdown`,
  `KisSectorBasketRow`, `KisSectorEnergyIndexRow`, `SectorIndexVerificationStatus`,
  `KisSectorIndexDryRunErrorClass`, `KisSectorIndexDryRunRow`, `KisSectorIndexDryRunReport`,
  `SectorIdxcodeMasterRow`, `SectorIndexCodeMasterVerificationResult`,
  `KisSectorEnergyProviderOverrides`, `KisSectorEnergyProviderResult`.

메인 파일은 동일 타입을 `import type` 로 로컬 재사용하고 `export type ... from` 로 재-export 하여
외부 consumer import 경로 호환을 유지한다 (byte-equivalent). 내부 전용 `KisSectorIndexDryRunCacheEntry`
및 모든 런타임 함수·상수는 메인 파일에 잔류한다.

## Consequences

- `kisSectorEnergyProvider.ts` 1,520 → 1,386 LoC. ACMA 1,500 한계 자연 통과 →
  `check_complexity.js` BASELINE_TECHNICAL_DEBT 카탈로그에서 정식 제거(enforcement 복원, baseline 1건 잔존).
- lint EXIT=0 (client `tsc --noEmit` + server `tsconfig.server.json` 양쪽), sectorEnergy 회귀 테스트 68/68 pass.
- KIS/KRX outbound quota 0 침범, executionImpact=NONE, 9대 불변식 무영향 (read-only/shadow-safe provider).
- 외부 consumer 는 기존 `kisSectorEnergyProvider.js` import 경로 그대로 사용 (re-export 호환).

## Guardrails

- No live trading path change unless explicitly stated.
- No KIS/order import or invocation unless explicitly stated.
- No Gate/Kelly/STRONG_BUY behavior change unless explicitly stated.
- No Shadow policy change unless explicitly stated.
- No provider fetch behavior change unless explicitly stated.
- No data promotion behavior change unless explicitly stated.
