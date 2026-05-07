# ADR-0428: Provisional Shadow Performance Report

- **Status**: Accepted
- **Date**: 2026-05-07
- **PR**: TBD (claude/adr-0428-provisional-shadow-performance-report)
- **Context**: ADR-0426 (provisional shadow eligibility SSOT) + ADR-0427 (scanner wiring + ledger 영속)

## 결정

ADR-0427 이 영속한 `provisional-shadow-ledger.json` 의 entries 의 성과를 **6-horizon** (T+30m / T+1h / 종가 / 다음 시가 / T+1d / T+3d) read-time 계산하는 리포트 SSOT 신설. 사용자 §F **선택 1 (read-time 계산)** 채택 — 별도 performance 영속 layer 없음, priceProvider 의존성 주입으로 외부 API 호출 폭주 차단.

## 동기

ADR-0427 머지 후 `created > 0` 가 쌓인 이후에도 운영자는 R3_PROVISIONAL_LEADER_DATA_DEGRADED 후보가 30분 후 / 1시간 후 / 당일 종가 / 익일 / 3일 후 성과를 볼 수 없음. 학습 표본은 영속됐지만 *그 표본이 좋은 학습 데이터인가* 검증 경로 부재.

## 6-horizon SSOT (사용자 §B 정합)

```typescript
type ProvisionalShadowHorizon =
  | 'T_PLUS_30M'        // 30분 후
  | 'T_PLUS_1H'         // 1시간 후
  | 'SAME_DAY_CLOSE'    // 당일 종가 (entry+8h heuristic, KST 09:00→17:00)
  | 'NEXT_OPEN'         // 다음 시가 (entry+24h)
  | 'T_PLUS_1D_CLOSE'   // T+1일 종가 (+32h)
  | 'T_PLUS_3D_CLOSE';  // T+3일 종가 (+80h)

type ProvisionalShadowPointStatus =
  | 'PENDING'           // horizon 미도달 또는 priceProvider 미설정
  | 'OBSERVED'          // 정상 관측
  | 'DATA_UNAVAILABLE'  // priceProvider 결과 없음 또는 entryPrice 부재
  | 'MARKET_CLOSED'     // 시장 휴장
  | 'ERROR';            // priceProvider throw
```

## 성과 계산 SSOT (사용자 §C)

```typescript
returnPct = ((observedPrice - entryPrice) / entryPrice) * 100
```

**안전 가드** (사용자 명시 절대 변경 금지):
- entryPrice 부재 → DATA_UNAVAILABLE (PENDING 아님)
- observedPrice 부재 → priceProvider 가 결정 (DATA_UNAVAILABLE / MARKET_CLOSED)
- horizon 미도달 → PENDING (data 부재 아님)
- 모든 horizon PENDING → summary.status='PENDING'
- 일부 OBSERVED → 'PARTIAL'
- 모든 OBSERVED → 'COMPLETE'
- horizon 도달 + priceProvider 실패 → 'INSUFFICIENT_DATA'

## 가격 소스 정책 (사용자 §D)

**`priceProvider` 의존성 주입** 패턴 — 본 PR 은 시그니처 SSOT 만 정의, 실제 구현 wiring 은 후속 PR (회귀 위험 격리).

```typescript
type ProvisionalShadowPriceProvider = (
  symbol: string,
  horizon: ProvisionalShadowHorizon,
  entryAtKst: string,
) => Promise<{ available: true; price: number; observedAtKst: string }
  | { available: false; reason: string; status?: ProvisionalShadowPointStatus }>;
```

**default**: `priceProvider` 미전달 시 모든 horizon PENDING — 외부 API 호출 0 (사용자 §D 정합). 운영 환경에서 텔레그램 명령 호출 시 priceProvider 미전달 → "insufficient data — 모든 horizon pending" 표시.

**금지** (사용자 §D 정합):
- provisional entry 마다 무제한 외부 호출
- KIS quota 폭주
- 주문/체결 API 접근

## 영속 정책 (사용자 §F — 선택 1 채택)

**read-time 계산** — 별도 performance snapshot 파일 없음.

이유:
- 구현 단순 (별도 영속 layer 0)
- 동일 entry 의 성과는 시점에 따라 변할 수 있음 (반영 horizon 도달 후)
- 1주 누적 후 별도 영속 검토 가능 (후속 PR scope)

## 출력 예시 (`/shadow_provisional`, 사용자 §G)

