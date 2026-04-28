# ADR-0090 — Cache Coherence Auditor (영속 파일 cross-consistency invariants SSOT)

**상태**: Accepted (PR-Z 옵션 C)
**작성일**: 2026-04-28
**관련**: ADR-0006 (Attribution composite key), ADR-0077 (TradeSignalStatus), ADR-0024 (Regime Memory Bank)

## 배경

`server/persistence/paths.ts` 에 79 개 `*_FILE` 상수 — 매 PR 마다 1~3 개씩 누적
중. 이 중 *서로 참조하거나 정합 규칙* 이 있는 파일들이 늘어나면서, 파일 단위 검증
(각 repo 의 영속/회귀 테스트) 만으로는 **cross-file invariant** 위반을 감지할 수
없는 사각지대가 형성됐다.

발견 가능한 위반 시나리오:

- **OCO ghost 주문** — `oco-orders.json` 의 `id` 가 가리키는 SHADOW trade 가 이미
  HIT_TARGET / 수동 삭제됐지만 OCO 가 ACTIVE 로 남아 KIS 주문 폴링이 무한 반복.
  PR-21 / PR-24 (KIS 회로차단·블랙리스트) 가 누적 부담을 차단하지만, **데이터 자체
  의 정합성** 은 별개.
- **PENDING fillMonitor 무한 폴링** — `pending-orders.json` 의 `relatedTradeId` 가
  `shadow-trades.json` 안에 부재 → fillMonitor 가 매 분 폴링하며 어디에도 결과 반영
  못 함 (PR-7 부팅 백필이 정상이지만 누락된 케이스 존재 시 진단 부재).
- **Attribution schema drift** — PR-19 `CURRENT_ATTRIBUTION_SCHEMA_VERSION=2` 마이
  그레이션 후 일부 record 가 v1 그대로 남아있는 상태. 학습 결과가 일부 record 를
  제외하거나 잘못된 가중치로 처리될 위험.
- **TradeSignalStatus 정합 위반** — PR-Z7 ADR-0077 의 6 상태 머신에서
  `BLOCKED`/`AUTO_TRADE_READY` 는 `finalizedAt` 필수, `AI_CANDIDATE` 등 non-terminal
  은 `finalizedAt` 부재 — 본 정합이 깨지면 `/signal_status` 진단 신뢰도 ↓.
- **Condition Weights 폭주** — `condition-weights.json` 의 모든 값은 [0.1, 2.0]
  범위에 있어야 한다. F2W Drift Detector (ADR-0046) 가 변화율을 감시하지만, *현재
  값이 이미 음수/0/극단값* 인 상태는 별개로 검증 부재.

