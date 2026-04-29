# ADR-0107 — MHS 4-axis 분해 영속 + Gate 0% 맥락 안내

## Status
Accepted (2026-04-29)

## Context

사용자 4/29 PM 3:35 보고 (Pipeline Yield 스코어카드 + SHADOW 진행률):

1. **수치 정합 의문** — SHADOW 진행률 (WIN 2/LOSS 5/ACTIVE 5 = 12/30, 승률 28.6%,
   가중 P&L +4.99%) + Pipeline Yield (Discovery 22.7%, Gate **0%**, Trade 100%,
   End-to-End 1.8%) → 코드 분석상 정합 OK. 단, **Gate Yield 0% (0개 평가 →
   0개 통과)** 가 7일 평균 14.1% 와 충돌해 운영자 결함 의심.

2. **MHS 70 고정 의심** — 사용자 보고 *"MHS 가 계속 70 을 벗어난 적이 없는 것
   같은데 제대로 나오는건지?"*. 코드 분석상 MHS 70 은 *함수 정상 작동* 의
   narrow band 자연 수렴 — `macroIndexEngine` 4 axis (interestRate / liquidity
   / economy / risk) fallback 합산 75 에서 5점 감산 (US10Y > 4.5 또는 VKOSPI
   > 20). 시장이 중립 zone 에 머무르는 한 70 근방.

본 PR 은 두 의문 모두 *운영자 가시화* 로 해소.

## Decision

### Track 1 — `macroState.mhsAxis` 4-axis 영속

`server/persistence/macroStateRepo.ts` `MacroState` 인터페이스에 옵셔널 2 필드
추가:

```ts
mhsAxis?: { interestRate: number; liquidity: number; economy: number; risk: number };
mhsAxisUpdatedAt?: string;
```

`server/trading/marketDataRefresh.ts` `refreshMarketRegimeVars()` 가 매 사이클
종료 시 `idx.axis` 를 `updated.mhsAxis` 에 직접 저장 (computed flat 우회 —
객체 schema 보존). `computeMacroIndex` 실패 시 기존 mhsAxis 보존 (graceful).

콘솔 로그에 axis 분해 추가:
```
[MarketRefresh] MHS 자체 계산 완료 — 70/100 (NEUTRAL_HIGH) | 소스 ecos=true fred=true
  | axis 금리=20 유동성=15 경기=15 리스크=20
```

### Track 2 — `/regime` 메시지 axis breakdown 라인

`server/telegram/commands/system/regime.cmd.ts` `formatMhsAxisLine(macro)` SSOT
신설. MHS 라인 직후에 1줄 노출:

**미수집**: `🧮 axis: N/A (다음 marketDataRefresh 사이클부터 노출)`

**정상**: `🧮 axis: 금리 20 / 유동성 15 / 경기 15 / 리스크 25 (합 75)`

운영자가 `/regime` 한 번에 *어느 축이 변동* / *어느 축이 fallback 으로 고정*
인지 즉시 진단.

### Track 3 — `qualityScorecard` Gate 0% 맥락 안내

사용자 보고 시나리오 (Gate Yield 0%) 의 *결함 vs 정책* 구분 가시화.
`formatGateZeroContext(macro)` SSOT — Gate 0개 평가 시 macroState 기반 분기:

| 우선순위 | 조건 | 안내 라인 |
|---------|------|---------|
| 1 | macro=null | `ℹ️ 평가 도달 0건 — macroState 부재` |
| 2 | bearDefenseMode=true | `🛑 Bear 방어 모드 — Gate 평가 차단 (R6_DEFENSE)` |
| 3 | mhs<30 | `🛑 MHS N (매수중단 임계 30 미만) — Gate 평가 차단` |
| 4 | regime='RED' | `🟠 매크로 RED — Gate 평가 차단` |
| 5 | 그 외 | `ℹ️ 평가 도달 0건 — 운영자 진단 필요 (FOMC/VIX 게이팅 또는 스캔 cron 점검)` |

스코어카드 메시지의 "② Gate Yield" 블록에서 `gateReached === 0` 일 때만
조건부 라인 추가 — 정상 사이클은 출력 변화 0.

## Consequences

### 즉시 효과 (배포 후)

- 운영자가 `/regime` 한 번에 4 axis 분해 즉시 확인 — MHS 70 이 *narrow band
  수렴* 인지 *변동성 부재* 인지 자력 진단.
- Gate Yield 0% 발생 시 *결함 vs 정책 차단* 구분 명확 — FOMC DAY / R6_DEFENSE
  / 매크로 RED 같은 의도된 차단을 결함으로 오해하지 않음.
- 4 axis 영속으로 후속 PR (axis 시계열 추적 / axis-aware Kelly / axis 변동성
  진단 etc.) 의 데이터 기반 마련.

### 회귀 위험

- `MacroState` 옵셔널 필드 2개 추가 — 기존 영속 데이터 호환 (`mhsAxis` 부재 시
  graceful fallback "N/A").
- `qualityScorecard` 메시지 1줄 조건부 추가 — `gateReached > 0` 정상 사이클
  영향 0.
- LIVE 매매 본체 0줄 변경 — 진단 가시화 read-only.

### 회귀 테스트 12 신규

- `regimeMhsAxis.test.ts` 5 (formatMhsAxisLine: 부재 / 정상 / 70 시나리오 /
  극단 0 / 최대 100)
- `qualityScorecardGateZero.test.ts` 7 (formatGateZeroContext: macro=null /
  bearDefense / mhs<30 / mhs=30 boundary / regime=RED / 정상 GREEN / 우선순위)

### 본 PR scope 외 (후속 명시)

- `macroState` 시계열 진단 명령 (`/mhs_history`) — 운영 데이터 누적 후 별도 PR.
- 점수 함수 그라데이션 — 현재 binary threshold (VKOSPI 20/25/30) 를 선형 보간으로
  변경, 변동성 가시화 ↑.
- scanTracer 차단 사유 별도 카운터 (`MACRO_GATE_BLOCK`) — 본 PR 의 메시지 분기
  보다 정밀한 구분.

## References

- 사용자 보고 (2026-04-29 PM 3:35) — Pipeline Yield 스코어카드 + SHADOW 진행률
  이미지 첨부, MHS 70 고정 의심.
- `server/engines/macroIndexEngine.ts` — 4 axis 점수 산출 SSOT (MACRO_AXIS_MAX=25,
  fallback 합산 75 → 70 narrow band).
- ADR-0071 — USD/KRW dual-source (`/regime` 메시지 신선도 표기 패턴 차용).
