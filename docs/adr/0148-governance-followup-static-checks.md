# ADR-0148: 거버넌스 후속 자동화 정적 검증 — ADR INDEX + PENDING_WIRING + PR Pace Audit + Silent Degradation 확장

**Status**: Accepted
**Date**: 2026-05-01
**Related**: PR-Governance-1 (ADR INDEX + PENDING_WIRING 백로그 신설), PR-Governance-2 (ADR-0114 silent degradation 정적 검증), PR-Governance-3 (ADR-0146 10-PR audit 룰), 사용자 4-항목 추천 후속 자동화 4종
**Author**: claude (PR-Governance 후속)

## Context

PR-Governance-1/2/3 (#499/#500/#501/#502) 머지 후 명시적으로 분리된 4 후속 자동화 작업이 잔여:

1. **`scripts/check_adr_index.js`** — `docs/adr/*.md` ↔ INDEX.md 정합 정적 검증. 4/26 단 하루에 ADR 0028~0032 충돌 5건 발생 패턴 재발 차단.
2. **`scripts/check_pending_wiring.js`** — PENDING_WIRING.md 백로그 SSOT 정합 검증. *PR-L/N/O 같은 게 영원히 dead code 로 남는 결함* 영구 차단.
3. **`scripts/check_pr_pace_audit.js`** — ADR-0146 10-PR boundary audit-only PR 룰 자동 모니터링. *PR-510 머지 직후 첫 자동 트리거* 누가 알려주는가? 단일 인력 페이스 휩쓸림 위험 차단.
4. **`check_silent_degradation.js` SCHEMA_FILES 확장** — PR-Governance-2 (ADR-0114) 가 macroStateRepo.ts 1개만 검사. shadowTradeRepo / watchlistRepo / attributionRepo / failurePatternRepo 4 추가 schema 확장.

수동 작성 SSOT 만으로는 *작성자 인지 의존* — 정적 검증 자동화 없이 거버넌스 의도 보존 어려움.

## Decision

4 검증 스크립트 신설 + `check_silent_degradation.js` SCHEMA_FILES 확장 + `validate:all` 13종 → 16종 격상 + `precommit` 통합 (PR pace audit 만 informational WARN 으로 precommit 제외).

### 1. `scripts/check_adr_index.js` — ADR 인덱스 정합

검사 6 카테고리:
- **A** 파일 존재 vs 인덱스 등재 (ADR 파일 있는데 INDEX.md 미등재)
- **B** 인덱스 등재 vs 파일 존재 (stale 등재 — 파일 삭제됐는데 INDEX.md 잔존)
- **C** "다음 발급" 정합 (다음 발급 번호 = max(번호) + 1)
- **D** 누락 (Gap) 표 정합 (§"누락" 의 번호가 실제 파일 부재)
- **E** 충돌 표 정합 (§"알려진 충돌" 의 ADR 이 실제 파일 시스템에 존재)
- **F** 파일명 prefix 검증 (`^\d{4}-[a-zA-Z][a-zA-Z0-9-]*\.md$` 엄격)

기존 코드베이스가 camelCase ADR 이름 사용 (`signalScanner` / `stockScreener` / `exitEngine`) → 영대소문자 + 숫자 + 하이픈 허용. 차단 대상은 `28-*` (4자리 미만) / `0028a-*` (suffix) / 시작 비-영문 같은 변형.

**baseline 0건 위반** — 회귀만 차단. EXIT=1 시 INDEX.md 갱신 의무.

### 2. `scripts/check_pending_wiring.js` — wiring 백로그 정합

검사 6 카테고리:
- **A** 상태 SSOT (INFRASTRUCTURE_ONLY / PARTIAL / BLOCKED / DECIDED_NOT_WIRING 외 차단)
- **B** 우선순위 SSOT (P0/P1/P2/P3 외 차단)
- **C** ADR 참조 정합 (백로그가 참조하는 ADR 번호가 INDEX.md 에 등재되어 있는지)
- **D** 카테고리 누락 (5 카테고리 A. 학습 / B. 매매 / C. 시그널 / D. UI / E. 영속 모두 존재)
- **E** 진행 통계 자동 갱신 (§"진행 통계" 표가 실제 카테고리 카운트와 일치)
- **F** ID 형식 (`^[A-E]\d+$` 엄격 + 카테고리 prefix 와 위치 카테고리 일치)

본 PR 도입 시 이미 *실제 결함 1건 검출* — `B. 매매 본체 P1=2 / P2=3` 표기 vs 실제 P1=3 / P2=2. 본 ADR 갱신으로 정합 회복 (B7 `price7dAgo` 추가 후 P1=3 / P2=3 / 합 7).

### 3. `scripts/check_pr_pace_audit.js` — 10-PR boundary 모니터링

`git log --oneline -n 200` 파싱 → `(#NNN)` 패턴으로 PR 번호 추출 → audit prefix (`audit:` / `chore(audit):` / `docs(audit):` / `feat(audit):` / `fix(audit):`) 또는 audit 키워드 (`audit-only` / `audit PR` / `N0 audit`) 인식 → 마지막 audit-only PR 발견 → boundary 도달 (currentN0 > lastAuditN0) 시 WARN 출력.

**면제 조건**:
- `currentPr < 30` (초기 단계)
- `lastAuditPr` 부재 + `_workspace/audit-pr-N0/` 폴더 존재 시 fallback (commit log audit 우선)

**출력 정책 (현재 단계)**:
- boundary 미도달 → OK
- boundary 도달 → WARN (EXIT=0, informational)
- 시간 기반 ERROR (24h/48h 임계) 는 후속 PR 도입 (현재 unique 추적 어려움)

**현재 코드베이스 출력**: `WARN — 10-PR boundary 도달. 현재 PR=#504, 마지막 audit 없음, 504 PR 누적`. PR-41 / PR-52 audit-only PR 패턴이 commit prefix 미사용 (일반 `feat:` prefix) → audit 인식 실패. 향후 audit-only PR 작성 시 prefix 의무.

`validate:all` 만 통합, `precommit` 제외 — informational, 매 commit 막을 만큼 확신 강하지 않음.

### 4. `check_silent_degradation.js` SCHEMA_FILES 4개 추가

PR-Governance-2 (ADR-0114) 가 macroStateRepo.ts 1개만 검사하던 한계 해소:
- `server/persistence/shadowTradeRepo.ts` (자기학습 핵심 SSOT, ServerShadowTrade v2 schema)
- `server/persistence/watchlistRepo.ts` (사용자 관심 종목 영속)
- `server/persistence/attributionRepo.ts` (27조건 학습 가중치 — ADR-0006 composite key)
- `server/persistence/failurePatternRepo.ts` (실패 패턴 학습 — TTL 180일)

확장 후 49개 옵셔널 → 144개 옵셔널 검사 (3배 격상).

**검출된 silent degradation 2건** (PENDING_WIRING 등재):
- `ServerShadowTrade.bepGlideTouchAt` — ADR-0085 TwoBar Confirmation BEP_PROTECTION wiring 대기 (PENDING_WIRING B1, P0)
- `ServerShadowTrade.price7dAgo` — 과열 탐지 신호 #3 (riskManager.ts:39 가 reader, 매수 시점 7일 lookback OHLCV 영속 wiring 미구현, PENDING_WIRING B7 신규 등재)

두 항목 모두 BASELINE_SILENT_DEGRADATION 카탈로그 등재 (의도된 placeholder 흡수) + PENDING_WIRING 추적.

## Consequences

### 긍정

1. **ADR 번호 충돌 자동 차단** — 작성자가 INDEX.md 잊고 `Math.max() + 1` 발급 시 즉시 fail.
2. **wiring dead code 차단** — PR 머지 시 PENDING_WIRING 등재 누락 시 즉시 fail.
3. **PR 페이스 가시화** — N0 boundary 도달 시 자동 WARN, audit 의무 인지.
4. **silent degradation 4 schema 확장** — 144 옵셔널 필드 자동 검증, 신규 결함 자동 차단.
5. **`validate:all` 13 → 16종** — 거버넌스 자동화 SSOT 통합.

### 부정

1. `check_silent_degradation.js` 확장 후 18s 소요 — precommit 부담 증가 (acceptable).
2. `check_pr_pace_audit.js` 가 git log 의존 — CI 환경 / shallow clone 시 SKIP 동작 의존.
3. PR-41 / PR-52 가 audit-only 였지만 commit prefix `feat:` / `fix:` 사용 → 본 스크립트가 audit 인식 못 함. 향후 audit-only PR 작성 시 `audit:` prefix 의무 (룰 갱신).

### 회귀 테스트

본 ADR 도입 PR 의 신규 회귀 케이스:
- `scripts/check_adr_index.test.js` — 26 케이스 (scanAdrFiles 5 + parseIndex 5 + validate 6 카테고리 분기 11 + 헬퍼 5)
- `scripts/check_pending_wiring.test.js` — 23 케이스 (상수 SSOT 3 + parsePendingWiring 5 + extractAllAdrNumbers 3 + validate 12)
- `scripts/check_pr_pace_audit.test.js` — 29 케이스 (상수 SSOT 3 + parseCommitLog 6 + extractMaxPrNumber 3 + findLastAuditPr 2 + scanAuditFolders 3 + isAuditExempt 2 + computeAuditStatus 8 + CLI 통합 2)
- `scripts/check_silent_degradation.test.js` — +3 케이스 (확장 SCHEMA_FILES 5개 인터페이스 추출 + BASELINE 흡수 검증)

총 신규 81 케이스 (3 신규 파일 78 + 기존 3 확장).

## 후속 PR (scope 외)

1. **`check_pr_pace_audit.js` 시간 기반 ERROR 격상** — boundary 도달 후 24h WARN / 48h ERROR EXIT=1. 현재 단일 PR 기준 시각 추적 인프라 부재 (git commit timestamp 사용 가능).
2. **`check_silent_degradation.js` 추가 SCHEMA_FILES** — 운영 데이터 누적 후 추가 영속 schema 확장 (예: `tradeSignalStatusRepo` / `recommendationSnapshotRepo`).
3. **`check_pending_wiring.js` `--changed` 모드** — staged 파일 한정 검사로 precommit 속도 최적화.
4. **PR 자가 review 체크리스트 자동화** — `.github/pull_request_template.md` 의 5 섹션 체크 항목을 GitHub Actions 으로 검증.

## ENV 우회

본 PR 의 4 정적 검증은 ENV 우회 미도입 — *거버넌스 SSOT 정합* 은 ENV 로 우회 가능한 패턴은 자기 모순. 단, 운영자 명시 필요 시 다음 PR 에서 `--soft` 모드 도입 가능.

기존 ENV 우회 (silent degradation 의 `--strict` 등) 는 무수정 보존.
