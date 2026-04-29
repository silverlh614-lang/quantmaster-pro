# ADR-0108 — 운영자 노이즈 감축 + 자기반성 텍스트 잘림

## Status
Accepted (2026-04-29)

## Context

사용자 4/29 운영 보고 4건:

1. **일일 종목 픽 가치 부재** — 16:30 KST 발송되는 `[일일 종목 픽]` 메시지가
   매번 *"조건 충족 종목 없음 / 매집 징후 3개 이상 종목 없음"* 으로 출력. 사용자
   원문: *"이거 필요한거 맞아? 그냥 없앨까 / 나중에 구독자 받으면 그때할까"*.

2. **Watchlist 노이즈 너무 심함** — `[Watchlist Auto-Trim]` (cooldown 15분) +
   `[Watchlist 포화]` (cooldown 30분) 두 알림이 자주 발송. 후자는 *"alert 임계
   초과지만 soft cap 미달 — 능동 정리 미발동"* 같은 운영자 행동 불필요한
   정보까지 반복 노출.

3. **자기반성 narrative 텍스트 잘림** — Gemini reflection 응답이 본문 중간에서
   잘리는 사례 (예: *"이익 실현을 저해할 ..."* — 다음 문장 누락). ADR-0009
   PR-23 가 maxOutputTokens 2048 → 4096 으로 상향했으나 700자+ 한국어 narrative
   + JSON 구조 + claims/sources 배열 결합 시 4096 토큰 부족.

4. **/shadow_advisory 명령 미응답** — *"알 수 없는 명령어"* — 사용자 진단 후속.
   본 PR scope 외: PR #431 (Post-FOMC 4 항목 / shadowAdvisory.cmd.ts 신설) 의
   main 미머지 상태가 원인. PR #431 머지 시 자동 해소 — 본 PR 의 변경 없음.

## Decision

### 항목 1 — `stockPickReporter` ENV 가드 (default OFF)

`generateDailyPickReport()` 진입부에 ENV 가드:

```ts
if (process.env.DAILY_PICK_REPORT_ENABLED !== 'true') {
  console.log('[PickReport] DAILY_PICK_REPORT_ENABLED!=true — 발송 skip (ADR-0108)');
  return;
}
```

cron 자체는 그대로 유지 (`scheduledJob('30 7 * * 1-5', ...)` 평일 16:30 KST).
구독자 대상 발송 정책 도입 시 `DAILY_PICK_REPORT_ENABLED=true` 1줄로 즉시 활성.

### 항목 2 — `watchlistRepo` 노이즈 감축

| 변경 | 이전 | 신규 |
|------|------|------|
| Auto-Trim cooldown | 15분 | **8시간** (1일 1~2회) |
| Auto-Trim 발송 임계 | totalDropped > 0 | **totalDropped >= 3** (1~2개 무음) |
| 포화 cooldown | 30분 | **12시간** |
| 포화 발송 임계 | momentumCount > MOMENTUM_ALERT_THRESHOLD | **soft.MOMENTUM × 0.9** (또는 hard × 0.9 if softDisabled) |
| ENV 우회 | 없음 | `WATCHLIST_TRIM_ALERT_DISABLED=true` / `WATCHLIST_OVERFLOW_ALERT_DISABLED=true` |

소형 trim (1~2개) 은 자연 운영 — 알림 가치 부재. 포화 임계도 *능동 정리
미발동* 안내가 운영자 행동 불필요한 정보라 *soft cap 임박* 시에만 발송.

### 항목 3 — `REFLECTION_MAX_OUTPUT_TOKENS` 4096 → 8192

`server/learning/reflectionIntegrity.ts` 상수 2배 확장. Gemini 가 본문 중간에서
잘리던 케이스 차단. 토큰 비용 ↑ 하지만 자기반성은 1일 1회 cron 이라 부담 미미.

`reflectionGemini.test.ts` 의 단언 4096 → 8192 정합화.

### 항목 4 — `/shadow_advisory` 운영 안내 (본 PR 변경 0)

PR #431 (Post-FOMC) 의 `shadowAdvisory.cmd.ts` 가 commandRegistry 자동 등록
구조라 PR #431 머지 + production 배포 시 자동 해소. 별도 결함 아님.

## Consequences

### 즉시 효과 (배포 후)

- 일일 종목 픽 발송 차단 (default OFF). 매일 16:30 KST 무가치 메시지 0건.
- Watchlist 알림 빈도: 1일 1~2회 (이전 매 사이클 발송) → 운영자 인지 부담 ↓.
- 자기반성 narrative 가 본문 끝까지 완전 노출 → 잘린 메시지 영구 차단.

### 회귀 위험

- 항목 1: cron 자체는 유지 — `DAILY_PICK_REPORT_ENABLED=true` 즉시 활성.
- 항목 2: 임계 변경으로 중요한 포화 신호 누락 위험 → `soft × 0.9` 임계가 충분히
  보수적. ENV 우회 안전망.
- 항목 3: Gemini 토큰 비용 ↑ (4096 → 8192). 1일 1회라 부담 미미. budget 한도
  도달 시 ADR-0009 의 fallback (template) 자연 동작.

### 회귀 테스트 12 신규 + 정합 1 = 13

- `operatorNoiseReduction.test.ts` 12 (#1 가드 위치 2 + #2 cooldown/임계/ENV 5
  + #3 maxOutputTokens 3 + 시나리오 1 + 주석 보존 1)
- `reflectionGemini.test.ts` 정합 (4096 → 8192 단언 갱신)

### 본 PR scope 외 (후속)

- 일일 종목 픽 cron 자체 제거 — 구독자 정책 결정 후 별도 PR.
- Watchlist 알림 일일 요약 — 사이클별 발송 대신 1일 1회 통합 요약 (운영 데이터
  누적 후).
- Gemini token 사용량 모니터링 — REFLECTION_MAX_OUTPUT_TOKENS 8192 가 budget
  여유 안에 있는지 누적 추적.

## References

- ADR-0009 — 외부 데이터 호출 예산 (이전 maxOutputTokens 2048 → 4096 선행 작업)
- 사용자 보고 (2026-04-29) — 4 항목 통합 (일일 픽 / Watchlist 노이즈 / 자기반성
  잘림 / /shadow_advisory)
