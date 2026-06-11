# ADR-0599: Gate2 confluence 가용 축 비례 요구 — 결손 축이 STRONG/WEAK 조건을 역설적으로 강화하는 갭 보정 (flag-gated, default OFF)

@responsibility policy — Gate2 STRONG/WEAK 의 절대 개수 조건(bullish ≥3)을 가용 축 비례(ceil 60%, ≤3)로 보정해 데이터 결손이 사실상 페널티로 작동하는 ADR-0416 위배 갭을 봉인 (default OFF byte-equivalent, dry-run 상시 관측)

## Status

Accepted (구현 동반 — default OFF byte-equivalent)

## Context — STRONG 사상 0건의 산술 (2026-06-11 운영 실측 + 코드 추적)

운영: evaluated 43 → strong 0 / weak 0 / watch 10 / fail 17 (+DATA_INCOMPLETE ~16).
축 커버리지: RS 43/43 · Tech 43/43 · Supply 27/43 · Sector 21/43 · Fund 27/43.

판정 SSOT (`gate2ConfluenceScore.ts:672-677`):
- STRONG = coverageAdjustedScore ≥80 **AND bullishAxisCount ≥3 (절대 개수)**
- WEAK = ≥65 AND bullish+accumulating ≥3 · 가용 축 <3 → DATA_INCOMPLETE

결손 축은 **점수에서는** 분모 제외(coverageAdjustedScore — ADR-0416 "결손≠failed" 준수)되지만,
**개수 조건에는 보정이 없다**: 5축 가용이면 3/5(60%) 강세 요구인데, Supply/Sector/Fund 결손으로
3축만 가용이면 **3/3(100%) 강세**가 되어 결손이 요구를 강화한다. BULLISH 컷이 축점수 85+
(RS는 KOSPI 20일 초과수익 +8%p↑, Tech는 정배열)로 높아, 커버리지 50~63% 환경에서 STRONG 은
산술적으로 도달 불가 → **사상 0건**. (커버리지 결손 자체의 1차 원인 — KIS 투자자행 NO_ROW_FOUND,
코스닥 업종지수 매핑 부재, DART 미수신/AI_ESTIMATED 제외(불변식 #7) — 는 provider 개선 별도 과제.)

## Decision

### D1. 비례 요구 SSOT (순수 함수, 동일 파일)

`proportionalRequiredAxisCount(usable) = clamp(ceil(usable × 0.6), 1, 3)` —
5축 가용 시 3 (기존과 동일), 4축 → 3, 3축 → 2. **점수 임계(80/65/50)·BULLISH 컷(85)·
가용 축 ≥3 요구는 전부 불변** — 결손 보정만 하고 기준 자체는 낮추지 않는다.

### D2. flag-gated 적용 + dry-run 상시 관측

- `GATE2_PROPORTIONAL_BULLISH_ENABLED` (정확 비교, **default OFF**): ON 시 STRONG/WEAK 의
  요구 개수만 비례값으로 교체. OFF 시 기존 3 고정 (byte-equivalent).
- **dry-run 은 flag 와 무관하게 항상 산출**: per-result `wouldPassStrongProportional`/
  `wouldPassWeakProportional`/`requiredConfluenceAxisCount` + summary
  `wouldStrongProportional`/`wouldWeakProportional` + `/scan_blockers_gate2` compact 출력
  `proportionalDryRun: strong=N weak=M` 1줄 — 운영자가 효과 크기를 보고 ON 을 결정한다.

### D3. 단계적 활성화 (ADR-0592~0594/0598 phased 선례)

Phase 0(현재): flag OFF, dry-run 수치 관측. Phase 1: N영업일 dry-run STRONG 후보의 forward
성과 counterfactual 대조 (Gate2 counterfactual seed 기존 경로). Phase 2: 운영자 ENV ON (1줄).

## Guardrails

- 점수 임계·축 가중치·BULLISH 컷·DATA_INCOMPLETE(<3축) 무변경. KIS/order/fetch 0.
- AI_ESTIMATED(L4) 축 분모 제외 정책 불변 (불변식 #7). 결손 축을 bullish 로 승격하지 않음 —
  요구 *개수* 만 가용 모집단에 비례.
- flag OFF = 기존 판정 100% 보존 (신규 필드는 additive optional, 표시 1줄은 진단 전용).

## Rollback

ENV 1줄 (`=false`/삭제) — 판정 즉시 복원. dry-run 필드는 관측 전용이라 잔존 무해.

## References

- 2026-06-11 Gate2 추적 (운영 /scan_blockers_gate2 + 커버리지 코드 추적) ·
  `gate2ConfluenceScore.ts:672-677` (판정 SSOT) · ADR-0416 (DATA_UNAVAILABLE≠failed) ·
  ADR-0519 (Gate2 confluence) · ADR-0598/0594/0593/0592 (phased flag 선례) ·
  후속 별도 과제: Supply(KIS 투자자행)·Sector(코스닥 업종지수)·Fund(DART) 커버리지 개선
