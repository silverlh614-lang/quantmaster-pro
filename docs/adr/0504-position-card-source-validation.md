# ADR-0504 — Position Card Source Validation (Telegram Position Cards)

- **Status**: Accepted
- **Date**: 2026-05-12
- **Domain**: telegram, alerts, persistence
- **Branch**: `claude/fix-position-card-sources-6vjb2`
- **Related**: ADR-0191 (SHADOW MODE 헤더), ADR-0452 (SHADOW_NEAR_BREAKOUT 학습 entry), ADR-0157 (ENV 정확 비교 의무), ADR-0146 (PR 자가 review 5 카테고리)

## Context

사용자 운영 보고 (2026-05-12): Telegram Morning Position Card (`positionMorningCard.ts` 09:05 KST cron) 가 SHADOW 모드에서 *11개 학습 entry 를 가짜 보유로 노출* — 실제 보유 0건인데 운영자에게 11개 보유로 잘못 표시. 결함 진원지 audit 결과:

- `server/alerts/positionMorningCard.ts:121` `aggregateAllPositions()` → `server/trading/positionAggregator.ts:338`.
- `aggregateAllPositions` 가 `loadShadowTrades()` + `loadShadowLogs()` 합집합 후 `stage !== 'CLOSED'` filter 만 수행. 학습 entry 와 실 보유 entry *분리 0건*.
- ADR-0452 `runShadowNearBreakoutEntry` (`buyListLoop.ts`) 가 `buildBuyTrade(... shadowMode: true, watchlistSource: 'SHADOW_NEAR_BREAKOUT')` 호출 → 공통 `data/shadow-trades.json` 영속.
- `aggregatePosition()` 라인 301~307 `realizedQty===0 → stage='ENTRY'` → filter 통과 → Morning Card / `/pos` / `positionsRouter` 모두 가짜 보유 노출.

**audit schema 확정**: ServerShadowTrade schema (`shadowTradeRepo.ts:422`) 에 `executionImpact` / `learningTag` 필드 *영속 부재*. ADR-0452 SHADOW_NEAR_BREAKOUT entry 식별은 `watchlistSource='SHADOW_NEAR_BREAKOUT'` 단독으로 충분 (가드 4/5 deprecated, 가드 3 흡수).

## Decision

**4 SSOT** + **6 ENV 헬퍼** + **3 호출자 wiring** 도입. `positionAggregator` 본체 무수정 (다른 호출자 `positionTruth.ts` / `diagnostics.ts` 영향 0 보존).

### 1. 신규 SSOT 4종

#### A. `server/alerts/positionCardTypes.ts` — 타입 SSOT

- `PositionSource = 'BROKER_BALANCE' | 'SHADOW_POSITION_LEDGER'` 2-value union 강제. 그 외 source 는 validator 가 런타임 차단.
- `PositionCardMode = 'REAL' | 'SHADOW'`.
- `PositionCardCardType = 'POSITION_MORNING_CARD' | 'POSITION_STATUS_CARD'`.
- `PositionCardExecutionImpact = 'NONE' | 'PAPER' | 'LIVE'`.
- `PositionCardPosition` schema (stockCode/stockName/source/qty/avgEntryPrice?/currentPrice?/pnlPct?/entryDate?/lotId?).
- `PositionCardPayload` schema (cardType/mode/positions/summary/executionImpact).
- `PositionCardValidationError` 4-value union + `PositionCardValidationResult` discriminated union.
- `FORBIDDEN_POSITION_SOURCES` Object.freeze 8 entries (WATCHLIST / RECOMMENDATION_HISTORY / SHADOW_CANDIDATE / RESERVED_ORDER / COUNTERFACTUAL / PREVIOUS_TELEGRAM_CACHE / LAST_KNOWN_POSITIONS / MORNING_SCAN_RESULT).

#### B. `server/persistence/shadowPositionLedger.ts` — Shadow 보유 SSOT (5중 가드)

`getOpenPositions(): OpenPositionEntry[]` 결정 트리 (사용자 명시 7중 → 가드 4/5 deprecated 확정 → 5중):

