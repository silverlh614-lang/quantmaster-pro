# ADR Index — QuantMaster Pro

@responsibility ADR 번호 발급 SSOT — 충돌·누락 추적, 다음 발급 번호 단일 출처.

본 인덱스는 `docs/adr/*.md` 의 단일 발급 통로. 신규 ADR 작성 시 본 파일의 *다음 발급 번호* 만 사용하고, 작성 직후 본 파일에 한 줄 추가.

## 발급 룰

1. **다음 발급 번호** — 본 인덱스 §"다음 발급" 섹션의 정수값. 신규 ADR 의 파일명 prefix 는 정확히 그 값.
2. **번호 충돌 금지** — 동일 번호 ADR 파일이 ≥2건이면 발급 결함. 신규 ADR 작성 전 반드시 본 인덱스 갱신 (충돌 회피).
3. **건너뛰기 금지** — 누락된 번호는 §"누락 (Gap)" 에 기록만, 재사용 금지 (git history 추적성 보존).
4. **PR 머지 후** — CLAUDE.md "변경 이력" 추가 + 본 인덱스 §"전체 인덱스" 한 줄 추가 동시 의무.
5. **ADR 번호 = 1회 발급** — 머지된 ADR 의 번호 변경 금지 (외부 참조·git diff 무결성).

## 다음 발급

**다음 ADR 번호: `0416`**

(2026-05-06 기준, 마지막 발급 0415 — SectorEnergy STALE + PARTIAL_VOLUME STRONG_BUY 차단 격상 본 PR 등재 완료. ADR-0414 (Price Integrity Checker + Correction Overlay Stage 1 Read-Only Mode) 등재 완료. ADR-0413 (Stock Master 저녁 갱신 Cron) 등재 완료. ADR-0412 (Frozen Quote Detector + Holiday-Aware R3 Streak Guard) 등재 완료. fast-iteration 세션 commit-label ADR (0402~0411 범위) §"전체 인덱스" 미등재 — 별도 retrofit PR 작업 대상. ADR-0401 (R3 Sanity Violation State Machine) 등재 완료. 누락 47개 — 0062/0063/0089/0105/0106/0143/0196~0210/0212~0220/0222~0230/0232~0233/0236/0238~0240/0243~0244/0246~0247/0253~0254/0257. 충돌 그룹 11개 (0146/0147/0168 — 별칭 0146a/b·0147a/b·0168a/b 부여, ADR-0159 정합))

