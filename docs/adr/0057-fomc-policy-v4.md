# ADR-0057 — FOMC 게이트 정책 v4 — D-3부터 Kelly 0.75 적용

**상태**: Accepted (2026-04-26)
**관련 PR**: claude/fix-yahoo-probe-errors-BCBZh
**관련 ADR**: 변경 이력 v1~v3.1 (CLAUDE.md 변경 이력 참조)

## 1. 배경

FOMC 게이트 정책의 4번째 개정. 사용자 운영 결정 — FOMC 영향 기간 4일 전체에 보수적 사이즈 25% 축소 적용.

### 1.1 변경 이력

| 버전 | 날짜 | PRE_3 | PRE_2 | PRE_1 | DAY | POST_1 | POST_2 | 차단 일수 |
|------|------|:-----:|:-----:|:-----:|:---:|:------:|:------:|:---------:|
| v1 | 2025 | 0.0 | 0.0 | 0.0 | 0.0 | 1.30 | 1.15 | 4 |
| v2 | 2026-04-26 1차 | 1.0 | 1.0 | 0.0 | 0.0 | 1.30 | 1.15 | 2 |
| v3 | 2026-04-26 2차 | 1.0 | 1.0 | 1.0 | 0.0 | 1.30 | 1.15 | 1 |
| v3.1 | 2026-04-26 3차 | 1.0 | 1.0 | 0.75 | 0.0 | 1.30 | 1.15 | 1 (D-1 사이즈 ↓) |
| **v4** | **2026-04-26 4차** | **0.75** | **0.75** | **0.75** | **0.0** | **1.30** | **1.15** | **1 (D-3~D-1 사이즈 ↓)** |

## 2. 결정

`server/trading/fomcCalendar.ts:113~121` PHASE_KELLY:

```ts
// v4 (2026-04-26): PRE_3/PRE_2/PRE_1 모두 0.75 (사이즈 25% 축소), DAY 차단 유지
const PHASE_KELLY: Record<FomcPhase, number> = {
  PRE_3:  0.75,  // ← v3.1 의 1.0 → v4 의 0.75
  PRE_2:  0.75,  // ← v3.1 의 1.0 → v4 의 0.75
  PRE_1:  0.75,  // 그대로 (v3.1 부터 0.75)
  DAY:    0.0,   // 그대로
  POST_1: 1.30,  // 그대로
  POST_2: 1.15,  // 그대로
  NORMAL: 1.0,
};
```

## 3. 사유

사용자 운영 경험 기반 결정 — D-3 부터도 발표 영향권 진입으로 간주, 사이즈 보수성을 4일 전체에 균일 적용해 *운영 일관성* 확보. v3.1 의 PRE_3/PRE_2 = 1.0 (정상) 이 *완전 정상* 이라 발표 직전(D-1 = 0.75) 과 사이즈 격차가 컸던 점이 직관적 부담 — v4 는 4일 보수성 균일화로 운영 정신 단순화.

페르소나 철학 8 ("불확실성 시 관망") 정합 — FOMC 발표는 본질적으로 macro 불확실성 이벤트이므로 4일 전체에 25% 축소가 보수적 진입 정신과 일치.

## 4. 영향 범위

### 4.1 변경 파일

- `server/trading/fomcCalendar.ts`:
  - `PHASE_KELLY[PRE_3]` 1.0 → 0.75
  - `PHASE_KELLY[PRE_2]` 1.0 → 0.75
  - 파일 헤더 주석 (1~35 라인): "정책 v3.1" → "정책 v4"
  - `descMap` (250~258 라인): PRE_3/PRE_2 description 도 "보수적 진입 (Kelly ×0.75, 사이즈 25% 축소)" 형식
  - `generateFomcIcs` DESCRIPTION (307 라인): "D-day 신규 진입 차단 (v4) / D-3~D-1 보수적 진입 (Kelly ×0.75)"
  - VALARM (313 라인): "D-3 부터 보수적 진입(Kelly ×0.75), D-day 신규 진입 차단"
- `server/trading/fomcCalendar.test.ts`:
  - PRE_3 테스트의 `kellyMultiplier).toBe(1.0)` → `0.75`
  - PRE_2 테스트 동일
  - description "정상 운용" → "보수적 진입" 정합
  - applyFomcRelaxation PRE_3/PRE_2 default 테스트 `effectiveKelly).toBe(1.0)` → `0.75`

### 4.2 무변경 항목

- `applyFomcRelaxation` 본체 — `isBlockedPhase = phase === 'DAY'` 그대로 (PRE_3/PRE_2/PRE_1 모두 정상 진입 phase, Kelly 0.75 만 적용, 우호 환경 완화 평가 무관)
- `noNewEntry` — PRE_3/PRE_2 모두 false 그대로 (Kelly > 0)
- DAY/POST_1/POST_2/NORMAL — 변경 없음
- FOMC_DATES — 무변경
- `getFomcProximity` 로직 — 무변경 (PHASE_KELLY 테이블만 read)
- preflight + signalScanner + dryRunScanner + reportGenerator wiring — 무변경

### 4.3 시뮬레이션 (4/26~5/1, FOMC 4/29)

| 날짜 | Phase | v3.1 Kelly | v4 Kelly | noNewEntry |
|------|-------|:----------:|:--------:|:---------:|
| 4/26 (D-3) | PRE_3 | 1.00 | **0.75** | false |
| 4/27 (D-2) | PRE_2 | 1.00 | **0.75** | false |
| 4/28 (D-1) | PRE_1 | 0.75 | 0.75 | false |
| 4/29 (DAY) | DAY | 0.00 | 0.00 | true (또는 우호 시 0.30) |
| 4/30 (D+1) | POST_1 | 1.30 | 1.30 | false |
| 5/1 (D+2) | POST_2 | 1.15 | 1.15 | false |

차단 일수 1일 (DAY 만) — v3 정책 그대로. 사이즈 축소 일수 v3.1 1일(D-1) → v4 3일(D-3·D-2·D-1).

## 5. 회귀 영향 / 안전성

- **자동매매 본체 영향**: signalScanner.ts:381 의 `rawKelly = ... × fomcProximity.kellyMultiplier × ...` 자동 전파 — D-3/D-2 신규 진입 시 사이즈 25% 축소 (의도된 변경)
- **회귀 위험**: 0건 — PHASE_KELLY 수치 변경만, 함수 시그니처/분기 로직 무수정
- **외부 호출**: 0건 — 정적 테이블 변경
- **백테스트 영향**: D-3/D-2 사이즈 축소가 과거 추적과 정합 안 함 — 후속 모니터링 필요
- **테스트 정합**: 테스트 v4 정합 5건 수정 (PRE_3 Kelly + PRE_2 Kelly + applyFomcRelaxation default 2건 + description 1건)

## 6. 검증 계획

- `npm run lint` + `npm run validate:all 8종` + 회귀 테스트 `fomcCalendar.test.ts` 38 케이스 모두 v4 정합으로 통과
- 사용자 인지 검증: PR 배포 후 4월 28~29일 (실제 FOMC 4/29) 에 D-1 → DAY 정합 확인
