# ADR-0056 — Yahoo Probe 알림 폭주 제거 + Health SSOT 통합

**상태**: Accepted (2026-04-26)
**관련 PR**: claude/fix-yahoo-probe-errors-BCBZh
**관련 ADR**: ADR-0049 health diagnostics SSOT (PR-49) / ADR-0009 external data call budget / ADR-0029 Egress Guard

## 1. 배경

`server/trading/pipelineDiagnosis.ts:84~104` 의 ⑤ Yahoo Finance 응답성 테스트가 KST 02:00 새벽 cron(`runSelfDiagnosis`) 에서 SK하이닉스(`000660.KS`) 단일 심볼로 `guardedFetch` 1회 호출 후 503/timeout 시 곧바로 Telegram warning 푸시했다.

문제 3종:

1. **단발성 503 알림 폭주** — Yahoo 의 단발성 503/502/504 가 새벽마다 1회 알림 발생. 실제 장 영향 없는 transient 장애가 운영자 인지 부담 유발. 사용자 보고 — 매일 새벽 "🩺 새벽 자가진단" 알림 1건.
2. **단일 심볼 false positive** — 000660.KS 페이지만 일시 문제여도 전체 Yahoo 장애로 잘못 판단.
3. **자체 fetch 가 SSOT 위반** — `server/health/diagnostics.ts` 의 `getYahooHealthSnapshot()` (24h 누적 통계) 이 이미 SSOT 인데 pipelineDiagnosis 가 별도 fetch 호출. PR-49 ADR-0049 의 health diagnostics SSOT 정합성 결손.

추가 시간대 문제:
- KST 02:00 = 미국 EST 12:00 = 미국 점심시간 — 운영적으로 의미 없는 시간대.
- 장 시작 7시간 전이라는 명목은 유지하되, *데이터 신선도* 와 *운영 관련성* 이 동시 극대화되는 시간 = NYSE 마감 직후 + 한국장 개장 2.5h 전 = **KST 06:30**.

## 2. 결정

5개 아이디어를 *누적* 적용하되, **3번 SSOT 통합이 1·5번을 흡수하는 구조** 채택:

### 2.1 의사결정 매트릭스

| 아이디어 | 채택 | 적용 위치 | 비고 |
|----------|:----:|-----------|------|
| 1. 단발성 503 1회 자동 재시도 (query1→query2) | ✅ | `server/utils/yahooProbeRetry.ts` 신설 | 미래 확장점 — pipelineDiagnosis 본체는 SSOT 만 사용 |
| 2. 02:00 → 06:30 KST 이동 | ✅ | `healthCheckJob.ts` cron 한 줄 | NYSE 마감 직후 + 개장 2.5h 전 |
| 3. Health Diagnostics SSOT 통합 | ✅ | `pipelineDiagnosis.ts` 자체 fetch 제거 | 핵심 — 단발성 503 자연 흡수 |
| 4. 알림 등급 분리 (OPERATIONAL / INFORMATIONAL) | ✅ | `DiagnosisResult.informational` 필드 + healthCheckJob 분기 | INFORMATIONAL 은 일일 요약에만 |
| 5. 다중 종목 Probe (3종목) | ✅ | `yahooProbeRetry.ts` 확장점 | 미래 진단 도구·API 호출용 |

### 2.2 누적 적용 의사결정

3번 SSOT 통합이 채택되면 1번(retry 헬퍼)과 5번(다중 심볼)은 pipelineDiagnosis 진입점에서는 *직접 사용되지 않는다* — 자체 fetch 자체가 제거되기 때문이다. 그러나 5개 아이디어를 모두 *코드에 반영* 하는 권장 구조로:

- `yahooProbeRetry.ts` 신설 = 미래 확장점 (수동 진단 명령·관측성 SSOT)
- `pipelineDiagnosis.ts` SSOT 통합 = 자동 새벽 cron 의 알림 폭주 즉시 차단
- `informational` 필드 = 등급 분리로 OPERATIONAL/INFORMATIONAL 텔레그램 분기

이 구조가 회귀 위험 최소(자동 cron 의 외부 호출 0건) + 미래 확장(`yahooProbeRetry` 가 향후 `/probe yahoo` 텔레그램 명령 등에서 활용 가능) 양립.

## 3. 모듈 / 시그니처

### 3.1 `server/utils/yahooProbeRetry.ts` (신규, ≤120 LoC)

```ts
/** @responsibility Yahoo probe 다중 호스트 재시도 + 다중 심볼 헬퍼 — pipelineDiagnosis SSOT 통합 후 미래 확장점. */
export const PROBE_SYMBOLS = ['000660.KS', '247540.KQ', 'EWY'] as const;
export const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
export const PROBE_TIMEOUT_MS = 8_000;
export const RETRY_BACKOFF_MS = 2_000;

export interface YahooProbeOptions { timeoutMs?: number; backoffMs?: number; signal?: AbortSignal; }
export interface YahooProbeResult { ok: boolean; status?: number; error?: string; host?: 'query1' | 'query2'; retried?: boolean; }
export interface MultiProbeResult { total: number; failCount: number; results: Array<{ symbol: string } & YahooProbeResult>; }
export type MultiProbeStatus = 'OK' | 'DEGRADED' | 'DOWN';

export function shouldRetryYahooStatus(status?: number): boolean;
export function classifyMultiProbeResult(failCount: number, total: number): MultiProbeStatus;
export async function probeYahooWithRetry(symbol: string, options?: YahooProbeOptions): Promise<YahooProbeResult>;
export async function probeMultipleSymbols(symbols?: readonly string[], options?: YahooProbeOptions): Promise<MultiProbeResult>;
```

