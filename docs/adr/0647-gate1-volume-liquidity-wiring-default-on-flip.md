# ADR-0647 — Gate1 VOLUME_LIQUIDITY 배선 default-ON flip — `isGate1VolumeLiquidityWiringEnabled` `=== 'true'` → `!== 'false'`

@responsibility ADR-0646(VOLUME_LIQUIDITY 배선 수리, default OFF)가 복원한 Gate1 VOLUME_LIQUIDITY 입력 배선의 코드 default 를 OFF→ON 으로 flip 하는 경계·정책·SSOT 계약 SSOT — `gateConfig.ts` 의 `isGate1VolumeLiquidityWiringEnabled` ENV 비교를 `=== 'true'`(default OFF)에서 `!== 'false'`(default ON, explicit `=false` kill-switch 보존)로 전환. 운영자 효과확인(8/24 종목 기여·finalScoreAvg 54.1→59.8·hardPass 1→9) 하 default ON 승격. requiredScore=70 리터럴·ratio 곡선/maxScore 12 무변경·결손 graceful·9대 불변식 무위반·현 engineMode=SHADOW_ONLY live 주문 0 안전창.

- **Status:** Accepted (운영자 silverlh614 ENV `=true` 효과 실측 후 default ON 승격 승인 — VOLUME_LIQUIDITY 가 8/24 종목에서 점수 기여(이전 0), Gate1 finalScoreAvg 54.1→59.8·hardPass 1→9. ADR-0646 이 배선을 수리(default OFF)했고, 본 ADR 은 그 "운영자 효과확인 후 default-ON flip" 단계를 충족한다.)
- **Date:** 2026-06-22
- **Branch:** claude/gate1-volume-liquidity-default-on
- **Supersedes / Extends:** ADR-0646(VOLUME_LIQUIDITY 배선 수리 — 본 ADR 이 그 "운영자 효과확인 후 default-ON flip" Phase 2 를 충족·supersede)·ADR-0645(Gate1 SECTOR_RS default-ON flip — 동일 `=== 'true'`→`!== 'false'` 패턴 직전 선례)·ADR-0644(safe-lever 3종 default-ON flip — opt-OUT 패턴 원형)·ADR-0467(positive component 회계·requiredScore=70 calibration SSOT)·ADR-0471(live weighted curve FREEZE — 절대 보존)·ADR-0641(flag-lifecycle governance — 본 ADR 이 0646 status SHADOW_OFF→ON flip)·ADR-0157(ENV 정확 비교 — opt-IN `=== 'true'` 의 거울 대칭 opt-OUT `!== 'false'`)·ADR-0146(byte-equivalent·ENV 1줄 롤백)·ADR-0530(Patch Scope Guard)
- **Patch vs ADR:** ADR (신규 정책 — default OFF→ON flip = ENV 계약 변경, flag-lifecycle status 전환). INDEX.md 0647→0648 갱신 의무.

---

## Context

ADR-0646 이 VOLUME_LIQUIDITY 컴포넌트의 순수 배선 갭(plain `avgVolume` 경로 미진입 → 카논 raw `avgVolume20d`/`volumeRatio` 보유 종목이 전부 fallback weightedScore 0 = `RAW_AVAILABLE_SCORE_NOT_PROMOTED`)을 수리하되 default OFF(`=== 'true'`)로 출하했다. ADR-0646 D5 단계적 활성화는 "Phase 1: raw volume coverage 확인 + N세션 shadow hypothetical 델타 관측 → Phase 2: 운영자 효과확인 후 ENV ON 또는 default-ON flip(별건 PR)"을 명시했다.

본 ADR 이 그 Phase 2 를 충족한다 — 운영자가 ENV `=true` 로 켜서 효과를 실측했다:

