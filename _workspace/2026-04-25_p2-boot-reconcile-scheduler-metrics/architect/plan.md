# PR-50 P2 부팅 reconcile dry-run + scheduler 메트릭

브랜치: `claude/health-diagnostics-menu-sync-KA7e9` (PR-49 와 같은 브랜치, 별도 commit)

## 결정 1 — 부팅 reconcile 위치

**선택: 신규 모듈 `server/trading/bootReconcile.ts`**
- server/index.ts inline 으로 두면 테스트 곤란 + 함수 길이 30~40줄 추가
- 신규 모듈 = 단일 책임 + 테스트 쉬움
- index.ts 는 30초 setTimeout + dynamic import 만 담당 (5줄)

## 결정 2 — 부팅 reconcile 트리거 조건

```
AUTO_TRADE_MODE === 'LIVE' AND AUTO_TRADE_ENABLED === 'true'
AND 이미 발송한 dedupeKey 없음 (boot_reconcile:YYYY-MM-DD)
```

mismatch 판정: `summary.QTY_DIVERGENCE + GHOST_LOCAL + GHOST_KIS > 0`. MATCH 만 있으면 알림 스킵.

KIS 조회 불가 (`kisQueryable=false`)는 `unavailableReason` 만 디버그 로그, 알림 미발송.

## 결정 3 — 알림 priority

- **HIGH** — mismatch 발견 시 (운영자가 즉시 확인 필요).
- 미발견 시 알림 미발송 (정상 부팅은 채팅 노이즈 ↑).
- dedupeKey: `boot_reconcile:YYYY-MM-DD` — 하루 1회 (재배포 빈번 보호).

## 결정 4 — JobMetrics 스키마

```typescript
export interface JobMetrics {
  jobName: string;
  runCount: number;        // success + failure + skipped 합
  successCount: number;
  failCount: number;
  skippedCount: number;
  lastSuccessAt?: string;  // ISO
  lastFailureAt?: string;  // ISO
  lastErrorMessage?: string; // 최근 실패 메시지 (≤120자 절삭)
}

export function getJobMetrics(jobName: string): JobMetrics | undefined;
export function getAllJobMetrics(): JobMetrics[];  // failCount 내림차순 정렬
```

`recordScheduleRun()` 안에서 자동 갱신. 기존 `_lastByJob` Map 과 별개로 `_metricsByJob: Map<string, JobMetrics>` 추가.

## 결정 5 — 메트릭 노출

본 PR scope:
- 데이터 수집만 (recordScheduleRun → metrics 갱신).
- export 함수 2개 (`getJobMetrics`, `getAllJobMetrics`).

본 PR scope 밖 (후속 PR):
- `formatSchedulerHealth()` 텔레그램 출력
- `/scheduler health` 명령어
- 정기 알림 (실패율 ≥ 50% 임계 등)

이유: P2 작업량 최소화 — 데이터 수집 정착 후 활용은 별도.

## 영향 파일

- 신규: `server/trading/bootReconcile.ts` + `bootReconcile.test.ts`
- 신규: `server/scheduler/scheduleCatalogMetrics.test.ts`
- 수정: `server/scheduler/scheduleCatalog.ts` (+JobMetrics 인터페이스 + _metricsByJob Map + recordScheduleRun 갱신 + getJobMetrics + getAllJobMetrics)
- 수정: `server/index.ts` (setTimeout 30s → bootReconcile dynamic import)
- 수정: `CLAUDE.md` (변경 이력 한 줄)

## DoD

- [ ] `npm run lint` pass
- [ ] `npm run validate:all` pass
- [ ] `vitest server/trading/bootReconcile + server/scheduler` ≥10 케이스 pass
- [ ] `npm run precommit` pass
- [ ] LIVE 자동매매 무영향 (dry-run only, AUTO_TRADE_ENABLED 가드)
- [ ] KIS 조회 실패 시 silent skip (channel noise 방지)