1. `loadShadowTrades()` 영속 read.
2. `isOpenShadowStatus(s.status)` — PENDING / ORDER_SUBMITTED / PARTIALLY_FILLED / ACTIVE / EUPHORIA_PARTIAL.
3. `s.watchlistSource !== 'SHADOW_NEAR_BREAKOUT'` — ADR-0452 학습 entry 차단.
4. ~~learning marker 차단~~ — schema 부재로 deprecated.
5. ~~executionImpact NONE 차단~~ — schema 부재로 deprecated.
6. `getRemainingQty(s) > 0` — fills SSOT 잔량.
7. BUY fill ≥ 1 — orphan 차단.

ENV `SHADOW_POSITION_LEDGER_GUARDS_DISABLED=true` (default OFF, ADR-0157 정확 비교 — `'1'` / `'TRUE'` / `'yes'` 거부) — 활성 시 가드 3/7 skip.

`getOpenPositionByCode(code)` shortcut.

#### C. `server/alerts/positionCardEnvHelpers.ts` — 6 ENV 헬퍼

- `isPositionCardEnabled()`: default ON (`!== 'false'`).
- `isShadowPositionCardEnabled()`: default ON.
- `isMorningPositionCardEnabled()`: default ON.
- `isSendEmptyPositionCardEnabled()`: **default OFF** (`=== 'true'`) — 사용자 결정 빈 보유 발송 생략.
- `isPositionCardSourceValidationEnabled()`: default ON.
- `isPositionCardFallbackForbidden()`: default ON.

#### D. `server/alerts/positionCardValidator.ts` — Validator + Builder SSOT

- `validatePositionCardPayload(payload): PositionCardValidationResult` — 5 분기 결정 트리 (ENV skip → forbidden 우선 차단 → SHADOW source 검증 → REAL source 검증 → count mismatch).
- `buildShadowPositionCardPayload({cardType, positions, enrich?})` — getOpenPositions 결과 → SHADOW payload + dedupeKey 별 lot aggregate (totalQty 합산 + 가중평균 entry + earliest entryDate).
- `buildRealPositionCardPayload({cardType, holdings})` — fetchKisHoldings 결과 → REAL payload (Phase 2 wiring 대상).
- `buildDedupeKey({mode, source, stockCode, entryDate})` SSOT.

### 2. 호출자 wiring 3종

#### E-1. `server/alerts/positionMorningCard.ts`

- `aggregateAllPositions()` 호출 + `loadShadowTrades()` 직접 사용 영구 제거.
- `getOpenPositions()` SSOT 위임 → `buildShadowPositionCardPayload` (POSITION_MORNING_CARD) → `validatePositionCardPayload` 통과 시에만 발송.
- 빈 보유 default 발송 생략 + `console.log('[TelegramPositionCard] skipped empty shadow positions', { mode, count: 0, executionImpact: 'NONE' })`.
- ENV `TELEGRAM_SEND_EMPTY_POSITION_CARD=true` 활성 시 명시 빈 카드 발송 (별도 dedupeKey `morning_card_empty:YYYY-MM-DD`).
- ADR-0191 SHADOW MODE 헤더 + ADR-0039 `sendPrivateAlert` 정합 보존.

#### E-2. `server/telegram/commands/positions/pos.cmd.ts`

- `getShadowTrades().filter(...)` → `getOpenPositions()` SSOT 위임.
- `cardType: 'POSITION_STATUS_CARD'` 명시.
- 빈 보유 응답 `📋 현재 Shadow 보유 포지션 없음`.
- 기존 메시지 형식 (캐시 drift 경고 / SHADOW note) 보존.

#### E-3. `server/routes/autoTrade/positionsRouter.ts`

**본 PR scope 외 — 후속 PR 분리** (응답 schema breaking change 위험 격리):

- `GET /api/auto-trade/positions` 응답 schema = `PositionSummary[]` (positionAggregator). UI 호출자 의존성으로 schema 변경 불가.
- 후속 PR: 내부 source 필터링만 격상 (응답 schema 무변경) + REAL mode `fetchKisHoldings` wiring 결정.

### 3. Forbidden 패턴 영구 차단 정적 grep 가드

