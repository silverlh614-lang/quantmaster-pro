# ADR-0611: Gate1 SECTOR_RELATIVE_STRENGTH 컴포넌트 재활성 — 봉인된 8점 capacity 복원 (default OFF)

> 발급 노트: 본 작업은 0606 으로 초안됐으나 main 병렬 라인이 0606~0610 을 선점해 0611 로 재발급(번호 재사용 금지 정합).

@responsibility policy — requiredScore=70 이 calibrate 된 configuredPositiveMax(116)와 실제 활성 maxScore 합(108)의 8점 간극을, ADR-0467 에서 advisory-only(maxScore:0)로 주차된 SECTOR_RELATIVE_STRENGTH 를 flag 하에 재활성해 복원한다 (임계 무변경·default OFF)

## Status

Accepted (구현 — 라이브 점수 동작 변경이나 ENV flag default OFF 로 byte-equivalent, 운영자 활성화 대기)

## Context — 2026-06-15 운영자 진단("Gate1 점수가 천장에 묶임")

- 거래일 실측 Gate1 avg 55, pass 12/50. forensic `observedPositiveMax=55` vs `configuredPositiveMax=116`,
  `suspectedCause: SCORE_CEILING_TOO_LOW`, `scaleMismatch=true`.
- 라이브 스코어러(`minimumSignalScoreTrace.ts`)의 활성 컴포넌트 maxScore 합 = 20+12+14+10+10+10+8+8+8+2+6
  = **108**. configuredPositiveMax(116)과의 **8점 차이** = `SECTOR_RELATIVE_STRENGTH` 가 ADR-0467 에서
  advisory-only(`maxScore:0, weightedScore:0`)로 주차된 그 8점이다.
- 결과: requiredScore=70 은 116 스케일 기준인데 실제 도달 가능 천장이 108 — **상위 8점이 영구 봉인**.
  이는 ADR-0467(advisory 분류)의 의도치 않은 side effect 다 (임계는 그대로 둔 채 capacity 만 줄임).
- 다른 0 기여 컴포넌트(RELATIVE_STRENGTH·BREAKOUT 등)는 배선돼 있고 약세장이라 낮을 뿐 — 구조적 결손 아님.
  GHOST_SIGNAL_STRENGTH 는 입력 자체가 부재(28/28)라 활성 효과 0 + 학습→라이브 피드백이라 별도 ADR 대상.

## Decision — `GATE1_SECTOR_RS_COMPONENT_ENABLED === 'true'` (default OFF)

`resolveSectorRsComponentScore(trace)` 신규 순수 함수가 SECTOR_RELATIVE_STRENGTH 점수를 산출:

1. **OFF (기본)**: `maxScore 0 · weightedScore 0` — 기존 advisory-only 와 byte-equivalent.
2. **ON**: maxScore 8 복원. **섹터상대수익(stock − sector 20d)** 입력만 소비 — RS 컴포넌트(시장상대·
   rsRankPct)와의 이중계상 회피(ADR-0469 dedup 정합). `((pct + 10) / 20) × 100` 정규화 후
   `weightedFromNormalized(_, 8)`. 입력 부재 → weightedScore 0(graceful), maxScore 8 은 denominator 만
   (결손 ≠ 페널티, 불변식 #6). actualScore 는 weightedScore 합이므로 **섹터상대 입력이 있는 종목에서만**
   라이브 점수가 오른다.

requiredScore=70 **무변경**(절대 보존). 신규 입력 fetch 0 — 이미 trace 에 해석되는 sectorRelativeReturn20d /
gate2 sectorCycle.stockVsSectorReturn20d 만 소비.

## Guardrails

- default OFF = 라이브 Gate1 pass/fail byte-equivalent. ON 활성화는 운영자 결정(operatorApprovalRequired).
- **현실적 lift 는 점진적**: 본 capacity 복원은 8점 천장을 열지만, 섹터상대 입력이 sparse 한 현재
  (gate2 sectorCycle 대부분 SHADOW_ONLY/missing) 실현 점수는 작다. ADR-0600/0601 섹터 hydration 이
  성숙하며 점진 증가 — 천장은 열되 데이터가 채우는 구조.
- 섹터상대만 소비 → RELATIVE_STRENGTH 와 이중계상 없음. UNKNOWN/결손은 bearish 아님.

## Activation 기준 (운영자)

`/scan_blockers_gate1` 의 D5 표본 성숙 후 (ADR-0471 freeze rule) — 70+ 밴드 forward winRate 가
60~65 밴드보다 유의하게 높으면 70 임계가 옳음을 입증 → flag ON 으로 capacity 복원이 정당.
디커플/표본 부족 시 OFF 유지.

## Rollback

`GATE1_SECTOR_RS_COMPONENT_ENABLED` 미설정/false (기본) → 1줄 롤백, 스코어러 byte-equivalent.

## References

- ADR-0467(advisory 분류 — 본 컴포넌트를 maxScore:0 으로 주차한 출처) · ADR-0469(penalty/이중계상 dedup) ·
  ADR-0471(Gate1 calibration freeze — D5 evidence 선행) · ADR-0546(regime-aware threshold shadow) ·
  ADR-0578(Gate1 기술지표 주입 — phased flag·executionImpact≠NONE 선례) · `minimumSignalScoreTrace.ts`
