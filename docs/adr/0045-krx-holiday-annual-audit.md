# ADR-0039: KRX 휴장일 연간 감사 + Patch 영속 (PR-D)

- **Status**: Accepted
- **Date**: 2026-04-26
- **Deciders**: architect (운영 자동화 + 휴장일 SSOT 보호)
- **Related**: PR-A (krxHolidays 헬퍼), PR-B (MarketDayClassifier, ADR-0037), PR-C (HolidayResumePolicy, ADR-0038)

## Context

`server/trading/krxHolidays.ts` 의 `KRX_HOLIDAYS` 는 **정적 하드코딩 Set**. 한국거래소
공식 휴장일을 매년 연말에 사람이 수동으로 추가해야 한다. 운영 갭 3종:

1. **연간 갱신 누락 위험** — 2027년 12월에 2028년 휴장일을 추가하지 않으면 신정·
   설날·어린이날 같은 주요 휴장이 정적 Set 에 없어 매매 엔진이 휴장일 영업일로 오인.
   PR-A/B/C 의 모든 가드(자기반성·스케줄러·연휴 복귀 정책)가 동시에 무력화.
2. **외부 KRX API 미연동** — 본 프로젝트는 한국 공공데이터포털 `getRestDeInfo` API
   인증 키 미보유. 자동 fetch 도입은 외부 API 의존성 증가 + 회로차단기 추가 필요.
3. **운영자 수동 갱신 채널 없음** — 차년도 휴장일을 알게 됐을 때 코드 PR 외에는
   추가 경로가 없다. 야간 서비스 운영 중 응급 patch 필요 시 재배포 강제.

## Decision

본 PR-D 에서 **외부 API 미연동 + 운영자 알림 기반 자동 감사** 시스템을 도입한다.
실제 fetch 자동화는 인증 키 확보 후 후속 PR-D-2 에서 검토.

### 1. `server/persistence/krxHolidayRepo.ts` 신설

영속 patch — `data/krx-holiday-patch.json` 에 운영자 수동 추가 휴장일 저장.

```typescript
export interface KrxHolidayPatchEntry {
  date: string;          // YYYY-MM-DD
  reason: string;        // '신정' / '설날' 등
  addedAt: string;       // ISO timestamp
  addedBy: 'manual' | 'audit';  // 추가 출처
}

export function loadKrxHolidayPatch(): Set<string>;
export function loadKrxHolidayPatchEntries(): KrxHolidayPatchEntry[];
export function appendKrxHolidayPatch(entries: KrxHolidayPatchEntry[]): void;
export function removeKrxHolidayPatchByDate(date: string): boolean;
```

### 2. `server/trading/krxHolidays.ts` mutable runtime Set 전환

```typescript
const STATIC_HOLIDAYS = new Set<string>([...]); // 기존 하드코딩
const _runtimeSet = new Set<string>(STATIC_HOLIDAYS);

// ReadonlySet — 외부 mutate 차단, 모듈 내부에서만 갱신 가능.
export const KRX_HOLIDAYS: ReadonlySet<string> = _runtimeSet;

export function reloadKrxHolidaySet(): void {
  _runtimeSet.clear();
  for (const v of STATIC_HOLIDAYS) _runtimeSet.add(v);
  for (const v of loadKrxHolidayPatch()) _runtimeSet.add(v);
}

export function isKrxHoliday(dateYmd: string): boolean {
  return _runtimeSet.has(dateYmd);
}
```

`trancheExecutor.ts` 가 직접 import 한 `KRX_HOLIDAYS` Set 도 동일 인스턴스라 reload
시 자동 반영. 부팅 시 `reloadKrxHolidaySet()` 1회 호출.

### 3. `server/trading/krxHolidayAudit.ts` 신설

```typescript
export interface KrxHolidayAuditResult {
  alerted: boolean;
  reason: 'NEXT_YEAR_REGISTERED' | 'NEXT_YEAR_MISSING' | 'INSUFFICIENT_FUTURE';
  registeredYears: number[];
  nextYear: number;
  nextYearHolidayCount: number;
  message?: string;
}

export async function runKrxHolidayAudit(now?: Date): Promise<KrxHolidayAuditResult>;
```