사용자 진단 (옵션 C — 부채 #3): "지금까지 사고는 0건이지만, 발생 시 디버그 어렵다.
인프라 정비." → *예방 인프라* 로 도입.

## 결정

`server/persistence/cacheCoherenceAuditor.ts` 신설. **read-only 검증 모듈** —
영속 파일을 *수정하지 않으며* 외부 호출(KIS/KRX/Yahoo) 0 건. 5 종 invariant 를
한 번에 검사.

### Invariant 매트릭스

| ID  | 검사                                       | 위반 시 severity                      |
|-----|-------------------------------------------|--------------------------------------|
| I1  | OCO `id` ∈ SHADOW `id`                    | CRITICAL (ghost 매도)                |
| I2  | PENDING `relatedTradeId` ∈ SHADOW `id`     | CRITICAL (무한 폴링)                 |
| I3  | Attribution `schemaVersion` = CURRENT      | WARN (마이그레이션 누락)             |
| I4  | TradeSignal status ↔ finalizedAt 정합      | WARN (진단 신뢰도)                   |
| I5  | ConditionWeight value ∈ [0.1, 2.0]         | WARN (범위 초과) / CRITICAL (음수·0) |

### 모듈 인터페이스

```ts
runCoherenceAudit(now?: Date): CoherenceAuditReport
// 5 종 일괄 검사 + summary + capturedAt + disabled 플래그

auditOcoShadowReferences(ocoOrders, shadows): CoherenceViolation[]
auditPendingShadowReferences(pendingOrders, shadows): CoherenceViolation[]
auditAttributionSchema(records): CoherenceViolation[]
auditTradeSignalIntegrity(records): CoherenceViolation[]
auditConditionWeightsRange(weights): CoherenceViolation[]
// 입력 주입형 순수 함수 (단위 테스트 용이)
```

### 회로 차단 ENV

`CACHE_COHERENCE_AUDIT_DISABLED=true` → `runCoherenceAudit` 가 즉시
`{ disabled: true, violations: [] }` 반환. 진단 자체가 회귀 위험 만들 가능성에
대비한 긴급 우회.

### 진입점 2 종

1. **HTTP**: `GET /api/system/coherence-audit` (systemRouter, read-only).
2. **Telegram**: `/coherence_audit [N=10]` (alias `/cohere`, SYS, riskLevel=0,
   ADMIN). `formatCoherenceAuditMessage(report, N)` SSOT 빌더 — CRITICAL 우선
   정렬 + Top N 절삭 + HTML escape (recordId 의 `<>&` 안전).

## 비결과 (out-of-scope)

- **자동 수정**: ghost OCO 자동 청산, attribution 자동 마이그레이션 등은 모두
  scope 밖. 본 모듈은 *진단만*. 실제 수정은 운영자 검토 후 별도 명령
  (`/reconcile_oco`, attribution migration script) 로.
- **알림 자동화**: 현재는 텔레그램 `/coherence_audit` 명령으로 운영자가 수동 확인.
  cron 자동 발행 + CRITICAL 시 자동 알림은 Phase 2 후속 PR.
- **다른 invariant 확장**: 79 개 파일 중 5 개만 처리. WATCHLIST ↔ USER_WATCHLIST
  종목명 일관성, MACRO_STATE.sectorEnergyResult 갱신 시각 정합 등은 후속 PR.
- **클라이언트 영속 (localStorage zustand)**: 본 모듈은 서버 측 `data/*.json` 만
  검사. 클라이언트 영속 (regimeMemoryBank, evolutionEngine weights, useTradeStore)
  은 별도 인프라 필요.

## 회귀 테스트

- `cacheCoherenceAuditor.test.ts` — 41 케이스 (5 invariant × 분기 + summarize +
  통합 runCoherenceAudit).
- `coherenceAudit.cmd.test.ts` — 10 케이스 (formatCoherenceAuditMessage 8 분기 +
  cmd 메타데이터 + execute 동작).

## 운영 효과

- 운영자가 텔레그램 `/coherence_audit` 입력 시 즉시 5 종 invariant 위반 표면화.
- HTTP `/api/system/coherence-audit` 엔드포인트는 향후 모니터링 / 헬스 대시보드
  통합 가능.
- 새 영속 파일 추가 시 invariant 후보 검토 압력 — 80번째, 100번째 영속 파일
  추가가 *어떤 정합 규칙* 을 가지는지 ADR 단계에서 명문화 의무화.
- 사용자 우려 "발생 시 디버그 어렵다" 영구 해소 — CRITICAL 위반은 Top 10 안에
  종목 코드 + 메시지 + 파일 경로 함께 표시.

## 회귀 위험 평가

- **LIVE 매매 본체 0줄 변경** — 모듈은 read-only, 어느 영속 파일도 수정 안 함.
- **외부 호출 0건** — KIS/KRX/Yahoo/Gemini 모두 미사용, 자동매매 quota 무영향.
- **부팅 시 자동 실행 안 함** — 사용자 명시 호출 (`/coherence_audit` 또는 HTTP
  GET) 만 트리거. cron 등록도 부재.
- **손상 JSON 안전 fallback** — 모든 read 가 `safeReadJson(file, fallback)` 경유.
  파일 부재 / 빈 / JSON 손상 / array 가 아닌 직렬화 모두 빈 배열로 자연 통과.

## 후속 PR 후보

- **Phase 2 — cron 자동 발행**: 매일 KST 16:30 (장 마감 후) 자동 audit + CRITICAL
  발견 시 텔레그램 발송.
- **Phase 3 — invariant 확장**: WATCHLIST ↔ USER_WATCHLIST / MACRO_STATE 신선도 /
  REJECTION_SHADOW_FILE ↔ ATTRIBUTION_FILE 매칭 등.
- **Phase 4 — 자동 수정 도구**: 운영자 명시 승인 시 ghost OCO 청산, schema 마이
  그레이션 일괄 실행 등 별도 명령으로.
