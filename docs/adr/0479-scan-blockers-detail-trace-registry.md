# ADR-0479 scan_blockers Detail Trace Registry SSOT

Status: Accepted / Documentation-only (wiring 후속 PR 분리)

## Context

ADR-0478 §3 Section Metadata SSOT 가 정의한 schema (sectionId / sourceAdr / sourceSsotPath / computedAt / inputHash / truncated) 는 *영속 layer* 가 부재하면 매 호출마다 재산출되는 임시 값일 뿐이다. ADR-0420 (Fresh Scan Blocker Attribution) + ADR-0422 (Gate2 Leadership Attribution) 가 이미 *fresh 스캔 시점* 의 진단 데이터를 `ScanSummary` 에 영속하지만, 다음 결함이 잔존:

1. **섹션별 산출 trace 부재** — 운영자가 `/scan_blockers` 응답을 받았을 때 *각 섹션이 어느 SSOT 함수가 어떤 입력을 받아 산출했는지* 추적 불가. 본문 요약만 있고 *결정 트리 trace* 는 영속 0건.
2. **압축된 섹션 detail 접근 경로 부재** — ADR-0478 의 length budget compress 정책이 작동하면 *낮은 priority 섹션* 이 잘림. 운영자가 잘린 정보를 보려면 별도 명령이 있어야 하는데 *어느 명령으로 접근하는지* SSOT 부재.
3. **historical scan trace 부재** — 직전 스캔만 `getLastScanSummary()` 로 노출, *2~5 사이클 전 trace* 운영자가 비교 불가. cron 사이클 사이 결함 발생 시 사후 추적 도구 부재.
4. **섹션별 origin SSOT path 검증 부재** — 운영자가 진단 메시지 보고 *어느 코드 위치가 산출 source 인지* 추적하려면 git grep 후 sourceSsotPath 미부재. ADR-0146 §"audit 학습 데이터" 정합한 SSOT 가 없음.

## Decision

ADR-0478 의 *단일 메시지 압축 정책* 을 보완하는 *별도 detail trace registry* + 운영자 명시 호출 명령 (`/scan_blockers_detail`) 도입. 본 ADR 의 *문서화* scope 외 — 별도 후속 PR 에서 점진 적용 (회귀 위험 격리, ADR-0146 §"단일 책임" + ADR-0148 §"PR 분할 정책" 정합).

### 1. Detail Trace Schema SSOT

```typescript
interface ScanBlockersDetailTraceEntry {
  scanId: string;                     // ScanSummary.scanId
  scanCompletedAt: string;            // KST ISO
  sectionId: string;                  // ADR-0478 priority registry key
  sourceAdr: string;                  // 'ADR-0431' / 'ADR-0448' 등
  sourceSsotPath?: string;            // 'server/learning/.../...ts' (debug 용)
  inputDigest?: {                     // sanitized — raw payload 영속 0
    inputCount?: number;              // record / entry 카운트
    inputHash?: string;               // sha256 first 8 chars (identity)
    decisionTrace?: string[];         // SSOT 결정 트리 분기 라벨 (예: ['STOCK_DAILY tainted', 'leadership BLOCKED'])
  };
  output: {
    rendered: string;                 // 본 섹션 final string (Telegram safe, ≤2048 chars)
    priority: number;                 // ADR-0478 registry value
    truncated: boolean;               // ADR-0478 budget compress 결과
    durationMs?: number;              // 산출 latency (debug)
  };
  computedAt: string;                 // 섹션 산출 시각 (KST ISO)
}
```

### 2. Persistence SSOT

신규 영속 파일 `data/scan_blockers_detail_trace.json` (예정) — atomic write tmp→rename + FIFO `MAX_SCAN_TRACE_ENTRIES=200` (직전 ~50 스캔, 1 사이클당 4 섹션 평균) + 손상 JSON 빈 배열 fallback. **물리 분리** — 다른 ledger (shadow-trades / counterfactual-shadow-learning / counterfactual-universe-learning) 와 절대 합치지 않음 (ADR-0146 §"단일 책임").