핵심 동작:
- query1.finance.yahoo.com 1회 시도 → 503/502/504/429 시 `RETRY_BACKOFF_MS` 대기 후 query2 재시도 (서로 다른 호스트라 의미 있음)
- 4xx (429 제외) 는 영구 오류로 즉시 실패 — 재시도 무의미
- `guardedFetch` 경유 (EgressGuard SSOT 준수, ADR-0029)
- AbortController 8초 timeout
- Promise.allSettled 로 다중 심볼 병렬 처리
- `classifyMultiProbeResult`: failCount/total ≥ 2/3 → DOWN, ≥ 1/3 → DEGRADED, 0 → OK

### 3.2 `server/trading/pipelineDiagnosis.ts` SSOT 통합

- 라인 84~104 의 `guardedFetch(...000660.KS...)` 호출 + 응답 상태 분기 *전체 제거*
- 대신 `getYahooHealthSnapshot()` (`marketDataRefresh.ts`) 만 read-only 호출
- 분기:
  - `status === 'OK'` → 알림 없음
  - `status === 'STALE'` → `informational` (일일 요약에만)
  - `status === 'DEGRADED'` (consecutiveFails 2~4) → `informational`
  - `status === 'DOWN'` (consecutiveFails ≥ 5) → `issues` (CRITICAL — 즉시 텔레그램)
  - `status === 'UNKNOWN'` (단 한 번도 호출 안 됨) → `informational` (cron 첫 실행 시 정상)

추가: 새 필드 `DiagnosisResult.informational: string[]` (옵셔널 권장 — 후방호환).

### 3.3 `server/scheduler/healthCheckJob.ts` 변경

- cron `'0 17 * * 0-4'` (UTC 17:00 = KST 02:00) → `'30 21 * * 0-4'` (UTC 21:30 = KST 06:30)
- `runSelfDiagnosis` 본체에서 `informational` 분기 추가 — INFORMATIONAL 만 있으면 텔레그램 푸시 0건 (console.log 만), OPERATIONAL(issues) 또는 warnings 가 있을 때만 푸시
- INFORMATIONAL 누적 통계는 후속 PR (`/diagnostics_summary` 명령 또는 09:05 헬스체크에 합쳐 전송) — 본 PR scope 밖

### 3.4 ARCHITECTURE.md boundary

- `server/utils/yahooProbeRetry.ts` — Yahoo 다중 호스트 재시도 + 다중 심볼 probe SSOT (미래 확장점)
- Boundary rule: "pipelineDiagnosis 는 Yahoo 직접 fetch 금지 — `getYahooHealthSnapshot()` SSOT 만 read"

## 4. 회귀 영향 / 안전성

- **외부 호출 변화**: 자동 cron 의 Yahoo 직접 fetch *제거* — Yahoo 부담 감소 + 단발성 503 알림 자동 차단
- **호환성**: `DiagnosisResult.informational?` 옵셔널 필드라 외부 호출자(healthCheckJob) 만 영향 + 후방호환
- **자동매매 영향**: 0건 — pipelineDiagnosis 결과는 진단 알림 전용, signalScanner/entryEngine/exitEngine 무관
- **회로차단기·블랙리스트**: 자체 fetch 제거로 회로 부담 추가 감소 (PR-21·24 정책 정합)
- **시간대 영향**: 02:00 → 06:30 이동 — DAY 시간대 cron 영향 없음 (TRADING_DAY_ONLY 평일 가드 유지)

## 5. 검증 계획

- 회귀 테스트: `yahooProbeRetry.test.ts` (≥10 케이스) + `pipelineDiagnosis.diagnosis.test.ts` (≥6 케이스, getYahooHealthSnapshot mock 으로 5분기 검증)
- 운영 측정: 본 PR 배포 후 1주 — 새벽 알림 빈도 1/주 ↓ (베이스라인 7/주 대비 86% 감소 목표)
- 손절 조건: 1주 후 알림 0건이면 검사 자체 의미 부재 가능성 검토 → 후속 PR 로 다중 심볼 probe 활성화 검토

## 6. 관련 결정 / 후속 PR

- 본 PR: 5 아이디어 모두 코드에 반영 (Y1 모듈 신설 + Y3 SSOT 통합 + Y2 시간 이동 + Y4 등급 분리 + Y5 헬퍼 다중 심볼 미래 확장점)
- 후속 PR 후보: `/probe yahoo` 텔레그램 명령 (yahooProbeRetry 직접 호출), 09:05 헬스체크에 INFORMATIONAL 누적 합산 표시

## 7. 페르소나 정합

페르소나 철학 1 ("필터링") + 8 ("불확실성 시 관망") UI 레벨 적용 — *진짜 운영 영향* 인 5회 연속 실패만 OPERATIONAL 알림. 단발성 503 은 "운영 무관 = 정보 누적" 으로 분리해 운영자 인지 부담 차단.