**세션 2026-05-06 (#622~#634, #655~#658)**: fast iteration 으로 0211~0260 + 0387~0390 범위가 commit message 라벨로 등재. 본 INDEX.md §"전체 인덱스" 미등재 — 별도 retrofit PR 작업 대상. ADR-0391 (본 PR) 은 §"전체 인덱스" 등재 의무 유지.
**포기 결정 (회귀 위험 큼)**: ADR-0253 (Yahoo→KIS 시계열 합성), ADR-0254 (점심 회로 절전 — ADR-0237 와 책임 중복). DECIDED_NOT_WIRING 영구 — 누락 처리.

## 알려진 충돌 (Known Conflicts)

머지된 ADR 들의 번호 중복. 향후 신규 발급 시 본 인덱스 검증으로 영구 차단. 기존 ADR 번호 변경은 git diff·외부 참조 무결성 보호를 위해 *금지* — 본 표가 단일 진실 출처.

**별칭 정책 (ADR-0159, 2026-05-02 도입)** — 충돌 ADR 인용 시 *별칭 사용 권장* (예: `ADR-0028a` exitEngine 분해 / `ADR-0028b` rejection-universe-tracker / `ADR-0028c` ui-redesign-p0). 비충돌 ADR 은 기존 형식 그대로 (예: `ADR-0085`). 별칭 부여 기준 — 동일 그룹 내 PR 머지 시점 오름차순 (a → b → c). 강제 검증 default OFF (회귀 위험 격리, 6개월 운영 후 활성화 검토).

| 번호 | 별칭 | 파일 | 의도 도메인 | PR / 머지 시점 | 비고 |
|------|------|------|-------------|----------------|------|
| 0028 | **0028a** | `0028-exitEngine-decomposition.md` | exitEngine 분해 (P2) | PR-53 (2026-04-26) | 절대 규칙 #6 (1500줄) |
| 0028 | **0028b** | `0028-rejection-universe-tracker.md` | 거절 종목 사후 추적 | PR-L (2026-04-26) | 자기학습 시리즈 |
| 0028 | **0028c** | `0028-ui-redesign-p0-banners-badges-cards.md` | UI P0-A 배너/배지/카드 | PR-A (2026-04-26) | UI 재설계 |
| 0029 | **0029a** | `0029-condition-source-tier-and-recommendation-history.md` | UI P0-B 조건 출처 + 이력 | PR-B (2026-04-26) | UI 재설계 |
| 0029 | **0029b** | `0029-counterfactual-twin-portfolio.md` | Twin Portfolio Ranking | PR-M (2026-04-26) | 자기학습 시리즈 |
| 0029 | **0029c** | `0029-stockScreener-decomposition.md` | stockScreener 분해 (P1) | PR-55 (2026-04-26) | 절대 규칙 #6 |
| 0030 | **0030a** | `0030-latent-signal-scorer.md` | VCP + Catalyst 사전 신호 | PR-N (2026-04-26) | 자기학습 시리즈 |
| 0030 | **0030b** | `0030-price-alert-watcher.md` | UI P0-C Web Notification | PR-C (2026-04-26) | UI 재설계 |
| 0030 | **0030c** | `0030-signalScanner-entry-gates-phase-b.md` | EntryGate Chain Phase B | PR-57 (2026-04-26) | signalScanner 분해 |
| 0031 | **0031a** | `0031-last-trigger-enemy-tranche-cards.md` | Last Trigger + Enemy Card | PR-D (2026-04-26) | UI 재설계 |
| 0031 | **0031b** | `0031-order-type-optimizer.md` | 슬리피지 학습 + 주문 타입 | PR-O (2026-04-26) | 자기학습 시리즈 |
| 0031 | **0031c** | `0031-signalScanner-revalidation-and-sizing-patterns.md` | RevalidationStep 패턴 | PR-59 (2026-04-26) | signalScanner 분해 |
| 0032 | **0032a** | `0032-sector-rotation-heatmap.md` | UI P1-E 섹터 히트맵 | PR-E (2026-04-26) | UI 재설계 |
| 0032 | **0032b** | `0032-self-learning-series-overview.md` | 자기학습 시리즈 통합 SSOT | PR-P (2026-04-26) | 자기학습 시리즈 |
| 0067 | **0067a** | `0067-multi-timeframe-confluence-gate.md` | MTF Confluence Gate | PR-Q (2026-04-26) | EntryGate Phase B |
| 0067 | **0067b** | `0067-marketoverview-boundary-guard.md` | MarketOverview boundary lint | PR-α 후속 (2026-04-27) | 데이터 안정성 |
| 0068 | **0068a** | `0068-macrostate-stale-block.md` | macroState stale 차단 | PR-α 후속 (2026-04-27) | 데이터 안정성 |
| 0068 | **0068b** | `0068-shadow-learning-hooks-wiring.md` | Rejection + Twin wiring | PR-R (2026-04-28) | 자기학습 시리즈 |
| 0124 | **0124a** | `0124-regime-coverage-suggest-false-positive.md` | regimeCoverage 표본 임계 | (날짜 추가 필요) | 학습 시그널 정합 |
| 0124 | **0124b** | `0124-telegram-reports-be-visibility.md` | 텔레그램 리포트 BE 표기 | PR-ADR-0124 (2026-04-30) | BE 정합 |
| 0146 | **0146a** | `0146-pr-pace-audit-rule.md` | 10-PR audit 룰 + 자가 review 체크리스트 | PR-Governance-3 (2026-05-01) | 거버넌스 |
| 0146 | **0146b** | `0146-telegram-sanity-unlock-cmd.md` | `/sanity` 텔레그램 명령 R3 Block 즉시 해제 | (2026-05-03) | 운영 명령어 |
| 0147 | **0147a** | `0147-kis-token-disk-persistence.md` | KIS 토큰 디스크 영속 (재부팅 OAuth2 차단) | (2026-05-01) | 인프라 |
| 0147 | **0147b** | `0147-signalScanner-orchestration-migration.md` | signalScanner Phase 3 6단계 오케스트레이터 승격 | (2026-05-03) | 리팩토링 |
| 0168 | **0168a** | `0168-kelly-clamp-ssot.md` | Kelly clamp 수치 정책 SSOT | PR-Kelly-Clamp-SSOT (2026-05-02) | 사이징 |
| 0168 | **0168b** | `0168-emergency-data-quality-circuit-breaker.md` | Emergency Data Quality Circuit Breaker | (2026-05-03~05-05) | 데이터 안전 |

**충돌 그룹 11개 / 충돌 ADR 26개 (별칭 26건 부여, ADR-0159)**. 향후 신규 발급은 §"다음 발급" 번호 사용 → 충돌 0건 유지.

## 누락 (Gap)

미사용 번호 — 발급 실수·rebase 충돌 회피 누락. *재사용 금지* (git history 추적성 보호).

| 번호 | 사유 (추정) |
|------|-------------|
| 0062 | rebase 충돌 회피 (main #380 ADR-0061 vs 본 시리즈 0064~0066 그룹 재할당) |
| 0063 | 동일 |
| 0089 | 누락 원인 불명 (후속 audit 가능) |
| 0105 | UI Phase 시리즈 stack rebase 시 누락 |
| 0106 | 동일 |
| 0143 | KIS GitHub 검증 PR rebase 시 누락 (0144/0145 그룹) |
| 0196~0210 | 세션 2026-05-06 fast iteration — commit message 가 0211 부터 시작, INDEX.md 등재 안 됨 |
| 0212~0220 | 동일 (0211 다음 0221 점프) |
| 0222~0230 | 동일 (0221 다음 0231 점프) |
| 0232~0233 | 동일 (0231 다음 0234) |
| 0236 | 동일 (0235 다음 0237) |
| 0238~0240 | 동일 (0237 다음 0241) |
| 0243~0244 | 동일 (0242 다음 0245) |
| 0246~0247 | 동일 (0245 다음 0248) |
| 0253 | **포기 결정** — Yahoo→KIS 시계열 합성 (회귀 위험 큼, DECIDED_NOT_WIRING) |
| 0254 | **포기 결정** — 점심 회로 절전 (ADR-0237 와 책임 중복, DECIDED_NOT_WIRING) |
| 0257 | 세션 fast iteration — commit message 가 0258 점프 |

총 누락 47개 (기존 6 + 세션 2026-05-06 41). 번호 재사용 금지 (git history 추적성 보호).

## 전체 인덱스

| 번호 | 제목 | 도메인 |
|------|------|--------|
| 0001 | signalScanner-decomposition | refactor |
| 0002 | test-colocation | infra |
| 0003 | legacy-warn-backlog | infra |
| 0004 | yahoo-adr-deprecation | data |
| 0005 | strong-buy-and-telegram-trim | trading |
| 0006 | attribution-composite-key | learning |
| 0007 | learning-feedback-loop-policy | learning |
| 0008 | kelly-time-decay-wiring | trading |
| 0009 | external-data-call-budget | data |
| 0010 | external-call-budget-hardening | data |
| 0011 | ai-recommendation-source-split | data |
| 0012 | search-page-market-context-consolidation | ui |
| 0013 | multi-source-stock-master | data |
| 0014 | kis-retry-safety-policy | trading |
| 0015 | reconciliation-source-priority | trading |
| 0016 | weekend-ai-universe-fallback | data |
| 0017 | telegram-meta-commands-stage1 | telegram |
| 0018 | self-learning-data-integrity | learning |
| 0019 | recommendation-snapshot-lifecycle | learning |
| 0020 | source-weighted-learning | learning |
| 0021 | loss-reason-tagging | learning |
| 0022 | loss-reason-weighted-learning | learning |
| 0023 | condition-profit-factor-edge-score | learning |
| 0024 | regime-memory-bank | learning |
| 0025 | loss-reason-manual-override | learning |
| 0026 | attribution-classifier | learning |
| 0027 | learning-shadow-model | learning |
| 0028 | exitEngine-decomposition / rejection-universe-tracker / ui-redesign-p0 | conflict ×3 |
| 0029 | condition-source-tier / counterfactual-twin / stockScreener-decomposition | conflict ×3 |
| 0030 | latent-signal-scorer / price-alert-watcher / signalScanner-entry-gates-phase-b | conflict ×3 |
| 0031 | last-trigger-enemy-tranche / order-type-optimizer / signalScanner-revalidation | conflict ×3 |
| 0032 | sector-rotation-heatmap / self-learning-series-overview | conflict ×2 |
| 0033 | candidate-pipeline-visualization | ui |
| 0034 | macro-intelligence-and-history-extensions | ui |
| 0035 | attribution-and-correlation | learning |
| 0036 | budget-policy-extraction | trading |
| 0037 | alert-router-vibration-policy | telegram |
| 0038 | private-vs-channel-separation | telegram |
| 0039 | telegram-callsite-migration | telegram |
| 0040 | macro-digest-cron | telegram |
| 0041 | weekly-self-critique-report | telegram |
| 0042 | channel-test-and-stop-countdown | telegram |
| 0043 | market-day-classifier-and-schedule-guard | infra |
| 0044 | holiday-resume-policy | trading |
| 0045 | krx-holiday-annual-audit | infra |
| 0046 | f2w-drift-detector | learning |
| 0047 | reflection-module-halflife | learning |
| 0048 | learning-coverage-heatmap | learning |
| 0049 | context-adaptive-auto-trade-layout | ui |
| 0050 | account-survival-gauge | ui |
| 0051 | invalidation-meter | ui |
| 0052 | one-decision-resolver | ui |
| 0053 | nightly-reflection-card | ui |
| 0054 | concordance-matrix | ui |
| 0055 | gate-mini-indicator | ui |
| 0056 | yahoo-probe-resilience | data |
| 0057 | fomc-policy-v4 | trading |
| 0058 | egressguard-intent-tags | data |
| 0059 | safe-pct-change-helper | infra |
| 0060 | shadow-trade-sector-persistence | trading |
| 0061 | fomc-day-liquidation | trading |
| **0062** | *(누락)* | — |
| **0063** | *(누락)* | — |
| 0064 | market-overview-prefill-overlay | data |
| 0065 | market-indicators-snapshot-resilience | data |
| 0066 | market-overview-swr-cache | data |
| 0067 | marketoverview-boundary-guard / multi-timeframe-confluence-gate | conflict ×2 |
| 0068 | macrostate-stale-block / shadow-learning-hooks-wiring | conflict ×2 |
| 0069 | x-field-stale-ui-badge | ui |
| 0070 | market-data-health-score | data |
| 0071 | cross-source-data-validation | data |
| 0072 | entry-circuit-breaker | trading |
| 0073 | regime-holding-period-shortening | trading |
| 0074 | regime-message-live-regime-line | telegram |
| 0075 | sector-score-boost | trading |
| 0076 | fomc-regime-kelly-precedence | trading |
| 0077 | trade-signal-status-state-machine | trading |
| 0078 | enemy-auto-block | trading |
| 0079 | atr-buffered-bep-glide | trading |
| 0080 | capital-weighted-slot-accounting | trading |
| 0081 | preorder-guard-final-gate-ssot | trading |
| 0082 | yahoo-range-restriction-policy | data |
| 0083 | walk-forward-framework-extension | learning |
| 0084 | condition-lifecycle-status-policy | learning |
| 0085 | two-bar-confirmation-and-slot-sizing | trading |
| 0086 | shadow-walk-forward-framework | learning |
| 0087 | shadow-condition-attribution | learning |
| 0088 | shadow-learning-dashboard | ui |
| **0089** | *(누락)* | — |
| 0090 | cache-coherence-auditor | infra |
| 0091 | yahoo-stale-base-fallback | data |
| 0092 | channel-sell-cumulative-remaining-qty | telegram |
| 0093 | gating-alert-dedupe | telegram |
| 0094 | ui-language-ssot | ui |
| 0095 | data-quality-5tier-auto-ladder | ui |
| 0096 | idontknow-and-data-quality-ribbon | ui |
| 0097 | verdict-card-and-time-band | ui |
| 0098 | confluence-meter-and-axis-reason | ui |
| 0099 | ui-verbosity-toggle | ui |
| 0100 | ui-verbosity-toggle-embed | ui |
| 0101 | verdict-card-verbosity-wiring | ui |
| 0102 | confluence-meter-verbosity-wiring | ui |
| 0103 | ribbon-idontknow-verbosity-wiring | ui |
| 0104 | gating-alert-window-and-fomc-liquidation-label | telegram |
| **0105** | *(누락)* | — |
| **0106** | *(누락)* | — |
| 0107 | mhs-axis-and-gate-zero-context | trading |
| 0108 | operator-noise-reduction | telegram |
| 0109 | data-quality-badge-verbosity-wiring | ui |
| 0110 | gate-status-card-verbosity-wiring | ui |
| 0111 | circuit-breaker-baseline-reset | trading |
| 0112 | breakeven-classification-and-circuit-isolation | trading |
| 0113 | yahoo-drift-tiered-sanity-and-corporate-action-detector | data |
| 0114 | data-trust-layer-policy | data |
| 0115 | entry-price-immutable-and-execution-relaxation | trading |
| 0116 | raw-adjusted-price-and-gate3-relaxation-wiring | trading |
| 0117 | sanity-trade-block-gate | data |
| 0118 | scan-blockers-diagnostic-infrastructure | trading |
| 0119 | empty-scan-reason-classification | trading |
| 0120 | gate-pass-counters-and-r3-sanity | trading |
| 0121 | price-source-policy | data |
| 0122 | sector-energy-krx-matching-and-data-quality | trading |
| 0123 | be-isolation-in-learning-and-reports | learning |
| 0124 | regime-coverage-suggest-false-positive / telegram-reports-be-visibility | conflict ×2 |
| 0125 | sector-energy-data-quality-wiring | trading |
| 0126 | price-source-policy-execution-wiring | trading |
| 0127 | scan-summary-sector-energy-quality | trading |
| 0128 | data-verification-timing-and-data-hold-state-machine | data |
| 0129 | mdd-ssot-be-narrative-macro-gate-wiring | learning |
| 0130 | cumulative-reflection-context | learning |
| 0131 | self-health-check-loop | infra |
| 0132 | edge-trigger-scheduler-logging-and-holiday-enter-alert | infra |
| 0133 | file-complexity-gate-integrity | infra |
| 0134 | persymbol-evaluation-decomposition | refactor |
| 0135 | kisclient-decomposition | refactor |
| 0136 | fss-records-age-diagnostic-and-passive-active-null | data |
| 0137 | kis-stock-program-trade-today | data |
| 0138 | kis-market-program-trade | data |
| 0139 | ecos-margin-balance-5d-change | data |
| 0140 | naver-foreigner-ratio-trend | data |
| 0141 | fss-investor-detail-fetcher | data |
| 0142 | fss-passive-active-mapping | data |
| **0143** | *(누락)* | — |
| 0144 | kis-program-trade-endpoint-correction | data |
| 0145 | diagnose-short-macro-state | telegram |
| 0146 | pr-pace-audit-rule | governance |
| 0146 | telegram-sanity-unlock-cmd (별칭 0146b) | telegram |
| 0147 | kis-token-disk-persistence | infra |
| 0147 | signalScanner-orchestration-migration (별칭 0147b) | refactor |
| 0148 | governance-followup-static-checks | governance |
| 0149 | condition-mapping-fix | learning |
| 0150 | phase1-dart-finalize | learning |
| 0151 | phase2-kis-supply-audit | learning |
| 0152 | naver-foreigner-trend-endpoint | learning |
| 0153 | phase3-globalintel-synthesis | learning |
| 0154 | phase4-closeout-and-residual-policy | learning |
| 0155 | krx-investor-trend-endpoint | learning |
| 0156 | yahoo-consensus-endpoint | learning |
| 0157 | feedback-loop-now-injection | learning |
| 0158 | wiring-sla-auto-expiry | governance |
| 0159 | adr-alias-diaspora | governance |
| 0160 | reflection-signal-routing | learning |
| 0161 | position-sizing-engine-tier-based | trading |
| 0162 | position-sizing-engine-shadow-apply | trading |
| 0163 | position-sizing-engine-extension-3-paths | trading |
| 0164 | peak-equity-tracking | trading |
| 0165 | position-sizing-engine-live-activation | trading |
| 0166 | regime-exposure-budget | trading |
| 0167 | current-equity-exposure-accurate | trading |
| 0168 | kelly-clamp-ssot | trading |
| 0168 | emergency-data-quality-circuit-breaker (별칭 0168b) | data |
| 0169 | tranche-executor-exposure-budget-wiring | trading |
| 0170 | exposure-regime-auto-mapping | trading |
| 0171 | sizing-exposure-budget-verbose-log | trading |
| 0172 | sizing-engine-liquidity-sector-real-data | trading |
| 0173 | shadow-learning-on-blocked-days | trading |
| 0174 | safety-gate-attribution-and-shadow-live-delta | learning |
| 0175 | future-return-resolver-cron | learning |
| 0176 | missed-learning-queue-cron-wiring | learning |
| 0177 | learning-sanity-dashboard-endpoint | learning |
| 0178 | learning-sanity-dashboard-ui | learning |
| 0179 | missed-learning-queue-stats-card | learning |
| 0180 | rejected-winners-card | learning |
| 0181 | stale-reflections-card | learning |
| 0182 | unresolved-counterfactuals-card | learning |
| 0183 | shadow-learning-blocked-day-wiring | trading |
| 0184 | emergency-data-quality-guards-wiring-phase-a | dataQuality |
| 0185 | emergency-data-quality-guards-wiring-phase-b | dataQuality |
| 0186 | order-type-optimizer-wiring-phase-1 | trading |
| 0187 | macro-state-dead-read-wiring | persistence |
| 0188 | lint-baseline-cleanup | quality |
| 0189 | premarket-gap-probe-krx-calendar | trading |
| 0190 | safe-pct-change-krx-calendar | trading |
| 0191 | position-truth-ssot-and-shadow-mode-header | persistence |
| 0192 | trade-window-policy-update | trading |
| 0193 | block-new-buy-manage-only-symmetric-coupling | trading |
| 0194 | telegram-block-guard-commands | telegram |
| 0195 | r3-sanity-block-telegram-unblock | telegram |
| 0211 | gate-evaluation-fallback (PR #622) | trading |
| 0221 | kis-prevclose-priority (PR #623) | trading |
| 0231 | krx-master-symbol-resolver-ssot (PR #624) | trading |
| 0234 | yahoo-meta-symbol-validation (PR #625) | trading |
| 0235 | yahoo-close-timestamps-stale (PR #626) | trading |
| 0237 | volumeclock-blocked-empty-scan (PR #627) | orchestrator |
| 0241 | yahoo-sanity-aware-fallback (PR #628) | trading |
| 0242 | stockmaster-auto-enrichment (PR #632) | data |
| 0245 | stockmaster-integrity-check (PR #632) | data |
| 0248 | watchlist-diversity-monitor (PR #633) | learning |
| 0249 | global-yahoo-symbol-ssot-api (PR #633) | trading |
| 0250 | user-diagnostic-hints-ledger (PR #633) | learning |
| 0251 | krx-off-hours-counter-isolation (PR #629) | clients |
| 0252 | krx-business-day-grace-extension (PR #629) | utils |
| 0255 | yahoo-freshness-ledger (PR #630) | persistence |
| 0256 | krx-time-window-gating (PR #630) | clients |
| 0258 | health-full-diagnostic-command (PR #634) | telegram |
| 0259 | krx-cooldown-probe-mode (PR #630/#631) | clients |
| 0260 | defect-evolution-ledger (PR #631) | learning |
| 0323 | gate-pass-rate-sla (retrofit, ADR-0391 동시 등재) | learning |
| 0324 | gate-contribution-analyzer (retrofit) | learning |
| 0325 | gate-threshold-auto-tuning (retrofit) | learning |
| 0329 | persona-balance-ledger (retrofit) | learning |
| 0341 | krx-trading-calendar-wiring (retrofit) | clients |
| 0342 | krx-empty-response-auto-retry (retrofit) | clients |
| 0343 | sector-energy-cache-fallback (retrofit) | clients |
| 0364 | sector-energy-yahoo-etf-fallback (retrofit, PR #645) | clients |
| 0370 | sector-energy-hardening-phase-1 (PR-Sector-Energy-Hardening-Phase-1) | clients |
| 0387 | condition-eval-status-data-unavailable (PR #655) | quant/conditions |
| 0388 | condition-eval-status-error-isolation (PR #656) | quant/conditions |
| 0389 | evaluator-status-migration-and-gate-audit-extension (PR #657) | quant/conditions |
| 0390 | five-evaluator-status-migration (PR #658) | quant/conditions |
| 0391 | p0a-mode-observability (P0-A Mode 관측 계측 — /mode_consistency + /exec_matrix + /exec_paths + /gate_audit 표시 개선 + executionStatsSsot) | telegram |
| 0392 | p0b-trading-mode-ssot (P0-B SSOT 통일 — env 직접 참조 7곳 → getTradingMode() 5 wiring + 2 display 재분류) | trading |
| 0393 | p1-execution-mode-and-shadow-ledger (P1 Stage A — ExecutionMode = OFF/PAPER/LIVE SSOT + getTradingMode deprecated wrapper) | state |
| 0394 | p1.5-execution-terminology-ssot (P1.5 — 용어 SSOT, TERMINOLOGY_MAP + DISPLAY_LABELS + SHADOW_LEDGER_ENABLED) | types |
| 0395 | p2-persistent-execution-mode-override (P2 — 영속 ExecutionMode override `data/execution_mode_override.json` + RUNTIME → persistent → env 우선순위 체인) | persistence |
| 0396 | sector-energy-dataquality-decomposition (사용자 명시 ADR-0371 = 실제 발급 0396 — STALE 단일 라벨 → 5단계 union (OK/PARTIAL/STALE/DEGRADED/FAILED) + sourceTier/freshness/coverage/confidence 4-axis 분리 + 계단화 매트릭스 SSOT) | clients |
| 0397 | sector-energy-yahoo-etf-fallback-wiring (사용자 명시 ADR-0372 = 실제 발급 0397 — Yahoo ETF L4 fallback wiring + sourceTier='YAHOO_ETF' + confidence × 0.5 + allowStrongBuy=false + dataQuality='DEGRADED' 강제 정책) | clients |
| 0398 | sector-energy-strong-buy-confidence-gate (사용자 명시 ADR-0373 = 실제 발급 0398 — STRONG_BUY 4 조건 OR 차단 SSOT (confidence<0.6 / dataQuality∈{DEGRADED,FAILED} / sourceTier='YAHOO_ETF') + UI Language SSOT 8번째 카테고리 sectorEnergy + /sector_energy_diag 텔레그램 명령) | trading |
| 0399 | sector-energy-source-restoration (사용자 명시 ADR-0374 = 실제 발급 0399 — KRX 원천 복구 + SECTOR_INDEX_MASTER SSOT 12 표준 섹터 + 4-tier 호출 순서 SSOT (L1 KRX_CODE → L2 STOCK_DAILY → L3 CACHE → L4 YAHOO_ETF) + ADR-0396 4-axis 영속 writer 활성 + diagnostics 메타 (candidateDates/sourceTierAttempts/finalSourceTier/confidence/fallbackReason) + indexName 단독 매칭 영구 차단) | clients |
| 0400 | wire-sector-energy-strong-buy-gate (ADR-0398 dead code 종결 — buyListLoop.ts:1130 단일 STRONG_BUY 결정 지점 wiring + macroState 4-axis 영속 read SSOT + STRONG_BUY → BUY 강등 패턴 (절대 원칙 #2 — 일반 BUY 차단 금지) + 보수 fallback (macroState 부재 시 FAILED 강제) + ENV `SECTOR_ENERGY_STRONG_BUY_GATE_WIRING_DISABLED` default OFF + 정적 grep 가드 10 + 동작 매트릭스 16 = 26 회귀) | trading |
| 0401 | r3-sanity-violation-state-machine (R3 Sanity 5단계 state machine — CLEAN→WARNING→ELEVATED→SHADOW_ONLY→HARD_BLOCK + Regime-Aware Threshold (R3_EARLY 5회 / R3_CONFIRMED·EXPANSION·DEFAULT 3회) + Guard 체인 5종 OR (candidates<5 / sectorEnergy DEGRADED+FAILED / freshness EXPIRED / volumeClock false / GPD missing) + 24h decay + scanId 중복 차단 + state별 dedupeKey 분리 + /r3_status 신규 + /r3_unblock streak reset wiring + 영속 SSOT data/r3-violation-streak.json) | trading |
| 0412 | frozen-quote-detector-and-holiday-r3-streak-guard (ADR-0401 직속 후속 — Frozen Quote Detector SSOT (`MIN_COMPARABLE=10` / `SUSPECT_RATIO=0.1` / `STALE_RATIO=0.3` / `EPSILON_PCT=0.0001` 임계 + currentPrice/previousClose comparable + volume>0 frozen 카운트 + dataQuality 'OK'/'SUSPECT'/'STALE') + R3 Guard 6번째 OR 추가 (frozenQuoteDataQuality STALE/SUSPECT 시 hardBlockAllowed=false + SHADOW_ONLY cap, ADR-0401 결정 트리 본체 무수정) + Streak Increment Skip 정책 SSOT (KRX_NON_TRADING_DAY / VOLUME_CLOCK_CLOSED / SELL_ONLY_MODE / BLOCKED_DAY_SCAN / FROZEN_QUOTE_STALE 5 reason — 24h decay 보존) + ScanSummary.frozenQuote? + r3StreakSkipped? 옵셔널 영속 + /scan_blockers 표시 (formatFrozenQuoteSection + formatR3StreakSkipLine SSOT) — LIVE 매매 본체 0줄 + KIS 주문 함수 import 0건 + ENV 신규 0종) | trading |
| 0413 | stock-master-evening-cron (KIS 토큰 cron 패턴 정합 — `stock_master_auto_enrichment` jobName 1일 2회 발동, 장전 06:00 KST + 장후 19:00 KST. KIS 토큰 갱신 (20:30 KST) 1시간 30분 전 master fresh 보장. `runStockMasterEnrichmentCron(label)` 헬퍼 SSOT 추출 + ScheduleClass='TRADING_DAY_ONLY' KRX 휴장일 자동 skip + 동일 jobName metric 합산 (KIS 토큰 cron 패턴 정합 — ADR-0147a). `STOCK_MASTER_AUTO_ENRICHMENT_DISABLED=true` ENV 우회 보존, 신규 ENV 0종, LIVE 매매 본체 0줄 변경) | scheduler |
| 0415 | sector-energy-stale-partial-volume-strong-buy-gate (ADR-0398 + ADR-0400 직속 후속 — STRONG_BUY 차단 4 조건 OR → 6 조건 OR 격상. STALE 누락 결함 차단 (audit 발견 — ADR-0398 *원래 가정* "STALE fallback 충분" 재정의) + PARTIAL_VOLUME 신규 분류 추가 (사용자 명시 *"가격 정상 + 거래량/일부 섹터 누락 → BUY 까지만"*). SectorEnergyDataQuality5 union 5단계 → 6단계 (PARTIAL_VOLUME 추가, 타입 이름 보존 — 호출자 정합 보존, value 만 격상). evaluateSectorEnergyStrongBuyGate 결정 트리 2 조건 추가 (조건 5 STALE / 조건 6 PARTIAL_VOLUME) — ADR-0398 SSOT 본체 확장만. 절대 원칙 #1 일반 BUY 차단 금지 보존 — `forbidStrongBuy` 만, `forbidBuy`/`blocked` 필드 부재 (정적 가드). 회귀 20 신규 + 기존 1 정합 정정 + 인접 SectorEnergyDataQuality 49/49 무회귀. ENV `SECTOR_ENERGY_STRONG_BUY_GATE_DISABLED=true` 우회 보존 (ADR-0398). LIVE 매매 본체 0줄 변경, 호출자 (ADR-0400 buyListLoop wiring) 자동 흡수, KIS 주문 함수 import 0건) | trading |
| 0414 | price-integrity-correction-overlay-readonly (ADR-0412 직속 후속 — *Stage 1 Read-Only Mode*. 종목별 입력 데이터 품질 진단 SSOT (PriceIntegrityChecker — 7 status union OK/SUSPECT/STALE/FROZEN_QUOTE/PRICE_BASE_MISMATCH/REVERSE_GAP_SUSPECT/FAILED + 결정 트리 8 분기 + EPSILON_PCT=0.0001/STALE_DAYS=2/SUSPECT_GAP_PCT=7/REVERSE_GAP_PCT=15/MISMATCH_GAP_PCT=25/MIN_COMPARABLE=10 임계 SSOT) + Scan-Local Overlay 보정 SSOT (PriceCorrectionEngine — correctionType 6 union NONE/USE_KIS_CURRENT/USE_KRX_PREV_CLOSE/USE_RECENT_DAILY_CLOSE/DROP_GAP_CALCULATION/SHADOW_ONLY + confidence 3축 가중치 곱셈 (sourceWeight × dateAlignmentWeight × crossSourceAgreementWeight) + LIVE_THRESHOLD=0.8 / SHADOW_THRESHOLD=0.5 임계 + DROP_GAP_CALCULATION 정책 *틀린 gap 계산보다 gap 미사용 우월*) + 결정 추적성 (PriceCorrectionLineage — inputSnapshot/decisionTrace/correctionType/confidence/computedAt/ruleVersion `priceCorrectionEngine@v1-readonly`) + ScanSummary 옵셔널 priceIntegrity? + priceCorrection? 후방호환 + scanDiagnostics 진단 헬퍼 (formatPriceIntegritySection + formatPriceCorrectionOverlaySection SSOT) + ENV `PRICE_CORRECTION_DISABLED=true` 우회 default OFF — Stage 1 호출자 0건 dead code (Stage 2/3 후속 PR 위임), LIVE 매매 본체 0줄 변경, KIS 주문 함수 import 0건 정적 grep 가드, 외부 API 직접 호출 0건, persistence 원본 quote/master/daily overwrite 0건) | trading |

**총 발급 212 unique 번호** (마지막 발급 0414) / **충돌 26 파일 (11 그룹, 별칭 26건 ADR-0159 부여)** / **누락 6건** (0062/0063/0089/0105/0106/0143) / **다음 발급 0415**.

## 후속 PR — 자동 충돌 검사 정적 스크립트

본 인덱스 갱신 누락 차단을 위해 후속 PR 에서 `scripts/check_adr_index.js` 신규 — `docs/adr/*.md` 파일 시스템 vs INDEX.md §"전체 인덱스" 표 정합 검증 + `validate:all` 통합. 본 PR 은 인프라 수동 작성만, 자동 검사는 별도 PR 분리 (회귀 위험 격리).
