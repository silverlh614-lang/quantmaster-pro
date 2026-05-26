# ADR-0531 Gate0 Regime SSOT — Single Canonical Source

## Status

Accepted — 2026-05-26

## Context

Gate0(매크로 레짐)이 부품마다 충돌한다. 운영자 텔레그램 증거 + 코드 확인:

실제 시장은 KOSPI 8,105 +3.28%(신고가, MA 상회) + VIX 16.6(정상) = 명백한 강세장. 그런데:

- **스캔 정본**: `resolveRegimeSnapshot().effectiveRegime` = **R3_EARLY** (정상; `regimeResolver.ts:83`
  `sanitizeEffectiveRegime` + `marketStateResolver.base.ts:322` `sanitizeLegacyR6EffectiveRegime` 정제).
- **`/regime` 커맨드** (`regime.cmd.ts:68`): `effectiveRegime=${regimeDiagnostics.effectiveRegime}` =
  **R5_CAUTION** (legacy regimeBridge transitionState 표시).
- **빈스캔 Decision Broker + interval multiplier** (`adaptiveScanScheduler.base.ts:262`):
  `regimeDiagnostics.effectiveRegime ?? getLiveRegime(macroState)` = **R5_CAUTION** →
  `REGIME_MULTIPLIER[R5_CAUTION]=2.0`(line 160) + Gate threshold(`getEffectiveGateThreshold`)를 좌우.

근본 원인: `getRegimeDiagnostics().effectiveRegime`(=`regimeBridge` transitionState.effectiveRegime,
`regimeBridge.base.ts:704`)와 그 wrapper `getLiveRegime()`(:719)는 **R6-recovery 상태기계 latch**다.
`vkospiOk`(`regimeBridge.base.ts:481`) gate에 묶여 VKOSPI level이 높으면 R5/R6에 고착 — 강세장에서도
풀리지 않는다. 반면 정본 `resolveRegimeSnapshot()`은 sanitize를 거쳐 R3_EARLY를 산출한다.

불변식 인용: **#3** 모든 판단은 단일 SourceSnapshot에서 출발(`docs/ai/03`). **#4/#5** R6/providerIssue는
SourceSnapshot(데이터)을 바꾸지 않고 Policy/Confidence/ExecutionPermission만 바꾼다(`docs/ai/02`).
동일 도메인 레짐이 부품마다 다른 값을 보는 것은 #3 위반(SSOT 부재).

## Decision

**Gate0 레짐 정본(SSOT) = `resolveRegimeSnapshot()`(`server/trading/regime/regimeResolver.ts`)의
`ResolvedRegimeSnapshot.effectiveRegime`.** 의사결정·운영자 표시의 모든 레짐 소비는 이 값을 단일
출처로 한다.

- **폐기(deprecate)**: `getRegimeDiagnostics().effectiveRegime` 및 `getLiveRegime()`는 R6-recovery
  transitionState legacy 값. 의사결정·1차 표시의 출처로 사용 금지. 삭제하지 않고 *라벨화* —
  정본 스냅샷의 `diagnostics` 안에 보존하되 표시 시 `legacyEffective=<value> deprecated=true
  notUsedForDecision=true` 진단 라벨로만 노출.
- **타입 단일 소스**: `src/types/gate0Regime.ts` 신규 — `Gate0RegimeView` / `Gate0LegacyRegimeDisplay`
  / `Gate0ConsumerIntent` 정의. 서버·클라이언트 양쪽 import(중복 선언 금지). `marketSignal: false`
  literal로 데이터 결손이 bearish로 변환되지 않게 컴파일 타임 강제.
- **소비처 마이그레이션 3분류** (전수 식별: design.md (b)):
  - **DECISION**(canonical 교체): `adaptiveScanScheduler.base.ts:262/656`, `tradingOrchestrator.ts:83/349`,
    `stockScreener.ts:682`, `intradayScanner.ts:213`, `trancheExecutor.ts:222`, `screenerJobs.ts:24`,
    `dryRunScanner.ts:72`, `macroSectorSync.ts:435`, `adaptiveScanScheduler.ts:46`.
  - **DISPLAY_ONLY**(canonical 1차 + legacy 라벨 병기): `regime.cmd.ts:51/67-68`, 리포트/렌더러/
    명령 출력. `status.cmd.ts`·`adminNowDetail.cmd.ts`·`metaCommands.ts`는 이미 정본 사용(변경 없음).
  - **LEARNING_LABEL**(라벨 정합, 차단 영향 없음 — 불변식 #8): `shadowResolverJob.ts:146`,
    `emptyScanPostmortem.ts:512`, `counterfactualShadowLearningLane.ts`.

## Behavior change & byte-equivalent

- **LIVE 주문 본체 0줄 변경.** 변경 대상은 scan 스케줄 입력·운영자 표시·학습 라벨. KIS/KRX quota 0 침범.
- **scan 스케줄 동작 변화 인지**: R5_CAUTION(legacy)→R3_EARLY(canonical) 전환 시 interval multiplier
  ×2.0 → canonical 값, empty-scan Decision Broker threshold 변화. LIVE 주문은 아니나 behavior change.
- **ENV 즉시 롤백**: `GATE0_CANONICAL_REGIME_DISABLED=true` 1줄로 DECISION 소비처가 기존 legacy
  동작 100% 복원. default OFF=기존 legacy 보존(운영자 명시 활성화 후 SHADOW 검증 → LIVE 권장).
- **R6 보존**: *진짜 R6*(activeR6Triggers>0)는 canonical도 sanitize 후 R6_DEFENSE 유지 —
  방어가 임의 해제되지 않음.

## Guardrails

- `minimumSignalScoreTrace.ts` 등 LIVE 산식 본체 무수정.
- `regimeBridge` R6-recovery 상태기계 본체 무수정(legacy 진단 출처로 유지).
- `marketStateResolver` sanitize 로직 무수정(정본 산출 메커니즘).
- 9대 불변식 위반 0 — 특히 #3(SSOT)·#8(shadow 차단 분리).
- 회귀 테스트: golden snapshot 정합 / scan multiplier / Decision Broker threshold / R6 분기 보존 /
  ENV 롤백 / `/regime` legacy 라벨(design.md (e) #1~#6).

## Alternatives Considered

1. **legacy `getLiveRegime` 삭제** — 거부. R6-recovery transitionState 진단 추적성 상실, 광범위
   import 일괄 삭제는 회귀 위험 큼. 라벨화가 안전.
2. **legacy를 정본으로 승격** — 거부. legacy가 강세장에서 R5/R6 고착하는 *결함*이 사고 원인. 정본은
   이미 sanitize로 R3을 산출.
3. **단일 ADR로 VKOSPI 가드와 통합** — 거부. 도메인(wiring/표시 vs provider sanity)·ENV 롤백·회귀
   baseline이 독립적. Patch Scope Guard 3도메인 원칙상 ADR-0530로 분리.

## References

- `docs/ai/03-source-snapshot-ssot.md` (불변식 #3 SSOT)
- `docs/ai/02-trading-engine-rules.md` (불변식 #4/#5/#8)
- `_workspace/2026-05-26_gate0-regime-ssot/architect/design.md` (소비처 분류표·체크리스트·회귀요구)
- ADR-0530 (VKOSPI stale/implausible 신뢰 가드 — 근본원인 해소)
- ADR-0074 (live regime line), ADR-0166/0169/0170 (regime exposure budget)
