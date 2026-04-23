# ADR 0003 — 레거시 검증 WARN 백로그 점진 해소

- **상태**: Accepted (정책)
- **제안일**: 2026-04-23
- **담당 에이전트**: `quality-guard` (수집), `engine-dev` / `dashboard-dev` / `architect` (수정)

## Context

하네스 도입 시점(2026-04-23) 기준, 검증 파이프라인은 exit 0으로 통과하지만 누적된 WARN이
다음과 같다. 단일 PR에서 일괄 해소하면 diff가 폭발하므로 **점진 해소** 정책을 고정한다.

### 베이스라인 스냅샷

| 구분 | 건수 | 스크립트 | 상세 |
|------|-----:|----------|------|
| `@responsibility` 태그 누락 | 624 | `scripts/check_responsibility.js` | 주로 `src/components/**/*.tsx` 전역 |
| `@responsibility` 길이 초과 (>25 단어) | 1 | `scripts/check_responsibility.js` | `server/scheduler/learningJobs.ts` — 27 단어 |
| 로그 없이 삼켜진 catch | 4 | `scripts/silent_degradation_sentinel.js` | `server/screener/sectorSources.ts:464`, `server/trading/preMarketSmokeTest.ts:48/64/83` |

## Decision

### 비증가 원칙 (Non-Regression)

**현재 변경으로 WARN 카운트가 증가하면 `quality-guard`가 차단**한다. 이 정책은
`.claude/agents/quality-guard.md`의 "WARN 누적 정책"에 이미 명시됨.

### 점진 해소 로드맵

| 우선순위 | 항목 | 담당 | 언제 |
|----------|------|------|------|
| P0 | `learningJobs.ts` 책임 문구 25단어 축약 (1건) | architect → engine-dev | 본 PR의 Phase 3 즉시 처리 (trivial) |
| P1 | swallowed catch 4건을 **의도적 무시이면 `/* SDS-ignore */` 주석**, 아니면 로그 추가 | engine-dev | 별도 PR (정책 결정 필요) |
| P2 | 624건 `@responsibility` 누락 — **새 파일 추가/큰 수정 시 그 파일부터 태깅** + 월 1회 아키텍트 주도 sweep | architect + 전 팀 | 상시, 월간 sweep |

### 수정 규약

- **단일 PR 당 해소 한도**: 관련 변경 모듈 + 주변 20개 파일 이내 (대규모 sweep PR 제외)
- **커밋 메시지**: `chore(srp): add @responsibility tag to N components` 형식
- **월간 sweep PR**: `chore(srp): monthly @responsibility sweep (YYYY-MM)` 제목으로
  단독 PR. 이 PR 은 기능 변경 금지, 태그 추가/수정만 허용

## Consequences

### 긍정
- 역사적 cruft가 새 PR을 오염시키지 않음 (비증가 원칙으로 방어)
- 해소 진행 상황이 WARN 카운트 변화로 정량 추적 가능
- 본 PR에서 P0 1건만 즉시 해소해 "정책 작동" 시그널 제공

### 부정
- P2 624건 해소는 수개월 소요 예상
- 베이스라인 스냅샷이 오래되면 의미 없어지므로 분기별 재측정 필요

## P0 즉시 처리 (본 PR 포함)

`server/scheduler/learningJobs.ts` 책임 문구:

- **현재 (27 단어)**: "자기학습 파이프라인 cron(주간 L3 캘리브레이션 · 일일 미니 백테스트
  · Sharpe 급락 경보 · F2W 역피드백 · 주간 백테스트 · Nightly Reflection · Phase 1 Learning)을 등록한다."
- **제안 (≤25 단어)**: "자기학습 cron 작업(L3 캘리브레이션·일일 미니 백테스트·Sharpe
  경보·F2W 피드백·Nightly Reflection·Phase 1 Learning)을 등록한다."

## Alternatives Considered

### A. 일괄 해소 PR
- 장점: 빠른 정리
- 단점: 624개 파일 수정 diff → 리뷰 불가. 회귀 리스크 극대.

### B. 비증가 원칙만 적용 (해소는 자연 감소에 맡김)
- 장점: 관리 부담 최소
- 단점: 기존 WARN 영구 고착. 신규 팀원/에이전트에게 잘못된 기준선 전달.

## References

- `CLAUDE.md` — "검증 파이프라인 요약" 테이블
- `.claude/agents/quality-guard.md` — WARN 누적 정책
- `scripts/check_responsibility.js`
- `scripts/silent_degradation_sentinel.js`
