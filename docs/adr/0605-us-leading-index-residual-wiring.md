# ADR-0605: 미국 선행지수 연결 잔여 이행 — fast-upgrade 보조 AND + SOX→Gate2 반도체 proxy 축 + NDX 밴드 분리

@responsibility policy — ADR-0604 가 "미구현 (후속 ADR 후보)"로 명시한 3건을 일괄 이행: 상방 fast-upgrade 의 미국 야간 보조 AND(default OFF), SOX 수집·Gate2 반도체 섹터축 proxy(default OFF·62 캡), /us_overnight NDX 밴드 분리(표시 전용)

## Status

Accepted (구현 — 행동 변경 경로는 전부 flag default OFF, 표시·수집 경로만 즉시 가동)

## Context

ADR-0603(SPX KIS 승격·NDX 수집)·ADR-0604(stratify 관측 + 하방 대칭 가드)가 남긴 잔여 3건.
공통 원칙: 한미 상관은 비정상성(디커플링)이 알려진 리스크 — 게이트/레짐 소비는 실측·운영자
활성화가 선행하고, 수집·표시는 즉시 가동한다.

## Decision

### D1 — fast-upgrade 보조 AND (`REGIME_RISK_ON_FAST_UPGRADE_US_OVERNIGHT_AND_ENABLED === 'true'`, default OFF)

ADR-0593 3중 AND(강반등·VKOSPI 진정·breadth 우위)에 ④ "SPX 야간 비급락 확인"을 추가:
`spxOvernightReturnPct >= REGIME_RISK_ON_FAST_UPGRADE_US_OVERNIGHT_MIN_PCT`(가드 [-5,5],
default **-0.5**). 보조 flag ON + SPX 부재 → 보수 미발동 — fast-upgrade 는 예외 가속 경로라
미발동이 기본 동작과 동일하며, 결손을 bearish 로 변환하는 것이 아니다(기존 ①③과 동일 논리).
주입: `resolveRiskOnFastUpgradeInputs` 가 `macroState.spxDayReturn` 전달 + 발동 로그에 표기.

### D2 — SOX 수집 + Gate2 반도체 proxy 축 (`GATE2_SOX_SECTOR_AXIS_ENABLED === 'true'`, default OFF)

1. **수집(즉시 가동)**: `resolveKisOverseasSoxIscd`(ENV `KIS_OVERSEAS_SOX_ISCD`, default 'SOX' —
   KIS 마스터 코드 상이/미지원 시 ENV 정정 또는 null 격리) → `refreshSpxSection` 에서
   `macroState.soxDayReturn/sox20dReturn` 관측 수집(quota ~1콜/일, 기존 일캐시 재사용).
2. **Gate2 proxy(default OFF)**: 신규 `gate2SoxSemiAxisAdr0605.ts` — ADR-0601 국내 업종지수
   hydration **이후에도** sectorCycle 결손인 **반도체 후보**(`/반도체/` 섹터)에 한해 SOX 20일
   수익을 proxy 로 주입. **`stockVsSectorReturn20d` 만 채워** buildSectorAxis 최대 점수가
   62(stockLeader)로 자연 캡 — `sectorRelativeReturn20d` 미주입으로 currentLeader(72/95) 민팅이
   구조적으로 불가능(ADR-0600 동종군 fallback 과 동일 보수). 본 모듈 KIS fetch 0.

### D3 — NDX 밴드 분리 (표시 전용, 즉시 가동)

`buildUsOvernightStratifyLines` 가 SPX 5밴드에 더해 **NDX 5밴드**(ndx 페어 존재 시)를 분리
출력 + `pairedRows: spx=N ndx=M`. 수집만 하던 `ndxOvernight` 의 가시화 — 게이트 미소비 동일.

## Guardrails

- D1/D2 행동 경로는 flag OFF 기본 — OFF 시 기존 동작 byte-equivalent. D3 은 표시 전용.
- SOX 결손(KIS 미지원 포함) → 전 경로 no-op (불변식 #6: 결손 ≠ 신호).
- FOMC/VIX/usOvernightBoost 와 중복 계상 없음 — D1 은 게이트형 AND, D2 는 결손 보충 한정.

## Rollback

ENV 3종(`..._US_OVERNIGHT_AND_ENABLED` / `GATE2_SOX_SECTOR_AXIS_ENABLED` 미설정 기본,
`KIS_OVERSEAS_SOX_ISCD` 정정용) — D1/D2 각 1줄. D3 은 모듈 revert.

## References

- ADR-0603(1단계)·ADR-0604(2/3단계 + 잔여 명시) · ADR-0593(fast-upgrade 3중 AND) ·
  ADR-0600/0601(Gate2 섹터축 fallback·hydration 캡 선례) · `riskOnFastUpgrade.ts` ·
  `gate2SoxSemiAxisAdr0605.ts` · `usOvernightStratifyLedger.ts`
