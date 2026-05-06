# ADR-0324: 게이트 기여도 분석기 SSOT (Phase 1 — pure analyzer)

**Status**: Accepted (Phase 1 — pure SSOT only, cron wiring 후속 PR)
**Date**: 2026-05-06
**PR**: claude/fix-gate-evaluation-fallback-mDmdZ

## 배경

사용자 5/6 명시 — 학습 데이터 (counterfactual) 로 게이트의 실제 가치 검증. 차단된 종목의 *그 후 가격 변화* 를 추적해:
- "차단해서 손실 회피" (blocked_losers) — 게이트 정당
- "차단해서 알파 손실" (blocked_winners) — 게이트 과보수

기존 인프라:
- `counterfactualShadow.loadCounterfactuals()` 영속 데이터 — `skipReason: string` + `return30d?: number` 필드 보유.
- `resolveCounterfactuals` 가 30거래일 후 자동으로 `return30d` 채움.

## 결정

### Phase 1 (본 PR scope) — pure analyzer만

**적용**:
1. `server/learning/gateContributionAnalyzer.ts` SSOT 신규
2. `analyzeGateContribution(entries, pattern)` 단일 패턴 분석
3. `analyzeGateContributions(entries, patterns)` 다중 패턴 일괄
4. `analyzeGateContributionsFromStore(patterns)` 영속 read 변형
5. ENV `GATE_CONTRIBUTION_ANALYZER_DISABLED=true` 우회

**보류 (후속 PR)**:
- 주간 cron + 텔레그램 알림 wiring
- 사용자 spec 의 `AVG_LOSS / AVG_WIN` 계산 — 정의 미명확 (어느 표본 평균? 학습 윈도우?)
  → 본 PR 은 *카운트* 만 (winners/losers/neutral), avgReturn 합산은 후속

### 임계값 SSOT

| 상수 | 값 | 의미 |
|---|---|---|
| `WINNER_RETURN_THRESHOLD_PCT` | 5 | return30d > 5% = 차단됐지만 수익 |
| `LOSER_RETURN_THRESHOLD_PCT` | -5 | return30d < -5% = 차단 정당 |
| `DOMINANCE_RATIO` | 1.5 | POSITIVE/NEGATIVE 판정 우세 비율 |
| `MIN_RESOLVED_SAMPLE` | 5 | 통계 신뢰도 임계 |

### 분류 우선순위 SSOT (4 verdict)

1. resolved 표본 < 5 → `INSUFFICIENT_SAMPLE`
2. losers > winners × 1.5 → **POSITIVE** (게이트 손실 회피 기여)
3. winners > losers × 1.5 → **NEGATIVE** (게이트 알파 손실)
4. 그 외 → `NEUTRAL`

### 매칭 정책

- `skipReason` substring match (대소문자 sensitive)
- 예: `pattern='GATE'` 는 `'GATE_UNDER'` + `'GATE_FAIL'` 둘 다 매칭
- 호출자가 패턴 배열 직접 명시 (예: `['GATE_UNDER', 'SECTOR_FULL', 'SKIP']`)

## 안전 invariant

- LIVE 매매 본체 0줄 변경 (read-only 분석).
- KIS/KRX 자동매매 quota 0 침범.
- ENV `GATE_CONTRIBUTION_ANALYZER_DISABLED=true` 1줄 즉시 롤백.
- `return30d` 부재/NaN/Infinity → `blockedUnresolved` 안전 분류.
- 표본 < 5 → INSUFFICIENT_SAMPLE 보류 (오판 차단).

## 잘못된 해결 방법 영구 차단

1. **AVG_LOSS / AVG_WIN 산출 본 PR 통합** — 정의 미명확, 후속 PR.
2. **사용자 spec 의 모든 GATES 매트릭스 매칭** — 게이트 → skipReason 매핑 부재. 호출자 측에서 명시 패턴 전달.
3. **cron + 텔레그램 wiring 본 PR** — Phase 1 정책 (pure SSOT 만, 회귀 위험 격리).
4. **PR-Y2 reflectionImpactPolicy 와 통합** — 분석 차원 다름. ADR-0084 (모듈 자연선택) 와 ADR-0324 (게이트 가치) 분리.
5. **netClassification 의 임계 조정 ENV** — Phase 1 정적 SSOT, ADR-0325 (자기 진화) scope.

## 후속 PR (deferred)

- **ADR-0324-Cron**: 주간 분석 cron + 텔레그램 보고서
- **AVG_LOSS/AVG_WIN 산출**: netValue 계산 + 화폐 단위 영향
- **ADR-0325 (Threshold Auto-Tuning) 결합**: NEGATIVE 판정 게이트의 임계 자동 완화 후보

## 회귀 테스트

`gateContributionAnalyzer.test.ts` — SSOT 상수 4 + ENV gate 3 + analyzeGateContribution 14 (빈 입력/패턴 미매칭/winners/losers/neutral/unresolved/NaN/boundary +5/-5/POSITIVE/NEGATIVE/NEUTRAL/표본 부족/substring) + analyzeGateContributions 4 = 25+ 케이스.
