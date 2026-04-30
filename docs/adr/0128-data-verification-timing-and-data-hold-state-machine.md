# ADR-0128: Data Verification Timing + DATA_HOLD State Machine

## Status
Accepted (2026-04-30) · Deciders: harness

## Context

사용자 18단계 설계안 후속. ADR-0117 (Sanity Trade-Block Gate) 이 `safePctChangeStrict`
*거래 차단 게이트* SSOT 와 `DataQualityInfo` 타입을 도입했지만 두 갭 잔존:

1. **검증 타이밍 정책 부재** — 현재는 매수 critical path 의 `evaluateEntryRevalidation`
   안에서 검증 → 실패 시 즉시 차단. 모든 종목을 매번 검증하면 부하 + 일시 장애 시
   다수 종목 동시 차단.
2. **DATA_HOLD 상태 fallback 정책 미분리** — ADR-0117 의 `WaitReason='DATA_HOLD'` 가
   호출자(perSymbolEvaluation) 의 단일 분기에서만 처리. *역할별*(매수 후보 / 워치리스트 /
   보유 포지션) fallback 정책이 SSOT 단일 모듈에 부재 → 보유 포지션 exit 경로 보존
   안전망이 분산.

### 사용자 명시 6 정책

1. 데이터 검증을 매수 critical path 에서 최대한 제거
2. 전일 장 마감 후 배치 검증 = 주 검증
3. 당일 신규 매수 후보만 증분 검증
4. DATA_HOLD 종목 역할별 fallback 분리
5. DART corporate action 이벤트 타입별 lookback 차등 적용
6. 3회 연속 검증 실패 = 텔레그램 알림 + 수동 검토 큐

## Decision

### 1. `server/data/dataHoldRolePolicy.ts` SSOT 신규

```typescript
export type DataHoldRole = 'BUY_CANDIDATE' | 'WATCHLIST' | 'HELD_POSITION';

export interface DataHoldAction {
  blockBuy: boolean;
  blockSell: boolean;        // 보유 종목 exit 보존 의무 (HELD_POSITION 항상 false)
  blockAlert: boolean;
  uiMarker: 'NONE' | 'PENDING_VERIFICATION';
  reason: string;
}

export function resolveDataHoldAction(role: DataHoldRole): DataHoldAction;
```