### 3. Sanitized Input Digest 정책 (절대 변경 금지)

`inputDigest` 는 *민감 정보 0 영속* 의무:

- **금지** — raw quote payload / KIS API response / cookie / token / Authorization / 계좌번호 / `total_assets` / `orderable_cash` / personal Telegram ID.
- **허용** — `inputCount` (record 갯수, scalar) / `inputHash` (sha256 first 8 chars, identity 비교용) / `decisionTrace` (SSOT 결정 트리 분기 *라벨* 만, 값 0).

ADR-0445 sanitized sample 정책 + ADR-0148 SilentDegradation 정합 — sanitized metadata 만, raw payload 0.

### 4. `/scan_blockers_detail [scanId?] [sectionId?]` 텔레그램 명령

신규 명령 (`server/telegram/commands/system/scanBlockersDetail.cmd.ts` 예정) — SYS riskLevel=0 ADMIN read-only:

- 인자 없음 → 직전 scan 의 모든 섹션 detail (압축된 섹션 포함, full rendered output)
- `scanId` 만 → 특정 scan 의 모든 섹션
- `scanId sectionId` → 특정 scan 의 특정 섹션 (full + decisionTrace)
- 5분 rate-limit (운영자 진단 명령 표준 패턴)
- 외부 API 호출 0 (영속 read only)

### 5. 운영자 cognitive load 보호

`/scan_blockers` (요약, ADR-0478 압축 정책) ↔ `/scan_blockers_detail` (전체 + trace, 본 ADR) — 두 명령의 책임 분리:

- `/scan_blockers` = *지금 운영 안전한가?* (≤4096 char, 우선순위 최상위 섹션 보장)
- `/scan_blockers_detail` = *왜 그렇게 산출됐는가?* (전체 trace, 운영자 명시 호출)

운영자가 사후 추적 (예: *3 사이클 전 sectorEnergy 가 BLOCKED 였던 이유*) 할 때만 detail 명령 호출 — *기본 진단 흐름* 변경 0.

### 6. 영속 trace 자동 정리 정책

- FIFO 200 entry trim (atomic write 시점 자동)
- 7일 이상 entry 자동 제거 (TTL — 운영 데이터 누적 부담 차단)
- 영속 schema 변경 시 `schemaVersion` 필드 (옵셔널 후방호환) 도입 — ADR-0148 §"silent degradation" 정합

## Policy

ADR-0479 는 *문서 SSOT 정착* 단계. wiring 은 별도 후속 PR 분리:

- **본 ADR (PR scope)**: ADR-0478 + ADR-0479 markdown 문서 + INDEX.md 갱신만.
- **후속 PR-0479-Wiring-1**: `scanBlockersDetailTraceRepo.ts` SSOT 신설 (영속 layer + sanitized digest 산출 + 회귀 테스트 ≥30 케이스).
- **후속 PR-0479-Wiring-2**: ADR-0478 priority registry 와 통합 — 각 섹션이 trace entry 생성 (try/catch 격리 의무).
- **후속 PR-0479-Wiring-3**: `/scan_blockers_detail` 텔레그램 명령 신설 + 회귀 테스트.
- **후속 PR-0479-Wiring-4**: 7일 TTL 자동 정리 cron + scheduleCatalog 등재.

모든 wiring 의 출력은 다음을 보존 (ADR-0478 §Policy 정합):

- `executionImpact = NONE`
- `liveExecutionAllowed = false`
- `policyPromotionMode = SHADOW_ONLY`
- KIS 주문 함수 5종 import 0건
- autoTradeEngine·orderExecutor·trancheExecutor import 0건
- Gate threshold + condition weight + STRONG_BUY 조건 0 변경
- 외부 API 신규 호출 0건 (영속 read only)

## Invariants (절대 변경 금지)