### eligible > 0
```
🌱 Provisional Shadow Report (ADR-0428)
  • totalEntries: 7
  • observed: 4
  • pending: 3

  📋 Label Breakdown
    • R3_PROVISIONAL_LEADER_DATA_DEGRADED: 7건

  📊 Horizon 성과
    • +30m: avg +0.42% / winRate 57%
    • +1h: avg +0.71% / winRate 60%
    • close: avg +1.10% / winRate 66%
    • nextOpen: pending
    • +1d: pending
    • +3d: pending

  🏆 Top winners
    1. 005930 삼성전자 +2.30%
    2. 000660 SK하이닉스 +1.80%

  📉 Top losers
    1. 123456 예시종목 -1.20%

  read-only 학습/검증 리포트 — 자동 paper/live 승격 0, provisional ledger 만 read.
```

### eligible = 0 (사용자 §I)
```
🌱 Provisional Shadow Report (ADR-0428)
  • 아직 provisional shadow entry 가 없습니다.
  • HARD_BLOCK / SELL_ONLY 상태에서는 Shadow 학습도 제한됩니다.
```

### priceProvider 미전달 (모든 horizon PENDING)
```
🌱 Provisional Shadow Report (ADR-0428)
  • totalEntries: 3
  • observed: 0
  • pending: 3

  📋 Label Breakdown
    • R3_PROVISIONAL_LEADER_DATA_DEGRADED: 3건

  📊 Horizon 성과
    • insufficient data — 모든 horizon pending
```

## 핵심 불변식 (사용자 명시 §"절대 하지 말 것" 정합)

1. **LIVE 매매 영향 0** — KIS 주문 함수 5종 import 0건 (정적 grep 가드)
2. **자동 paper/live 승격 0** — 본 PR 은 read-only 리포트 (정적 grep 가드)
3. **provisional !== true 무시** — `entry.eventType === 'PROVISIONAL_SHADOW_ENTRY'` + `entry.provisional === true` + `entry.source === 'ADR-0426'` 3중 검증 (사용자 §J)
4. **일반 shadow-trades.json 무수정** — `shadowTradeRepo` import 0건 (정적 grep 가드)
5. **외부 API 폭주 차단** — `priceProvider` 의존성 주입 (호출자 측 caching/quota/batching 결정)
6. **data 부재 ≠ failed** — DATA_UNAVAILABLE / MARKET_CLOSED / PENDING 명시 분리
7. **maxEntries 제한** — default 50, 외부 호출 폭주 차단
8. **HORIZON_OFFSET_MS Object.freeze SSOT** — drift 차단

## ENV 우회

`PROVISIONAL_SHADOW_PERF_REPORT_DISABLED=true` (default OFF, ADR-0157 정확 비교) — 빈 summary 반환 → 1줄 즉시 ADR-0427 dead code 동작 복원.

## 본 PR 범위

- `server/learning/provisionalShadowPerformanceReport.ts` SSOT 신설 (~330 LoC)
- `server/learning/provisionalShadowPerformanceReportAdr0428.test.ts` (24 케이스)
- `server/telegram/commands/system/shadowProvisional.cmd.ts` 텔레그램 명령 신설 (`/shadow_provisional` + alias 2종)
- `server/telegram/commands/system/shadowProvisional.test.ts` (8 케이스)
- `server/telegram/commands/system/index.ts` (+barrel)

회귀 테스트: 신규 32 + 인접 server/learning + server/telegram + server/trading/signalScanner 무회귀.

## scope 외 (후속 PR)

- **ADR-0429 priceProvider 실제 구현** — 기존 quote snapshot / candle / market data cache 우선 사용 + Yahoo/KIS 제한된 fallback
- **provisional → normal shadow 승격 조건** — Gate2 후속 통과 + 성과 임계 충족 시 자동 격상 (별도 ADR)
- **별도 performance snapshot 영속** — 1주 누적 후 영속 layer 검토
- **/scan_blockers 짧은 요약 wiring** — `formatProvisionalShadowSummaryLine` 의 scanDiagnostics 통합
- **paper/live 승격 검토** — 성과 충분 누적 후 별도 ADR (현재 절대 금지)

## 참고 문헌

- ADR-0420 (Fresh Scan Blocker Attribution)
- ADR-0422 (Gate2 / NO_LEADERSHIP fresh attribution)
- ADR-0423 (SectorEnergy data-truth diagnostic)
- ADR-0424 (SectorEnergy indexCode provider repair)
- ADR-0425 (Gate Decision Router)
- ADR-0426 (R3_EARLY Provisional Leader Shadow Lane — eligibility SSOT)
- ADR-0427 (Wire R3 Provisional Shadow Lane into Scanner and Shadow Ledger)