검증 로직:
- 현재 KST 연도 = N
- 차년도 N+1 휴장일이 STATIC_HOLIDAYS + patch 합산 ≥ 8개 이상 (한국 공휴일 평균
  최소치) 등록되어 있으면 OK.
- 미달 시 텔레그램 CRITICAL 경보 발송 + dedupeKey 1년 cooldown.

### 4. `server/scheduler/maintenanceJobs.ts` 매년 12/1 cron 추가

```typescript
// 매년 12월 1일 09:00 KST = UTC 11/30 00:00.
// 차년도 KRX 휴장일 등록 여부 검증 + 미등록 시 텔레그램 CRITICAL 경보.
cron.schedule('0 0 1 12 *', async () => {
  await runKrxHolidayAudit().catch((e) => console.error('[KrxHolidayAudit] 실행 실패:', e));
}, { timezone: 'UTC' });
```

ScheduleClass 적용은 본 PR scope 밖 (PR-B-2 후속).

### 5. SCHEDULE_CATALOG 항목 추가

```typescript
{ timeKst: '1일 09:00 (12월)', label: 'KRX 차년도 휴장일 감사', group: 'maintenance',
  jobName: 'krx_holiday_audit', silentWhen: '차년도 휴장일 ≥ 8개 등록되어 있으면 무음' }
```

### 6. 부팅 시 reload

`server/index.ts` 또는 `server/scheduler/index.ts` 에서 `reloadKrxHolidaySet()` 1회 호출.

## Consequences

### Positive
- **연간 갱신 누락 자동 감지** — 매년 12/1 알림으로 운영자가 차년도 휴장일을 등록할
  시간 확보 (1개월 여유).
- **응급 patch 가능** — 운영자가 `data/krx-holiday-patch.json` 직접 편집 후 서버
  재시작 또는 `reloadKrxHolidaySet()` 호출로 즉시 반영.
- **trancheExecutor 자동 정합** — `KRX_HOLIDAYS` Set 인스턴스 그대로 import 사용 중
  이라 reload 시 자동 갱신 (호출자 코드 0줄 변경).
- **기존 정적 Set 유지** — 정적 STATIC_HOLIDAYS 가 fallback 으로 살아있어 patch 파일
  손상 시에도 시스템 무중단.

### Negative
- **외부 API 자동 fetch 미포함** — 인증 키 부재로 운영자 수동 갱신 의존. PR-D-2 후속.
- **부팅 시 reload 1회 호출 필수** — 호출 누락 시 patch 미반영. 부팅 sequence 에 명시 추가.

### Neutral
- LIVE 매매 본체 0줄 변경 (kisClient/orchestrator/signalScanner/entryEngine 무수정).
- `KRX_HOLIDAYS` ReadonlySet 타입 시그니처 보존 — 외부 호출자 호환.

## Test Coverage

- `krxHolidayRepo.test.ts` (≥ 8 케이스)
  - 빈 파일 → 빈 Set
  - append → 디스크 영속 + 다음 load 반영
  - 동일 날짜 중복 append 차단 (idempotent)
  - removeKrxHolidayPatchByDate → 해당 entry 제거
  - 잘못된 JSON → 빈 Set fallback (시스템 무중단)
- `krxHolidayAudit.test.ts` (≥ 6 케이스)
  - 차년도 ≥ 8개 → alerted=false, reason='NEXT_YEAR_REGISTERED'
  - 차년도 < 8개 → alerted=true, telegramClient 호출 + CRITICAL priority
  - 차년도 0개 → alerted=true, reason='NEXT_YEAR_MISSING'
  - dedupeKey 연도별 분리 (2026 알림 후 2027 12/1 에 재발송 가능)
- `krxHolidaysReload.test.ts` (≥ 4 케이스)
  - reload 후 patch 항목이 KRX_HOLIDAYS Set 에 추가됨
  - reload 후 isKrxHoliday(추가 날짜) === true
  - reload 후 patch 제거 시 isKrxHoliday(제거 날짜) === false (반복 reload)
  - STATIC_HOLIDAYS 항목은 reload 후에도 보존
