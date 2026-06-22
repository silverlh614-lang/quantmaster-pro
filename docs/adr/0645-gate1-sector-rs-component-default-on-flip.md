# ADR-0645 — Gate1 SECTOR_RS 컴포넌트 default-ON flip — `isGate1SectorRsComponentEnabled` `=== 'true'` → `!== 'false'`

@responsibility ADR-0644(safe-lever 3종 flip)가 남긴 마지막 Gate1 점수개선 lever(0611 SECTOR_RELATIVE_STRENGTH 컴포넌트 재활성)의 코드 default 를 OFF→ON 으로 flip 하는 경계·정책·SSOT 계약 SSOT — `minimumSignalScoreTrace.ts` 의 `isGate1SectorRsComponentEnabled` ENV 비교를 `=== 'true'`(default OFF)에서 `!== 'false'`(default ON, explicit `=false` kill-switch 보존)로 전환. requiredScore=70 리터럴·ADR-0471 weighted curve FREEZE·9대 불변식 무위반·현 engineMode=SHADOW_ONLY live 주문 0 안전창.

- **Status:** Accepted (운영자 silverlh614 "과감하게 default on — 점수 개선 4종(0611/0613/0627/0640)" 명시 승인. ADR-0644 가 safe-lever 3종(0613/0627/0640)을 flip 했고, 본 ADR 은 운영자 의도의 마지막 1종(0611)을 충족한다.)
- **Date:** 2026-06-22
- **Branch:** claude/gate1-scoring-analysis-gr9y33
- **Supersedes / Extends:** ADR-0644(safe-lever default-ON flip — 본 ADR 이 동일 패턴으로 마지막 점수개선 lever 0611 을 flip)·ADR-0611(SECTOR_RS 재활성 — 본 ADR 이 그 "운영자 flip" 단계를 충족)·ADR-0467(positive component 회계·requiredScore=70 calibration SSOT)·ADR-0471(live weighted curve FREEZE — 절대 보존)·ADR-0641(flag-lifecycle governance — 본 ADR 이 0611 status SHADOW_OFF→ON flip)·ADR-0157(ENV 정확 비교 — opt-IN `=== 'true'` 의 거울 대칭 opt-OUT `!== 'false'`)·ADR-0146(byte-equivalent·ENV 1줄 롤백)·ADR-0530(Patch Scope Guard)
- **Patch vs ADR:** ADR (신규 정책 — default OFF→ON flip = ENV 계약 변경, flag-lifecycle status 전환). INDEX.md 0645→0646 갱신 의무.

---

## Context

ADR-0641 거버넌스가 제도화한 "flip 강제" 메커니즘에 따라, Gate1 점수개선 default-OFF lever 들을 운영자 승인 하에 flip 하는 작업의 마지막 조각이다.

- ADR-0644 가 safe-lever **3종**(`GATE1_POSITIVE_CEILING_WIRING_ENABLED` 0613 · `GATE1_RS_PERCENTILE_CONTINUOUS_ENABLED` 0627 · `GATE1_DENOMINATOR_NORMALIZATION_ENABLED` 0640)을 `=== 'true'`→`!== 'false'` 로 flip 했다.
- 그러나 운영자가 승인한 "점수 개선 4종"의 **4번째**인 `GATE1_SECTOR_RS_COMPONENT_ENABLED`(ADR-0611)는 ADR-0644 범위에 포함되지 않아 여전히 default OFF(`=== 'true'`) 였다.
- 본 ADR 이 그 마지막 lever 를 동일 패턴으로 flip 해 운영자 의도(4종 전부 default ON)를 완성한다.

배경 문제(ADR-0611): SECTOR_RELATIVE_STRENGTH 는 ADR-0467 에서 advisory-only(maxScore 0)로 주차됐는데, 그 결과 활성 maxScore 합(108)이 requiredScore=70 이 calibrate 된 configuredPositiveMax(116)보다 8점 낮아 상위 8점이 영구 도달 불가가 됐다. flag ON 은 그 8점 capacity 를 복원한다.

## Decision

**D1.** `server/trading/signalScanner/minimumSignalScoreTrace.ts` 의 `isGate1SectorRsComponentEnabled` ENV 비교를 `=== 'true'`(default OFF) → `!== 'false'`(default ON)로 전환. 미설정/임의값 → ON, 정확히 `'false'` 만 OFF(ADR-0157 opt-IN 의 거울 대칭, explicit kill-switch 한정).

