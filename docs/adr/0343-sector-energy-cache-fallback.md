# ADR-0343: sectorEnergy FAILED 시 macroState 캐시 fallback (Phase 1 — wrapper)

**Status**: Accepted (Phase 1 — wrapper + schema, saver wiring 후속 PR)
**Date**: 2026-05-06

## 배경

`buildSectorEnergyInputsWithMeta` 가 `dataQuality='FAILED'` 반환 시 호출자 (sectorEnergyEngine + sectorScoreBoost) 의 `boost` 가 0 으로 영구 비활성. KRX OpenAPI 일시 장애 / 휴장일 클러스터 진입 시 sectorScoreBoost 영구 차단 결함.

ADR-0125 (PR-1 후속) 의 STALE marker 자체는 존재하지만, **실제 fallback 메커니즘 부재** (`sectorEnergyResult` 는 캐시되지만 raw `inputs` 는 아님 → engine 재계산 시 입력 부재).

## 결정

### Phase 1 (본 PR scope) — wrapper + schema 만

**적용**:
1. `MacroState` 옵셔널 schema 확장 — `sectorEnergyInputs?: SectorEnergyInput[]` + `sectorEnergyInputsUpdatedAt?: string`
2. `buildSectorEnergyInputsWithMetaWithFallback()` wrapper 신설 (호출자 0건 dead code)
3. wrapper 동작:
   - 원본 함수 호출
   - `dataQuality === 'FAILED'` 시 `loadMacroState()` (dynamic import) 호출
   - `sectorEnergyInputs` 부재 → 원본 결과 그대로
   - `updatedAtMs` < 48h → STALE marker + 캐시 inputs 사용
   - 그 외 → 원본 결과
4. ENV `SECTOR_ENERGY_FALLBACK_DISABLED=true` (default OFF) → 원본 결과

**보류 (후속 PR)**:
- saver wiring — `buildSectorEnergyInputsWithMeta` 성공 분기에서 `saveMacroState({sectorEnergyInputs, sectorEnergyInputsUpdatedAt})` 호출 (호출자 1곳, scheduling 정합 필요)
- 호출자 마이그레이션 — `sectorEnergyEngine` / `sectorScoreBoost` 가 wrapper 사용으로 전환 (LIVE wiring)

### 임계 SSOT

- `SECTOR_ENERGY_FALLBACK_MAX_AGE_HOURS = 48` — 캐시 신선도 임계
- 0 ≤ ageHours < 48 → fallback 활성
- 48 ≥ ageHours → fallback 비활성 (원본 결과)

### 안전 제약

- saver 부재 시 wrapper 가 원본 결과 그대로 반환 (영속 데이터 부재 → fallback 비활성)
- saver wiring 까지 wrapper 효과 0 — Phase 1 = dead code 인프라
- macroStateRepo dynamic import — 절대 규칙 #3 (서버↔클라 직접 import 금지) 정합 + 순환 import 차단

## 안전 invariant

- LIVE 매매 본체 0줄 변경 (호출자 0건 dead code)
- KIS/KRX 자동매매 quota 0 침범
- ENV `SECTOR_ENERGY_FALLBACK_DISABLED=true` 1줄 즉시 비활성
- 기존 `buildSectorEnergyInputsWithMeta` 본체 무수정
- schema 옵셔널 확장 — 후방호환 (기존 macroState.json 무영향)
- NaN/Infinity / 음수 ageHours 안전 fallback

## 잘못된 해결 방법 영구 차단

1. **`buildSectorEnergyInputsWithMeta` 본체 변경** — 호출자 (sectorEnergyEngine 등) 회귀 위험. wrapper 패턴 정책.
2. **saver wiring 본 PR 통합** — Phase 1 = dead code 인프라, 후속 PR 분리.
3. **호출자 마이그레이션 본 PR** — 회귀 위험 큼.
4. **48h 임계 ENV 노출** — 정적 SSOT (운영 데이터 누적 후 재조정).
5. **macroStateRepo 정적 import** — 순환 import 위험 (sectorEnergyProvider ← sectorScoreBoost 등 트리 보호).
6. **`sectorEnergyResult` 직접 read fallback** — `inputs` 와 `result` 는 서로 다른 abstraction, raw `inputs` 가 정확한 fallback 대상.

## 회귀 테스트

`sectorEnergyFallbackAdr0343.test.ts` — SSOT 상수 1 + ENV 정확 비교 3 + export 검증 2 + 정적 grep 가드 10 (SSOT 상수 / FAILED → STALE 마커 / 48h 검증 / dynamic import / FAILED 외 무변경 / ENV 우회 / 진단 로그 ADR 마커 / NaN 안전 / inputs/updatedAt 부재 가드 / Phase 1 export 명시).