- VOLUME_LIQUIDITY 가 **8/24 종목**에서 점수에 기여했다(배선 수리 전 0).
- Gate1 **finalScoreAvg 54.1 → 59.8**, **hardPass 1 → 9**.
- 저위험 확인 — additive 입력 복원(이미 hydrate 된 카논 raw 재사용)·ratio 곡선/maxScore 12·requiredScore 70 무변경·진짜 결손 종목 0 graceful(결손≠페널티, 불변식 #6).

이는 ADR-0641 거버넌스가 제도화한 "flip 강제" 메커니즘(SHADOW_OFF flag 는 reviewBy 만료 전 flip/sunset/연장 중 하나 강제)에 부합하는, 운영자 효과확인 기반 flip 이다. ADR-0645 가 SECTOR_RS lever 를 `=== 'true'`→`!== 'false'` 로 flip 한 것과 정확히 같은 패턴이다.

## Decision

**D1.** `server/trading/gateConfig.ts` 의 `isGate1VolumeLiquidityWiringEnabled` ENV 비교를 `=== 'true'`(default OFF) → `!== 'false'`(default ON)로 전환. 미설정/임의값 → ON, 정확히 `'false'` 만 OFF(ADR-0157 opt-IN 의 거울 대칭, explicit kill-switch 한정). reader 1줄 변경, OFF=`=false` 1줄. *(`.ts` 구현은 engine-dev 병렬 — 본 architect 산출은 ADR·거버넌스·문서.)*

**D2.** flag ON 의미론은 ADR-0646 그대로: 이미 hydrate 된 카논 raw(`avgVolume20d`/`volumeRatio`)를 기존 ratio 곡선식(maxScore 12)으로 소비해 점수 복원. 신규 fetch 0·신규 공식 0·requiredScore=70 무변경·진짜 결손 종목 0 graceful(weightedScore 0 유지 — 결손≠페널티, 불변식 #6).

**D3.** flag-lifecycle 레지스트리(`scripts/gate_flag_lifecycle.json`)의 0646 status SHADOW_OFF→ON(ADR-0641 거버넌스 flip 충족). `docs/ai/gate-flag-lifecycle.md` burn-down 표·검사상태 문단·`.env.example` 정합.

**D4.** requiredScore=70 리터럴 불변·ratio 곡선/maxScore 12 FREEZE(ADR-0471)·`isGate1PositiveMaxNormalizationEnabled`(ADR-0643 16/16 과개방) default OFF 유지·9대 불변식 무위반·현 engineMode=SHADOW_ONLY 라 live 주문 0 안전창(#8 실거래 차단 ≠ Shadow 차단). explicit `GATE1_VOLUME_LIQUIDITY_WIRING_ENABLED=false` 1줄 즉시 byte-equivalent 롤백.

## Consequences

- **executionImpact:** flag OFF(`=false`)=byte-identical(plain `avgVolume` 경로만·미진입 fallback 0·LIVE 본체 0줄·KIS/KRX quota 0). default ON=gate1-scoring-adjacent(VOLUME_LIQUIDITY 점수 복원 — 운영자 실측 8/24 기여·finalScoreAvg 54.1→59.8·hardPass 1→9·통과 분포 상승). 현 SHADOW_ONLY 라 live 주문 0줄·autoTradeEngine/kisClient/order/SourceSnapshot 0줄·신규 fetch 0.
- **byte-identical 깨짐(의도적 behavior change):** 기존 "default OFF byte-equivalent" 단언 테스트는 explicit `=false` pin 으로 의도 보존(단언 약화 0). shadow hypothetical 은 flag 무관 force-ON 으로 변동 없음.
- **Rollback:** `GATE1_VOLUME_LIQUIDITY_WIRING_ENABLED=false` ENV 1줄 → plain `avgVolume` 경로만·미진입 fallback 0 byte-equivalent 복귀.

## ADR-0146 PR 자가 review (5 카테고리)

1. **LIVE 매매 안전성** — requiredScore=70 SSOT·ratio 곡선/maxScore 12 FREEZE 무접촉·KIS/KRX quota 0·신규 fetch 0·현 SHADOW_ONLY live 0줄·ENV `=false` 1줄 롤백. 운영자 ENV `=true` 효과 실측(8/24 기여·avg 54.1→59.8) 후 승격.
2. **wiring 완료 vs 인프라만** — reader default 1줄 flip(engine-dev) + lifecycle status + 문서 정합. ADR-0646 이 이미 LIVE 경로 배선 완료, 본 ADR 은 default 만 전환(인프라만 두지 않음). 죽은 OFF 분기는 ENV 롤백 보존 위해 유지(ADR-0641 D4 후속 정리 대상).
3. **ADR 발급 무결성** — INDEX 다음 발급 0647→0648, 표 0647 행, 최대 발급 0647. 단일 발급 통로 준수.
4. **회귀 테스트 적정성** — 0646 test: default(미설정)=ON·explicit `=false`=OFF·`'1'/'TRUE'/'yes'/'on'`=ON 3-케이스 + actualScore OFF(`=false`) 대비 복원. ADR-0646 신규 12 + signalScanner 무회귀 baseline 유지(VOLUME_LIQUIDITY default ON 하에서 통과 확인). *(테스트 구현은 engine-dev 병렬.)*
5. **정책 위반 baseline 무회귀** — Yahoo-first 0(입력은 KIS/KRX L1 파생 avgVolume20d/volumeRatio)·SourceSnapshot 우회 0·silent catch 0·복잡도 무관(reader 1줄)·9대 불변식 무위반.

## Patch Scope Guard (ADR-530)

- **targetDomain:** gate1-scoring (1 도메인).
- **allowedFiles:** `server/trading/gateConfig.ts`(reader 1줄, engine-dev) · `server/trading/signalScanner/*VolumeLiquidity*.test.ts`(engine-dev) · `.env.example`(0646 flag 주석) · `scripts/gate_flag_lifecycle.json`(0646 status) · `docs/ai/gate-flag-lifecycle.md` · `docs/adr/0647-*.md`(신규) · `docs/adr/INDEX.md` · `docs/ai/10-patch-history-index.md`.
- **forbiddenFiles:** autoTradeEngine · buyPipeline · kisClient · SourceSnapshot 생성기 · ratio 곡선/maxScore 12/componentScorers volumeLiquidityScore 산식 · requiredScore=70 calibration SSOT · minimumSignalScoreTrace 판정 라인 · `isGate1PositiveMaxNormalizationEnabled`(OFF 유지) · `src/**`.
- **expectedBehaviorChange:** VOLUME_LIQUIDITY 카논 raw 입력 종목 Gate1 점수 복원(실측 8/24 기여·통과 분포 상승). **sourceSnapshotImpact:** 없음(trace 입력만 소비). **executionImpact:** flag OFF=NONE byte-identical / default ON=gate1-scoring-adjacent(현 SHADOW_ONLY live 0). **shadowLearningImpact:** 점수 분포 상승(정상)·shadow hypothetical force-ON 변동 없음. **telegramImpact:** /scan_blockers 점수 표시 상승. **providerImpact:** 없음(신규 fetch 0·이미 hydrate 된 avgVolume20d/volumeRatio 재사용·KIS/KRX quota 0). **testsRequired:** 0646 3-케이스 + signalScanner baseline 무회귀(engine-dev). **rollbackPlan:** ENV `=false` 1줄.

## Alternatives Considered

1. **Railway ENV `=true` 수동설정 유지** — 기각. 운영자 "코드 default flip" 의도 미충족·무덤 안티패턴 잔존(ADR-0641 D4). 효과 실측이 끝났으므로 default 전환이 정도.
2. **하드코딩 ON(ENV 게이트 제거)** — 기각. kill-switch 상실(ADR-0146 롤백 위반). `!== 'false'` 가 default ON + explicit `=false` 1줄 롤백을 동시 보존.
3. **POSITIVE_MAX 동반 ON** — 기각. 16/16 과개방(ADR-0643, 범위 외·default OFF 유지).
4. **requiredScore 70 동시 하향** — 기각(절대 보존, ADR-0467/0546/0640). 입력 배선 default 전환과 임계 완화는 독립 레버.
5. **ADR-0646 에 병합 재발급** — 기각. 이미 머지됨, 신규 발급이 단일 통로 정합(ADR-0645 가 ADR-0644 에 병합하지 않은 것과 동일).

## 9대 불변식 영향

- **#6 (provider 장애 ≠ market signal):** 위반 없음 — 카논 raw(`avgVolume20d`/`volumeRatio`)도 부재한 진짜 결손 종목은 0 graceful, 결손을 bearish/페널티로 승격하지 않음. default 전환은 입력이 있는 종목의 복원에 한정.
- **#8 (실거래 차단 ≠ Shadow 차단):** 위반 없음 — explicit `=false`=byte-identical, shadow hypothetical 은 flag 무관 force-ON 산출(변동 없음). 현 engineMode=SHADOW_ONLY live 주문 0 안전창에서 flip.

## References

ADR-0646 · 0645 · 0644 · 0467 · 0471 · 0641 · 0157 · 0146 · 0530.