3 파일 (positionMorningCard / pos.cmd / positionsRouter) 에서:
- `lastKnownPositions` / `previousTelegramCache` / `recommendationHistory` / `loadCounterfactuals` / `loadProvisionalShadowLedger` / `loadCounterfactualUniverseLearningLedger` 패턴 부재 의무.
- `aggregateAllPositions` import / 호출 부재 (positionMorningCard / pos.cmd).
- 회귀 테스트가 정적 grep 가드 7+ 케이스 검증.

## Invariants (≥12)

1. **LIVE 매매 본체 0줄 변경**: `signalScanner.ts` / `signalScanner/**` / `entryEngine.ts` / `exitEngine/**` / `kisClient/**` / `orchestrator/**` / `autoTradeEngine*` / `trancheExecutor.ts` / `buyPipeline.ts` 모두 0 LoC.
2. **KIS 주문 함수 5종 import 0건** (정적 grep 가드 회귀 테스트).
3. **Trading Engine 무중단** — `positionAggregator.ts` 본체 무수정, 다른 호출자 (`positionTruth.ts` / `diagnostics.ts`) 영향 0.
4. **Shadow Learning case recording 무중단** — ADR-0452 SHADOW_NEAR_BREAKOUT entry 영속 자체 변경 0 (학습 표본 누적 보존). 본 PR 은 *카드 노출만* 차단.
5. **forbidden 8 source 영구 차단** (FORBIDDEN_POSITION_SOURCES SSOT + 정적 grep 가드).
6. **fallback 패턴 영구 차단** — `lastKnownPositions` / `previousTelegramCache` / `recommendationHistory` / `loadCounterfactuals` 등 7 패턴 정적 grep 가드.
7. **ENV `=== 'true'` / `!== 'false'` 정확 비교 의무** (ADR-0157 정합) — `'1'` / `'TRUE'` / `'yes'` / 빈 문자열 모두 거부.
8. **`executionImpact: 'NONE'` literal 강제** (SHADOW payload).
9. **SHADOW_NEAR_BREAKOUT 학습 entry 보유 카드 노출 0** — 가드 3 정적 grep 가드 + 11-fixture 회귀 시나리오.
10. **dedupe SSOT 단일** (`buildDedupeKey` 호출자 측 inline 합성 0건).
11. **빈 보유 default 발송 생략** (사용자 결정 — 잡음 차단).
12. **payload validation 의무** — validator throw 없이 `ok: false` 반환 시 발송 차단 + console.error 진단.
13. **호출자 측 inline filter 0건** — SSOT 위임 의무 (drift 방지, 정적 grep 가드).
14. **`positionAggregator.ts` 본체 무수정** (다른 호출자 영향 0).
15. **`shadow-trades.json` 영속 schema 변경 0** (ServerShadowTrade interface 무수정).
16. **`positionsRouter` 응답 schema 변경 0** (UI 호출자 회귀 위험 격리).

## ENV Taxonomy (6종)

| ENV | Default | 의미 |
|---|---|---|
| `TELEGRAM_POSITION_CARD_ENABLED` | ON (`!== 'false'`) | 모든 카드 발송 활성화 |
| `TELEGRAM_SHADOW_POSITION_CARD_ENABLED` | ON (`!== 'false'`) | Shadow 카드 발송 활성화 |
| `TELEGRAM_MORNING_POSITION_CARD_ENABLED` | ON (`!== 'false'`) | Morning Card cron 활성화 |
| `TELEGRAM_SEND_EMPTY_POSITION_CARD` | OFF (`=== 'true'`) | 빈 보유 시 카드 발송 (사용자 결정) |
| `TELEGRAM_POSITION_CARD_VALIDATE_SOURCE` | ON (`!== 'false'`) | Payload validation 활성화 |
| `TELEGRAM_POSITION_CARD_FALLBACK_FORBIDDEN` | ON (`!== 'false'`) | Fallback 금지 정책 |
| `SHADOW_POSITION_LEDGER_GUARDS_DISABLED` | OFF (`=== 'true'`) | 5중 가드 우회 (회귀 안전망) |

ADR-0157 정확 비교 의무 — `'1'` / `'TRUE'` / `'yes'` / 빈 문자열 모두 거부.

## 잘못된 해결 방법 영구 차단 (≥6종)

