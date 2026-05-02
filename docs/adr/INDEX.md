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

**다음 ADR 번호: `0160`**

(2026-05-02 기준, 마지막 발급 0159, 누락 6개 — 0062/0063/0089/0105/0106/0143)

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

**충돌 그룹 8개 / 충돌 ADR 17개 (별칭 17건 부여, ADR-0159)**. 향후 신규 발급은 §"다음 발급" 번호 사용 → 충돌 0건 유지.

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

총 누락 6개. 누락 분석은 본 인덱스 read-only — 번호 재사용 시도 금지.

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
| 0147 | kis-token-disk-persistence | infra |
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

**총 발급 159건** (165 파일 − 충돌 그룹 17건 + 충돌 그룹 표 카운트 = 159 unique 번호, 별칭 17건 부여 ADR-0159) / **누락 6건** (0062/0063/0089/0105/0106/0143) / **다음 발급 0160**.

## 후속 PR — 자동 충돌 검사 정적 스크립트

본 인덱스 갱신 누락 차단을 위해 후속 PR 에서 `scripts/check_adr_index.js` 신규 — `docs/adr/*.md` 파일 시스템 vs INDEX.md §"전체 인덱스" 표 정합 검증 + `validate:all` 통합. 본 PR 은 인프라 수동 작성만, 자동 검사는 별도 PR 분리 (회귀 위험 격리).