**정책 매트릭스 SSOT** (사용자 정책 #4 직접 반영):

| Role             | blockBuy | blockSell | blockAlert | uiMarker               | Reason                                       |
|------------------|----------|-----------|------------|------------------------|----------------------------------------------|
| BUY_CANDIDATE    | true     | (N/A)     | true       | NONE                   | 매수 후보 자동 탈락 (당일)                  |
| WATCHLIST        | true     | false     | true (보류) | PENDING_VERIFICATION   | 워치리스트 알림 보류 + UI 마킹              |
| HELD_POSITION    | true     | **false** | true       | PENDING_VERIFICATION   | 보유 종목 — 매수/알림 차단, exit 경로 유지  |

**ENV 우회** `DATA_HOLD_ROLE_POLICY_DISABLED=true` → 모든 역할에서
`blockSell=false` + `blockBuy=true` (안전 default — exit 항상 보존).

**절대 규칙** — `HELD_POSITION` 의 `blockSell` 은 영원히 false. KIS 현재가 기반 손절은
검증 실패와 무관하게 작동 (절대 규칙 #4 autoTradeEngine 단일 통로 정합).

### 2. `server/persistence/verificationQueueRepo.ts` 영속 SSOT 신규

```typescript
export interface VerificationQueueEntry {
  stockCode: string;
  stockName?: string;
  consecutiveFailures: number;
  firstFailedAt: string;       // ISO
  lastFailedAt: string;        // ISO
  lastFailureReason: string;   // safePctChangeStrict status 등
  nextRetryAt: string;         // ISO (1·2회 실패: +24h, 3회+: 수동 검토 대기)
  manualReviewState: 'NONE' | 'QUEUED' | 'APPROVED' | 'DROPPED';
  manualReviewedAt?: string;
  manualReviewedBy?: string;
}
```

**상수 SSOT** (사용자 정책 #6 직접 반영):
- `MAX_CONSECUTIVE_FAILURES = 3` (≥3 시 `manualReviewState='QUEUED'`)
- `RETRY_BACKOFF_HOURS = 24`
- `QUEUE_TRIM_LIMIT = 500` (FIFO trim)

**API**:
- `loadVerificationQueue()`
- `recordVerificationFailure(stockCode, reason, now?, stockName?)` — `consecutiveFailures++`
  + `firstFailedAt` 보존 + `lastFailureReason` 갱신 + `nextRetryAt` 산출 + 3회+ 시
  `manualReviewState='QUEUED'`
- `recordVerificationSuccess(stockCode, now?)` — entry 제거 (consecutive reset)
- `getEntriesEligibleForRetry(now?)` — `nextRetryAt ≤ now AND manualReviewState ∉ {QUEUED, DROPPED}`
- `getManualReviewQueue()` — `manualReviewState='QUEUED'`
- `setManualReviewState(stockCode, state, now?, reviewedBy?)`
- `__resetVerificationQueueForTests()`

**영속 정책**: atomic write tmp→rename / 손상 JSON 빈 배열 fallback / FIFO trim 500 /
`paths.ts` `VERIFICATION_QUEUE_FILE`.

**ENV 우회** `VERIFICATION_QUEUE_DISABLED=true` → record* 가 no-op.

### 3. `server/data/dataVerificationBatch.ts` 신규 (정책 #2 — 주 검증)

**cron**: `30 7 * * 1-5` (UTC 평일 07:30 = KST 평일 16:30) — 장 마감(15:30) 1시간 후.
ScheduleClass `'TRADING_DAY_ONLY'` (PR-D ADR-0045 정합).

**본체 흐름**:
1. `loadWatchlist()` → 모든 워치리스트 종목 대상
2. 각 종목 KIS daily quote 가져와서 `safePctChangeStrict` 평가 (current vs prev close,
   base age 검사)
3. `status='OK'` → `recordVerificationSuccess` + `clearDataQuarantine(entry)`
4. `status!='OK'` → `recordVerificationFailure` + `applyDataQuarantine(entry, role='WATCHLIST')`
5. 결과 요약 텔레그램 (CRITICAL — 실패 0건 시 silent, ≥1건 시 발송)

**dedupeKey** `data_verification_batch:{KST_DATE}` + 24h cooldown.
**ENV** `DATA_VERIFICATION_BATCH_DISABLED=true` → cron skip.

### 4. `server/data/dataVerificationIncremental.ts` 신규 (정책 #3 — 증분 검증)

**진입점**: 신규 매수 후보 발견 시점 (`watchlistManager.autoPopulateWatchlist` 또는
`signalScanner` 의 신규 진입 시점) 호출. 종목 단위.

**본체 흐름**:
1. `verificationQueueRepo` 에서 entry 조회
   - `manualReviewState ∈ {QUEUED, DROPPED}` → 즉시 `{ verified: false, action:
     resolveDataHoldAction('BUY_CANDIDATE'), reason: 'manual_review_pending' }`
2. `nextRetryAt > now` (cooldown 중) → 즉시 차단
3. KIS quote + `safePctChangeStrict` 평가
4. 성공 → `recordVerificationSuccess` + `{ verified: true }`
5. 실패 → `recordVerificationFailure` + `{ verified: false, action:
   resolveDataHoldAction('BUY_CANDIDATE'), dataQuality, reason }`

**Wiring 정책**: 본 ADR scope 안에 wiring 포함하되 NON-CRITICAL try/catch 격리 —
verification 실패 시 throw 가 매매 흐름 차단 안 함 (ADR-0117 의 strict 게이트가
별도 안전망).

### 5. `server/data/dartCorpEventClassifier.ts` 신규 (정책 #5)

DART `report_nm` 텍스트 기반 corporate action event 분류 + 이벤트 타입별 lookback
window 차등.

```typescript
export type DartCorpEventType =
  | 'STOCK_SPLIT'      // 액면분할
  | 'STOCK_MERGE'      // 액면병합
  | 'RIGHTS_OFFERING'  // 유상증자 / 권리락
  | 'NEW_SHARES'       // 신주발행
  | 'GENERAL';

export interface DartCorpEventLookback {
  eventType: DartCorpEventType;
  lookbackDays: number;
}

export const CORP_EVENT_LOOKBACK_DAYS: Record<DartCorpEventType, number> = {
  STOCK_SPLIT: 90,      // 분할: 90일 (사용자 명시)
  STOCK_MERGE: 60,
  RIGHTS_OFFERING: 30,
  NEW_SHARES: 14,
  GENERAL: 7,
};

export function classifyDartCorpEvent(reportNm: string): DartCorpEventType;
export function getCorpEventLookback(reportNm: string): DartCorpEventLookback;
```

**분류 규칙** (한국어 키워드 우선순위):
- `'액면분할' / '주식분할' / 'split'` → STOCK_SPLIT
- `'액면병합' / '주식병합' / 'merge'` → STOCK_MERGE
- `'유상증자' / '신주인수권' / '권리락'` → RIGHTS_OFFERING
- `'신주발행' / '주식배당'` (수량 변경) → NEW_SHARES
- 그 외 → GENERAL

**ENV 우회** `DART_CORP_EVENT_LOOKBACK_DISABLED=true` → 모든 이벤트 default 7일.

## Consequences

### Positive
- **LIVE 매매 본체 0줄 변경** — 검증 timing 분리 + 역할별 fallback SSOT 만, 매매
  결정 로직 무수정.
- **exit 경로 보존** — `HELD_POSITION` blockSell=false 절대 규칙으로 보유 종목 손절
  영원히 작동 (data quarantine 시에도).
- **검증 부담 분리** — 주 검증(batch 16:30) + 증분 검증(incremental 진입 시점)
  으로 매번 KIS 호출 차단. ADR-0117 strict 게이트가 매수 critical path 안전망 유지.
- **3회 실패 → manual review** — 자동 격리만으로는 종목이 영구 차단되는 위험을 운영자
  검토 큐로 흡수.

### Negative
- DART 분류기는 한국어 키워드 휴리스틱 — false positive 가능 (ENV `DART_CORP_EVENT_LOOKBACK_DISABLED`
  로 즉시 우회).
- batch cron 누락 시 incremental 만 작동 — 워치리스트 전체 검증 부재 가능 (다음
  영업일 batch 가 자동 회복).

### Neutral
- manual review queue 는 **운영자 개입 의무** — 3회+ 연속 실패 종목은 텔레그램 알림
  후 수동 APPROVED/DROPPED 결정 필요. 별도 텔레그램 명령은 후속 PR scope.

## Migration

**ENV 5종** (default = 정책 적용 / `*_DISABLED=true` 시 ADR-0117 동작 복원):
1. `DATA_HOLD_ROLE_POLICY_DISABLED` — 역할별 fallback 차단 (모든 역할 안전 default)
2. `VERIFICATION_QUEUE_DISABLED` — record* no-op (회로 무력화)
3. `DATA_VERIFICATION_BATCH_DISABLED` — cron skip
4. `DART_CORP_EVENT_LOOKBACK_DISABLED` — 분류기 우회 (default 7일)
5. `DATA_QUALITY_STRICT_DISABLED` (ADR-0117 기존) — strict 게이트 자체 무력화

**점진 활성화 권장** — Phase 1: SSOT 모듈 + 영속 + DART 분류기만 (호출자 wiring 0건).
Phase 2: batch cron 활성화 + 증분 진입점 wiring (try/catch 격리). Phase 3: manual
review 텔레그램 명령 추가.

## Wiring (본 PR + 후속)

**본 PR scope (architect SSOT 신설 단계)**:
- 5 모듈 SSOT 정의 (engine-dev 가 1:1 따라 구현)
- batch cron 등록 + incremental 진입점 함수 export
- ADR-0128 + ARCHITECTURE.md +5 boundary +1 rule

**후속 PR (wiring 점진)**:
- `signalScanner` / `autoPopulateWatchlist` 본체에서 `dataVerificationIncremental`
  호출 wiring (try/catch 격리)
- `perSymbolEvaluation` DATA_HOLD 분기에서 `resolveDataHoldAction(role)` 사용 (현재
  하드코딩된 정책을 SSOT 위임)
- `exitEngine` 의 보유 포지션 처리에서 HELD_POSITION blockSell=false 의무 검증
- `dartPoller` (있는 경우) 가 `getCorpEventLookback` 사용
- `/verification_queue` 텔레그램 명령 (manual review)

## References
- ADR-0117 — Sanity Trade-Block Gate (`safePctChangeStrict` SSOT)
- ADR-0113 — Yahoo Drift Tiered Sanity + Corporate Action Detector
- ADR-0114 — Data Trust Layer 3-tier
- ADR-0115 — entryPrice immutable + 실행 레이어 완화
- ADR-0116 — RAW/ADJUSTED 분리 + Gate3 ENV 완화 wiring
- ADR-0118 — 매수 차단 사유 진단 인프라
- 사용자 18단계 설계안 §6 / §15 / §16