1. **`positionAggregator.aggregateAllPositions()` 본체 변경** — 다른 호출자 (`positionTruth` / `diagnostics`) 영향 위험. *별도 SSOT* 신설로 격리.
2. **호출자 측 inline `s.watchlistSource !== 'SHADOW_NEAR_BREAKOUT'` filter** — drift 위험. SSOT 위임 의무.
3. **`PositionSource` union 확장** (e.g. `'WATCHLIST_BACKUP'` 추가) — forbidden source 회귀 위험. 2-value union 영구 강제.
4. **fallback 패턴 도입** (e.g. `positions.length ? positions : lastKnownPositions`) — 정적 grep 가드 영구 차단.
5. **빈 보유 시 default 발송** — 사용자 결정 잡음 차단 정책 위반. ENV `=true` 명시 의무.
6. **`positionsRouter` 응답 schema 본 PR 변경** — UI breaking change. 후속 PR 분리 의무.
7. **`shadow-trades.json` schema 변경** (e.g. `executionImpact` 필드 추가) — 영속 마이그레이션 부담. `watchlistSource` 단독 식별로 충분.
8. **`learningTag` runtime cast 도입** (`(s as any).learningTag === 'SHADOW_NEAR_BREAKOUT_ENTRY'`) — schema 부재 + cast 우회 위험. 가드 3 흡수.

## Out of Scope

1. **ADR-0452 학습 entry 별도 ledger 분리** — `data/shadow-near-breakout-ledger.json` 신설로 공통 `shadow-trades.json` 오염 영구 차단. 학습 표본 wiring 영향 큼 — 별도 ADR.
2. **`aggregateAllPositions` deprecation** — 다른 호출자 (`positionTruth.detectPositionTruthDivergence` / `diagnostics.collectHealthSnapshot`) 점진 마이그레이션 후 별도 PR.
3. **Phase 2 LIVE/PAPER `fetchKisHoldings` router wiring** — `positionsRouter` REAL mode 응답 schema 격상 + KIS quota 검토.
4. **`/pnl` `/pending` 명령 SSOT 통합** — 동일 패턴 (학습 entry 노출) 잠재 위험. 별도 audit 후 별도 PR.

## Verification

- vitest 신규 70 케이스 PASS (목표 ≥40 의 1.75배 — `shadowPositionLedgerAdr0504` 18 + `positionCardEnvHelpersAdr0504` 7 + `positionCardValidatorAdr0504` 26 + `positionMorningCardAdr0504` 14 + `posCmdAdr0504` 9). heuristic ~12/100 LoC.
- `npm run lint` (tsc --noEmit + tsc -p tsconfig.server.json) EXIT=0 — 변경 파일 0 errors.
- LIVE 매매 본체 0줄 변경 (정적 grep 가드 정합).
- KIS/KRX/Yahoo/Naver outbound 0 (SHADOW 영속 read-only).
- ADR-0146 PR 자가 review 5 카테고리 모두 PASS.

## ADR-0146 PR 자가 review 체크리스트

- [x] **A. LIVE 매매 안전성**: KIS/KRX quota 0 침범. 매매 본체 0줄 변경 (정적 grep 가드). ENV 7종 모두 ADR-0157 정확 비교 + 회귀 안전망 (`SHADOW_POSITION_LEDGER_GUARDS_DISABLED=true` 1줄 즉시 legacy 동작 부분 복원).
- [x] **B. wiring 완료 vs 인프라만**: 4 SSOT + 6 ENV 헬퍼 + 2 호출자 wiring (positionMorningCard / pos.cmd) 완료. positionsRouter 후속 PR 분리 (PENDING_WIRING 등재 의무).
- [x] **C. ADR 발급 무결성**: INDEX.md `다음 발급 0504` 사용 + 본 PR 직후 0505 갱신 + §"전체 인덱스" 한 줄 추가. 충돌 0건.
- [x] **D. 회귀 테스트 적정성**: 70 케이스 (목표 ≥40 의 1.75배). heuristic ~12/100 LoC, ≥5 충족.
- [x] **E. 정책 위반**: validate:all 16종 baseline 무회귀 (사전 baseline 본 PR 무관 git stash 동일 재현 의무).