**D2.** flag ON 의미론은 ADR-0611 그대로: 섹터상대수익(stock − sector 20d)만 소비(RS 시장상대와 이중계상 회피), 입력 부재 시 weightedScore 0 graceful(maxScore 8 은 denominator 만 — 결손≠페널티, 불변식 #6). requiredScore=70·weightedScore 곡선 무변경.

**D3.** flag-lifecycle 레지스트리(`scripts/gate_flag_lifecycle.json`)의 0611 status SHADOW_OFF→ON(ADR-0641 거버넌스 flip 충족). `docs/ai/gate-flag-lifecycle.md` 해설표·`.env.example` 정합.

**D4.** requiredScore=70 리터럴 불변·weighted curve FREEZE(ADR-0471)·`isGate1PositiveMaxNormalizationEnabled`(ADR-0643 16/16 과개방) default OFF 유지·9대 불변식 무위반·현 engineMode=SHADOW_ONLY 라 live 주문 0 안전창(#8 실거래 차단 ≠ Shadow 차단). explicit `GATE1_SECTOR_RS_COMPONENT_ENABLED=false` 1줄 즉시 byte-equivalent 롤백.

## Consequences

- **executionImpact:** gate1-scoring-adjacent — 섹터상대 입력 보유 종목의 Gate1 점수가 최대 +8 상승(통과 분포 상승 가능). 현 SHADOW_ONLY 라 live 주문 0줄. autoTradeEngine/kisClient/order/SourceSnapshot 0줄·신규 fetch 0.
- **byte-identical 깨짐(의도적 behavior change):** 기존 "default OFF byte-equivalent" 단언 테스트는 explicit `=false` pin 으로 의도 보존(단언 약화 0).
- **Rollback:** `GATE1_SECTOR_RS_COMPONENT_ENABLED=false` ENV 1줄 → maxScore 0·weightedScore 0 byte-equivalent 복귀.

## ADR-0146 PR 자가 review (5 카테고리)

1. **LIVE 매매 안전성** — requiredScore=70 SSOT·weighted curve FREEZE 무접촉·KIS/KRX quota 0·신규 fetch 0·현 SHADOW_ONLY live 0줄·ENV `=false` 1줄 롤백.
2. **wiring 완료 vs 인프라만** — reader default 1줄 flip + lifecycle status + 문서 정합. 죽은 OFF 분기는 ENV 롤백 보존 위해 유지(ADR-0641 D4 후속 정리 대상).
3. **ADR 발급 무결성** — INDEX 다음 발급 0645→0646, 표 0645 행, 최대 발급 0645. 단일 발급 통로 준수.
4. **회귀 테스트 적정성** — 0611 test: default(미설정)=ON·explicit `=false`=OFF·`'1'/'TRUE'/'yes'/'on'`=ON 3-케이스 + actualScore OFF(`=false`) 대비 상승. 0466 legacy baseline 무회귀(SECTOR_RS default ON 하에서 통과 확인).
5. **정책 위반 baseline 무회귀** — Yahoo-first 0·SourceSnapshot 우회 0·silent catch 0·복잡도 무관(reader 1줄)·9대 불변식 무위반.

## Patch Scope Guard (ADR-530)

- **targetDomain:** gate1-scoring (1 도메인).
- **allowedFiles:** `server/trading/signalScanner/minimumSignalScoreTrace.ts`(reader 1줄) · `server/trading/signalScanner/minimumSignalScoreSectorRsAdr0611.test.ts` · `.env.example`(0611 주석) · `scripts/gate_flag_lifecycle.json`(0611 status) · `docs/ai/gate-flag-lifecycle.md` · `docs/adr/0645-*.md`(신규) · `docs/adr/INDEX.md` · `docs/ai/10-patch-history-index.md`.
- **forbiddenFiles:** autoTradeEngine · kisClient · SourceSnapshot 생성기 · weightedScore 곡선/componentScorers · requiredScore=70 calibration SSOT · `isGate1PositiveMaxNormalizationEnabled`(OFF 유지) · `src/**`.
- **expectedBehaviorChange:** 섹터상대 입력 종목 Gate1 점수 +최대 8(통과 분포 상승). **sourceSnapshotImpact:** 없음. **executionImpact:** gate1-scoring-adjacent(현 SHADOW_ONLY live 0). **shadowLearningImpact:** 점수 분포 상승(정상). **telegramImpact:** /scan_blockers 점수 표시 상승. **providerImpact:** 없음(신규 fetch 0). **testsRequired:** 0611 3-케이스 + 0466 baseline 무회귀. **rollbackPlan:** ENV `=false` 1줄.

## Alternatives 기각

- Railway ENV `=true` 수동설정 유지 → 운영자 "코드 default flip" 의도 미충족·무덤 안티패턴 잔존.
- 하드코딩 ON(ENV 게이트 제거) → kill-switch 상실(ADR-0146 롤백 위반).
- POSITIVE_MAX 동반 ON → 16/16 과개방(ADR-0643, 범위 외).
- ADR-0644 에 병합 재발급 → 이미 머지됨, 신규 발급이 단일 통로 정합.

## References

ADR-0644 · 0611 · 0467 · 0471 · 0641 · 0643 · 0157 · 0146 · 0530.
