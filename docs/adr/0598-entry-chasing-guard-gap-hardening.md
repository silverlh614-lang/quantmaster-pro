# ADR-0598: 과열 추격 가드 갭 봉인 — FOMO 쿨다운 진입 시점 재평가(G1) + Gate3 이격 검증불가 보수화(G2) (flag-gated, default OFF)

@responsibility policy — 유진테크 추적(2026-06-11)에서 확정된 추격 가드 2개 갭(등록 시점 1회 평가·MA20 결손 시 가드 무력화)을 ENV flag 게이트로 봉인 (default OFF byte-equivalent, live 진입만 보수화, shadow 무영향)

## Status

Accepted (구현 동반 — default OFF byte-equivalent)

## Context — 유진테크(084370) shadow 매수 추적에서 확정된 갭 2건

2026-06-11, 5일 +15%↑·MA20 이격 ~14% 추정 자리의 shadow 매수가 관측됐다. 코드 추적 결과
shadow 생성 자체는 불변식 #8의 의도된 동작(`gate3LastTrigger.ts` 전 분기
`shadowObservableAllowed=true`, OVEREXTENDED 는 live 만 차단)이나, **live 경로의 추격 가드에
구조 갭 2건**이 확인됐다:

- **G1 — FOMO 쿨다운의 시점 갭:** `evaluateRegretAsymmetry`(5거래일 +15% 초과 → 48h 쿨다운)는
  **워치리스트 등록 시점 1회만** 평가된다 (`universeScanner.ts:780`). 진입 시점의
  `entryGates/cooldownGate.ts` 는 기존 `cooldownUntil` 필드 유무만 보고 현재 5일 수익률을
  재평가하지 않는다 → 급등 전에 등록된 종목은 진입 순간 +20% 여도 쿨다운 미발동.
  Gate3 이격 가드가 2차 방어하지만 "이격 <12% 저변동 점진 급등"은 두 가드 사이를 통과한다.
- **G2 — MA20 결손 시 가드 무력화 (역설 구조):** `gate3PriceConfirmation.ts` 는 `ma20=null`
  이면 이격(≥12%)·3ATR 체크가 모두 단락(short-circuit)되고, `high20d` 만 있으면
  `BREAKOUT_CONFIRMED` → `priceReady=true` → **live 매수 허용**. 과확장일수록 신고가 돌파
  조건은 자동 충족되므로, **데이터 결손이 곧 통과**가 되는 위험 경로다.

## Decision

### D1 (G1). cooldownGate 진입 시점 재평가 — `REGRET_ENTRY_REEVALUATION_ENABLED` (default OFF)

`entryGates/cooldownGate.ts` 의 `cooldownUntil` 미설정 분기에서 `stock.symbolFeatures.return5d`
(ADR-0578 주입, % 단위 — `universeScanner` 등록 시 평가와 동일 입력 계열)를 재평가:

- flag ON + `return5d > FOMO_SURGE_THRESHOLD_PCT(15)` → `evaluateRegretAsymmetry` 로 쿨다운
  신규 stamp (`cooldownUntil`/`recentHigh` + `watchlistMutated`) 후 차단 — 기존 쿨다운과 동일
  의미론(되돌림 -5~-8% 또는 48h 후 해제).
- flag OFF (default) → stamp·차단 없이 `[REGRET_ENTRY_REEVAL_OBSERVE]` 1줄 로그만
  (would-cooldown 빈도 관측, Phase 0). 기존 동작 100% 보존.
- `return5d` 결손/비유한 → 재평가 skip (결손 ≠ 추격 신호 — 불변식 #6, 쿨다운 미발동).

### D2 (G2). Gate3 이격 검증불가 보수화 — `GATE3_EXTENSION_GUARD_STRICT_ENABLED` (default OFF)

`gate3PriceConfirmation.ts` 의 `BREAKOUT_CONFIRMED` 분기에서 `ma20=null`(이격·3ATR 검증 불가)이면:

- flag ON → `BREAKOUT_CONFIRMED` 를 부여하지 않고 `NOT_CONFIRMED` +
  `BREAKOUT_EXTENSION_UNVERIFIABLE_MA20_MISSING_STRICT_BLOCK` note → `priceReady=false` →
  live 매수 차단. **status union 신규값 없음** (다운스트림 타입 무변경).
- flag OFF (default) → 기존대로 `BREAKOUT_CONFIRMED` 유지 + `EXTENSION_UNVERIFIABLE_MA20_MISSING_OBSERVE`
  note + `missingFields: ['ma20']` 진단만 (관측 Phase 0).
- shadow 무영향 — `NOT_CONFIRMED` 도 `shadowObservableAllowed=true` (불변식 #8 보존).

### D3. 단계적 활성화 (ADR-0592/0593/0594 phased 선례)

Phase 0(현재): 두 flag OFF — observe 로그/note 로 발동 빈도 수집.
Phase 1: 운영자가 관측 빈도·counterfactual(GATE3_BLOCKED_OVEREXTENDED 라벨 forward 성과) 확인.
Phase 2: 운영자 ENV ON (각 1줄, 독립 활성화 가능).

## Guardrails

- No Gate1/requiredScore/condition weight change. No KIS/order import (fetch 0, quota 0).
- **Shadow 차단 확장 주의 (G1):** 기존 cooldownGate 는 쿨다운 종목을 live·shadow 공통 차단한다
  (등록 시점 stamp 와 동일 의미론). flag ON 시 신규 stamp 도 같은 의미론을 따른다 — 기존
  cooldown semantics 의 시점 확장이지 신규 차단 종류가 아니다.
- 결손은 신호가 아니다 — return5d/ma20 결손 시 G1 은 미발동(통과), G2 는 flag ON 일 때만
  "검증 불가 = 미확정" 보수 처리 (결손을 bearish 로 변환하지 않음, NOT_CONFIRMED 는 WAIT 의미).
- flag OFF = byte-equivalent (G2 의 진단 note/missingFields 추가는 표시 전용).

## Rollback

ENV 2개 각각 `=false`/삭제 1줄 (독립 롤백). flag OFF = 기존 동작 100%.

## References

- 유진테크 추적 (2026-06-11 세션) · `docs/gate1-scoring-review-20260611.md`
- `server/trading/regretAsymmetryFilter.ts` (ADR-0030 FOMO 필터 SSOT) ·
  `entryGates/cooldownGate.ts` · `server/quant/gate3PriceConfirmation.ts:100-118` ·
  `gate3LastTrigger.ts:375` (priceReady=BREAKOUT_CONFIRMED 한정) ·
  `universeScanner.ts:780` (등록 시점 1회 평가)
- ADR-0592/0593/0594 (phased flag 선례) · ADR-0146 (byte-equivalent) · 불변식 #6/#8
