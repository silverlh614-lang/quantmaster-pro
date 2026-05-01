# ADR-0146: PR 페이스 감속 룰 — 10-PR 단위 audit-only PR 강제

**Status**: Accepted
**Date**: 2026-05-01
**Related**: PR-41 (PR-26~40 audit), PR-52 (PR-26~50 LIVE 매매 audit), 사용자 4-항목 거버넌스 추천 #1
**Author**: claude (PR-Governance-3)

## Context

CLAUDE.md "변경 이력" 표가 211 행 누적. 4/24~5/1 사이 약 200+ PR 머지. 단일 인력 + AI 페어 작업 환경에서 *사후 결함 발견* 패턴이 누적:

- **PR-30 / PR-30+ 시기**: KRX OTP 빈 응답·HTML 오류 페이지·count<2000 부분 fetch 같은 *반복 사고*. PR-33 (multi-source 4-tier) 으로 인프라 차단했지만 사후 대응.
- **ADR-0136 silent degradation**: 영속 schema 옵셔널 필드 + reader 있음 + writer 0건 패턴. PR-Diag-1~5 (ADR-0136~0140) 까지 5 PR 누적되어야 차단. PR-Governance-2 (#501) 에서 정적 검증 도입.
- **PR-41 PR-26~40 audit**: 사용자 명시 "PR-26~40 누적 변경 후 자동매매 시스템에서 놓친 버그 전수 검증·즉시 수정". H1 dryRunScanner SHADOW 누수 / M1~M3 잔여 식별. *코드 0줄 변경* audit-only PR 패턴 정착.
- **PR-52 PR-26~50 audit**: 사용자 명시 "자동매매 루프 정밀확인 + 발생할 수 있는 에러 경우의 수 확인·수정". H1 trancheExecutor.checkPendingTranches() AUTO_TRADE_ENABLED 가드 누락. 동일 audit-only 패턴 효과 입증.

PR-41 / PR-52 audit-only PR 패턴은 *직접 결함 차단* 효과가 있었지만 *불규칙* 발생 (4/25 사용자 요청 → PR-41 / 4/26 사용자 요청 → PR-52). 사용자 명시 *"4/26 이후 또 한 번 audit PR 을 명시적으로 삽입하세요. PR-41 (PR-26~40 audit) 패턴을 PR-100 단위로 강제 정착. '10 PR마다 무수정 audit'을 룰로"* — 우연이 아닌 *룰* 로 정착 요청.

## Decision

**10-PR 단위 audit-only PR 룰 정식 정착**. 신규 PR 의 번호가 N0 (10 단위 boundary, 예: PR-50/60/70/80/90/100) 에 도달하면, 직전 10 PR 의 *코드 변경 0줄* audit-only PR 강제 (PR-N0+1 또는 그 직후 PR 으로).

### Audit 체크리스트 SSOT (5 카테고리)

audit-only PR 은 다음 5 카테고리 모두 점검 + findings 보고 의무:

#### A. LIVE 매매 안전성 (자동매매 회귀 위험)

- [ ] 직전 10 PR 중 LIVE 매매 본체 변경 (`server/trading/exitEngine` / `server/clients/kisClient` / `server/orchestrator/tradingOrchestrator` / `server/trading/autoTradeEngine`) 이 있었는가?
- [ ] 변경 시 ENV 롤백 스위치 (`<DOMAIN>_DISABLED=true`) 도입 여부?
- [ ] 변경 시 회귀 테스트 추가 (단위 + 통합) 여부?
- [ ] KIS/KRX quota 영향 (절대 규칙 #2 단일 통로 / #4 autoTradeEngine 단일 통로) 침범 0건 검증?
- [ ] AUTO_TRADE_ENABLED + emergencyStop 가드 모든 진입점 적용 검증?

#### B. wiring 완료 vs 인프라만 (PENDING_WIRING 등재 의무)

- [ ] 직전 10 PR 중 *영속 schema + 인프라 SSOT 만 머지, 호출자 wiring 부재* 항목이 있는가?
- [ ] 있다면 `_workspace/PENDING_WIRING.md` 등재 완료?
- [ ] PENDING_WIRING 등재 시 ADR + 차단 사유 + 우선순위 (P0/P1/P2/P3) 명시?
- [ ] *영원히 dead code 로 남는* 의도된 SSOT 는 `DECIDED_NOT_WIRING` 상태로 등재?

#### C. ADR 번호 발급 무결성 (INDEX.md 정합)

- [ ] 직전 10 PR 의 ADR 번호가 `docs/adr/INDEX.md` §"전체 인덱스" 에 모두 등재?
- [ ] 충돌 신규 발생 0건 (`docs/adr/INDEX.md` §"다음 발급" 사용 의무 위반 없음)?
- [ ] 누락 (gap) 신규 발생 시 §"누락 (Gap)" 표 등재?

#### D. 회귀 테스트 적정성

- [ ] 직전 10 PR 의 신규 회귀 케이스 합산 카운트 vs 변경 LoC 비율 확인 (rough heuristic: 100 LoC 당 5+ 케이스).
- [ ] PR 내 회귀 테스트 케이스 0건 PR (회귀 테스트 면제 사유 명시 의무) 확인.
- [ ] vitest 전체 무회귀 (직전 10 PR 의 누적 변화 시뮬레이션).

#### E. 정책 위반 (validate:all 13종)

- [ ] 직전 10 PR 머지 후 `validate:all` 13종 모두 PASS 유지?
- [ ] WARN 카운트 baseline 무회귀 (ACMA / SDS 등) 검증?
- [ ] silent degradation (PR-Governance-2) 신규 위반 0건?
- [ ] data trust layer / yahoo range / sensitive alerts / channel boundary 등 정책 후방호환 보존?

### Audit-only PR 형식

- **PR 제목**: `audit(PR-N0): PR-(N-9)~N-0 누적 변경 audit (코드 0줄)`
- **PR body**: 5 카테고리 체크리스트 + 각 카테고리별 findings (Critical/High/Medium/Pass 분류)
- **결과 분류**:
  - `Critical` (즉시 수리 PR 분리, LIVE 매매 안전성 영향)
  - `High` (1주 내 수리 PR, 학습 데이터 품질 / wiring 누락)
  - `Medium` (운영 데이터 누적 후, drift 위험)
  - `Pass` (정합 확인)
- **scope 외 행동**: audit 결과의 수리는 *별도 PR* 분리 의무 — audit-only PR 자체는 *코드 변경 0줄 보존* (PR-41 / PR-52 패턴 정합).
- **산출물 영속**: `_workspace/{YYYY-MM-DD}_audit-pr-{N0}/findings.md` 신설 + git 영속.

### 강제 트리거 시점

다음 중 *최초 도달* 시점:

1. PR 번호 N0 boundary (PR-100, PR-110, PR-120, ...) 머지 직후 24h 이내
2. 사용자 명시 audit 요청
3. 인시던트 발생 (Telegram CRITICAL / Pre-Market Smoke Test 실패 / Mutation Canary 실패) 후 직후 PR

10 PR 단위 외 *임시 audit* 가능 — 단, 임시 audit 도 동일 5 카테고리 체크리스트 사용.

### 시작 시점

본 ADR-0146 발행 시점 (PR-Governance-3 머지 후) 부터 적용. 직전 PR 번호 N 기준 다음 N0 boundary 가 첫 audit 트리거. 본 ADR 발행 시점 (PR-Governance-3, 약 PR #502) 이라면 *PR-510* 머지 직후가 첫 audit-only PR.

### 면제 조건

다음 케이스는 audit 자동 트리거 불필요 (단, 운영자 판단 시 강제 가능):

- **PR 번호 < 30 (초기 단계)** — 변경 누적량 적음.
- **연속 hot-fix PR 시리즈** — 동일 결함 다중 PR 분할 (예: 4 PR 분할) 의 마지막 PR 머지 시 자동 audit 통합.
- **휴장 기간 (KRX 공휴일 + 주말)** — LIVE 매매 영향 최소, 다음 영업일 이후 트리거.

### Anti-Patterns (룰 위반)

다음 행동 금지:

- ❌ audit 누락 + 다음 N0 boundary 까지 진행
- ❌ audit-only PR 에 *코드 변경* 포함 (분리 PR 의무)
- ❌ audit findings 의 *수리* 를 audit PR 자체에 흡수 (회귀 위험 격리 위반)
- ❌ 5 카테고리 중 *생략* (특히 A. LIVE 매매 안전성)

## Consequences

### 긍정

- *불규칙 사후 audit* → *규칙적 사전 audit* 전환. PR-41 / PR-52 효과 정기화.
- 결함 발견 → 수리 사이클 단축 (10 PR 누적 후 발견 vs 30+ PR 누적 후).
- PENDING_WIRING / INDEX.md 갱신 누락 자동 감지.
- 단일 인력 검토 한계 부분 보완 (체크리스트가 두 번째 검토자 역할).

### 부정 / 비용

- 10 PR 마다 audit-only PR 1건 추가 → PR 발생량 ~10% 증가.
- audit 본체 작업 시간 (각 30분~2시간) — 운영자 시간 부담.
- 룰 자동 강제 가능한 정적 스크립트 부재 (수동 트리거 의존).

### 후속 PR (scope 외)

1. **`scripts/check_pr_pace_audit.js`** — 정적 검증 스크립트. main 브랜치의 최신 PR 번호 + audit-only PR 마지막 발생 PR 번호 비교 → N0 boundary 도달 시 WARN. CI 통합 (validate:all 14종 격상). 본 PR 후속 분리 — 사용자 결정 후.
2. **PR 자동 분류** — Conventional Commits prefix (`audit:` / `fix:` / `feat:`) 매핑 → audit PR 자동 인식.
3. **사례 카탈로그** — `docs/audit-cases/` 디렉토리 + 각 audit-only PR 의 findings 보존.

## Alternatives Considered

### A. 5-PR 단위 (더 자주)

장점: 결함 발견 더 빠름.
단점: 운영자 시간 부담 2배. PR-41 / PR-52 사례 모두 10 PR 단위 (24/PR-26~40 / PR-26~50) 라 정합성 손상.

→ **거부**. PR-41 / PR-52 사례 정합 + 시간 부담 균형 위해 10-PR 유지.

### B. 20-PR 단위 (더 드물게)

장점: 운영자 시간 부담 1/2.
단점: 결함 누적량 ↑ → 수리 PR 분리 시 회귀 위험 ↑. PR-30~50 시기의 KRX/multi-source 사고 *20 PR 누적 후 audit* 으로는 늦음.

→ **거부**. PR-Diag-1~5 시리즈 같은 결함이 5 PR 만에 누적되어 차단됐던 경험과 충돌.

### C. PR 라벨 기반 자동 트리거 (GitHub Actions)

장점: 인적 트리거 불필요.
단점: GitHub Actions 의존성. main 브랜치 PR 번호 추적 인프라 필요. *수동 audit 본체* 는 어차피 운영자 작업.

→ **부분 채택** (후속 PR scope). 본 ADR 은 *룰 SSOT* 만 명문화, 자동화는 follow-up.

## Migration

### 즉시 적용

본 ADR 머지 직후부터 *룰 인지* 기반 운영. 첫 자동 트리거는 PR-510 머지 후.

### 도구 부재 시

`scripts/check_pr_pace_audit.js` 부재 동안은 *수동 인지* 의존. 사용자 명시 audit 요청 또는 운영자가 PR 번호 모니터링.

### CLAUDE.md 변경 이력 표 의무

audit-only PR 머지 시 CLAUDE.md "변경 이력" 표에 *반드시* 한 행 추가 — *코드 변경 0줄 / Critical N건 / High N건* 명시. PR-41 / PR-52 사례와 동일 패턴.

## References

- PR-41 (CLAUDE.md, 2026-04-25 행) — `_workspace/2026-04-25_audit-trading-regressions/findings.md`
- PR-52 (CLAUDE.md, 2026-04-26 행) — `_workspace/2026-04-26_audit-trading-loop-deep/findings.md`
- ADR-0094 (`BASELINE_TECHNICAL_DEBT` 카탈로그 패턴 — audit findings 영속 패턴 차용)
- ADR-0017 (텔레그램 메뉴 압축 시기 PR 시리즈 — 5 PR 분할 / Phase 분리 패턴)
- 사용자 4-항목 거버넌스 추천 #1 (CLAUDE.md, 2026-05-01 PR-Governance-3 행)
