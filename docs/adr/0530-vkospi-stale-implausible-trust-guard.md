# ADR-0530 VKOSPI Stale/Implausible Trust Guard

## Status

Accepted — 2026-05-26

## Context

운영자 텔레그램 증거: VKOSPI=67.0이 R6-recovery를 차단해 레짐이 R5_CAUTION/R6에 고착됐다.
그러나 동시 시장 데이터는 VIX=16.6(정상) + KOSPI +3.28%(신고가)로 **명백한 강세장**이다.

VKOSPI·VIX는 통상 ±5~10 동행한다. VKOSPI 67은 VIX 16.6 대비 +50.4 괴리 — 코로나 폭락 수준이며
강세장에서 구현 불가능하다. 데이터 출처는 `source=KRX_DERIV_INDEX_DAILY`, `prevClose=71.33`,
`sourceFreshness=FRESH` — **값은 틀렸는데 fresh로 표기된 stale/오류**다.

코드 경로: `regimeBridge.base.ts:481` `vkospiOk: (macroState.vkospi 67.0) <= vkospiThreshold(28)`
= false → `evidenceComplete()`(:502) = false → R6-recovery 차단 → legacy `effectiveRegime`이
R5_STABILIZING/R5_CAUTION에 고착.

**이는 불변식 #6(Provider 장애는 market signal이 아니다) 위반이다.** stale/오류 provider 값이
방어 레짐(bearish market signal)으로 변환됐다. 데이터 신뢰 등급상 VKOSPI 원천 KRX는 L1이나,
sanity 실패 시 해당 값은 untrusted로 강등돼야 한다.

## Decision

VKOSPI가 **신뢰 불가**(VIX·KOSPI 수익률과 명백히 모순)일 때 R6-recovery의 `vkospiOk` 판정에서
**격리(UNKNOWN 취급)** 한다 — "방어 유지"의 근거로 쓰지 않는다. **진짜 VKOSPI 급등(실제 폭락)은
절대 마스킹하지 않는다.**

### 발동 매트릭스 (AND — 전부 충족해야 격리)

| 게이트 | 조건 | ENV(기본) |
|--------|------|-----------|
| G1 VIX 괴리 | `vkospi - vix > CAP` | `VKOSPI_VIX_DIVERGENCE_CAP`(25) |
| G2 KOSPI 비스트레스 | `(kospiCloseReturn ?? kospiDayReturn) > FLOOR` | `VKOSPI_GUARD_KOSPI_FLOOR`(-1.0) |
| G3 intraday 비스트레스 | `kospiIntradayLowReturn > -3.0`(존재 시) | — |
| G4 freshness 일관성(진단/경보) | `sourceFreshness !== FRESH` 또는 G1+G2 | — |

발동 = (G1 AND G2 AND G3) → VKOSPI 신뢰상태 `UNTRUSTED_IMPLAUSIBLE` → `vkospiOk` 판정에서
VKOSPI level gate를 **차단 근거에서 제외**(다른 stable evidence로만 판정). G4는 진단/경보용.

### 신뢰 등급 처리 (L1~L4)

- VKOSPI 원천 KRX = L1. sanity 실패 시 *그 값 1건만* `UNTRUSTED_IMPLAUSIBLE`/`UNTRUSTED_STALE`/
  `MISSING`으로 강등. L1 등급 자체는 불변. AI_ESTIMATED(L4)로 대체하지 않음(불변식 #7).
- VKOSPI 값을 임의 보정·0 치환하지 않음(불변식 #6: null≠0). 단지 *방어 latch 근거에서 제외*.

### 절대 마스킹 금지 (진짜 폭락 보호)

| 상황 | VKOSPI / VIX / KOSPI | 발동? | 결과 |
|------|----------------------|-------|------|
| 현 사고(가짜) | 67 / 16.6 / +3.28% | **발동** | 격리 → R3 정상 |
| 진짜 폭락 | 45 / 40 / -6% | 미발동(G2 실패) | 신뢰 → 방어 유지 |
| 진짜 동행 폭락 | 67 / 55 / -8% | 미발동(G1 ≤ CAP) | 신뢰 → 방어 유지 |
| 평상 | 18 / 16 / +0.3% | 미발동 | 신뢰 |

G2(KOSPI 비스트레스)가 진짜 폭락 보호의 1차 안전판 — KOSPI가 하락 중이면 가드는 구조적으로 발동 불가.

## Behavior change & byte-equivalent

- **LIVE 주문 본체 0줄 변경.** R6-recovery evidence의 `vkospiOk` 입력 판정만 변경. KIS/KRX quota 0 침범.
- `adaptiveScanScheduler.base.ts:300` VKOSPI 급등 SELL_ONLY는 *day change*(level 아님) 기반 — **무수정**.
  본 가드는 *level* gate(`vkospiOk`)에만 적용. 진짜 급등(day change)의 즉시 방어는 보존.
- **ENV 즉시 롤백**: `VKOSPI_SANITY_GUARD_DISABLED=true` 1줄로 기존 `vkospiOk` 동작 100% 복원.

## Guardrails

- `marketSignal: false` literal 강제 — implausible VKOSPI가 bearish signal로 변환 불가(불변식 #6).
- `providerIssue=true marketSignal=false executionImpact=REGIME_RELEASE_BLOCKED_ONLY` 진단 라벨 노출.
- 격리 사유 `VKOSPI_UNTRUSTED_IMPLAUSIBLE_PROVIDER_SANITY`를 evidence.reasons + `/regime`에 노출.
- `minimumSignalScoreTrace.ts` 등 LIVE 산식 본체 무수정.
- 9대 불변식 위반 0 — 특히 #6(provider≠signal)·#7(L4 추정 금지).

## ADR-0146 자가review — (1) LIVE 매매 안전성

- **방어 레짐 오해제 위험**이 핵심 LIVE 안전 항목. 가드가 *진짜 방어*를 잘못 해제하면 위험.
  → G2(KOSPI 비스트레스)가 구조적 1차 안전판. 회귀 테스트 #8(45/40/-6%)·#9(67/55/-8%)가
  미발동 baseline. ENV `VKOSPI_SANITY_GUARD_DISABLED=true` 1줄 즉시 롤백.
- LIVE 주문 본체 0줄·KIS/KRX quota 0·회귀 테스트(design.md (e) #7~#13)·정책 baseline 무회귀.

## Alternatives Considered

1. **VKOSPI 값을 VIX 기반으로 보정/대체** — 거부. 불변식 #6(null≠0, 추정 금지) 위반. 격리(제외)만.
2. **freshness만으로 판정** — 거부. 현 사고는 fresh 표기 + 값 오류. VIX·KOSPI 교차검증(G1~G3) 필요.
3. **threshold(28) 상향** — 거부. 임시방편. 진짜 폭락 시 방어 약화. 교차검증 가드가 정확.
4. **단일 ADR로 SSOT 단일화와 통합** — 거부. provider sanity 도메인 + ENV 롤백·회귀 독립. ADR-0531 분리.

## References

- `docs/ai/00-project-charter.md`, `docs/ai/05-provider-policy.md` (불변식 #6, L1~L4)
- `docs/ai/03-source-snapshot-ssot.md` (stale/sanity 검증, provider≠signal)
- ADR-0499 (provider-health vs market-signal classifier — provider 문제는 bearish 아님)
- ADR-0068b (macrostate stale block), ADR-0117 (sanity trade block gate)
- ADR-0531 (Gate0 정본 단일화 — 본 가드가 근본원인 해소)
- `_workspace/2026-05-26_gate0-regime-ssot/architect/design.md` (매트릭스·체크리스트·회귀요구)