1. raw payload 영속 0건 (sanitized inputDigest 만 — `inputCount` / `inputHash` / `decisionTrace` 라벨)
2. token / cookie / 계좌번호 / `total_assets` / `orderable_cash` / 개인 Telegram ID 영속 0건 (ADR-0445 sensitive keyword lint 정합)
3. 다른 ledger (shadow-trades / counterfactual-* / provisional-*) 와 물리 분리
4. trace write 실패 시 `/scan_blockers` 응답 자체 차단 0 (try/catch 격리 의무)
5. detail 명령은 read-only (영속 write 0 / 외부 API 호출 0)
6. trace entry 7일 TTL 자동 정리 (영속 누적 차단)
7. KIS 주문 함수 5종 import 0건
8. autoTradeEngine·orderExecutor·trancheExecutor import 0건
9. Gate threshold + condition weight + STRONG_BUY 조건 + SectorEnergy 점수 산출 0 변경
10. 본 ADR wiring 시 LIVE 매매 본체 0줄 변경
11. ENV `SCAN_BLOCKERS_DETAIL_TRACE_DISABLED=true` (default OFF, ADR-0157 정확 비교) — 1줄 즉시 비활성 (회귀 안전망)
12. 호출자 측 inline ENV 검사 0건 (`isScanBlockersDetailTraceDisabled()` SSOT 위임 의무, ADR-0185~0189 정합)

## 잘못된 해결 방법 (영구 차단)

- **`/scan_blockers` 본 메시지에 trace 노출** — Telegram budget 낭비 + 운영자 cognitive load 격증 → 별도 detail 명령 분리 의무.
- **raw payload 영속** — 보안 위반 (token / cookie / personal info 누출) → sanitized digest 의무.
- **trace ledger 와 다른 영속 통합** — 단일 책임 위반 + drift 위험 → 별도 영속 파일 의무.
- **trace write throw 시 `/scan_blockers` 응답 차단** — 진단 도구가 진단 자체를 막는 회귀 → try/catch 격리 의무.
- **TTL 미설정 (영구 영속)** — 디스크 누적 + 운영 데이터 폭주 → 7일 TTL 의무.
- **본 ADR 발급 시점에 wiring 통합** — 회귀 위험 격리 (ADR-0146 §"단일 책임" 위반) → 별도 PR 분리.
- **`/scan_blockers_detail` 가 외부 API 호출** — 진단 도구가 외부 quota 부담 → read-only 영속 only 의무.

## 후속 PR 후보 (scope 외)

- PR-0479-Wiring-1: `scanBlockersDetailTraceRepo.ts` SSOT + sanitized digest + 회귀 테스트
- PR-0479-Wiring-2: ADR-0478 priority registry 통합 + 섹션별 trace entry 자동 생성
- PR-0479-Wiring-3: `/scan_blockers_detail` 텔레그램 명령 + 회귀 테스트
- PR-0479-Wiring-4: 7일 TTL 자동 정리 cron + scheduleCatalog 등재
- PR-0479-Followup-1: trace 데이터 기반 *섹션 산출 latency p95 모니터링* (별도 ADR scope)

## Cross-References

- ADR-0118 — `/scan_blockers` diagnostic infrastructure (본 ADR 의 직접 base)
- ADR-0146 — PR 자가 review 5 카테고리 + audit findings 가 학습 데이터
- ADR-0148 — INDEX SSOT + 4 정적 검증 도구 (silentDegradation / ADR Index / pendingWiring / prPaceAudit)
- ADR-0157 — ENV 정확 비교 의무
- ADR-0159 — ADR 별칭 정책 (충돌 ADR 인용 시 별칭 사용)
- ADR-0185~0189 — ENV 헬퍼 SSOT 위임 패턴
- ADR-0420 — Fresh Scan Blocker Attribution (영속 ScanSummary, 본 ADR 의 stack 전제)
- ADR-0422 — Gate2 Leadership Attribution (영속 sectorEnergy 진단)
- ADR-0445 — sanitized sample 정책 (raw payload 영속 금지, 본 ADR sanitized digest 의 base)
- ADR-0478 — scan_blockers Compact Output Policy SSOT (본 ADR 의 짝 ADR — `/scan_blockers` 압축 정책 + section priority registry)
