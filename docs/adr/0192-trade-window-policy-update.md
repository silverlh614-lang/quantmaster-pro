# ADR-0192 — 매매 허용 시간 정책 갱신 (09:30~12:00 + 13:00~15:30)

@responsibility 매매 허용 시간 SSOT 갱신 — 시초가 30분 변동성 제외 + 점심 차단 30분 연장 + 마감전 SELL_ONLY 14:30 → 15:30 격상.

## 컨텍스트

사용자 5/6 요청 — 매매 허용시간 변경 (09:30~12:00 + 13:00~15:30).

기존 정책 (`adaptiveScanScheduler.ts:269-276 isBuyableKstWindow`):
- 09:00~11:30 (오전, 2.5h)
- 13:00~14:30 (오후, 1.5h)
- 점심 차단 11:30~13:00 (1.5h)
- 14:30~15:30 SELL_ONLY (1h, 마감 1시간 전 신규 진입 차단)

사용자 명시 신규 정책:
- **09:30~12:00 (오전, 2.5h)** — 시초가 30분 변동성 제외 + 점심까지 30분 연장
- **13:00~15:30 (오후, 2.5h)** — 마감 30분 전(15:00) SELL_ONLY 정책은 ADR-0122 그대로 보존
- **점심 차단 12:00~13:00 (1h)** — 점심 30분 단축
- 09:00~09:30 + 12:00~13:00 신규 진입 차단

## 결정

### 결정 1 — `isBuyableKstWindow` 시간대 갱신

```typescript
// 변경 전: (t >= 900 && t < 1130) || (t >= 1300 && t < 1430)
// 변경 후: (t >= 930 && t < 1200) || (t >= 1300 && t < 1530)
```

매수 가능 구간 5h → 5h (총 시간 동일, 시간대만 이동).

### 결정 2 — `decideScan` phase boundaries 갱신

기존 phase 분기:
| 시간대 | phase | interval | mode |
|--------|-------|----------|------|
| t<930  | 시초가(급변) | 2분 | FULL |
| t<1130 | 오전 주도주 | 3분 | FULL |
| t<1300 | 점심(SELL_ONLY) | 10분 | SELL_ONLY |
| t<1430 | 오후 재개장 | 5분 | FULL |
| t<1500 | 마감전(급변) | 2분 | FULL |
| t≥1500 | 마감(SELL_ONLY) | 2분 | SELL_ONLY |

신규 phase 분기:
| 시간대 | phase | interval | mode |
|--------|-------|----------|------|
| t<930  | 시초가 SELL_ONLY (변동성 회피) | 5분 | SELL_ONLY |
| t<1200 | 오전 주도주 | 3분 | FULL |
| t<1300 | 점심 SELL_ONLY (1h) | 10분 | SELL_ONLY |
| t<1500 | 오후 재개장 | 3분 | FULL |
| t≥1500 | 마감전 SELL_ONLY (ADR-0122 정합) | 2분 | SELL_ONLY |

핵심 변경:
- 시초가 09:00~09:30 → SELL_ONLY (변동성 회피, 신규 진입 차단)
- 점심 차단 11:30 → 12:00 (오전 30분 추가 매매)
- 오후 시작 14:30 → 15:00 SELL_ONLY 격상 (정상 매매 30분 추가)
- 마감 SELL_ONLY 15:00 → 15:30 (ADR-0122 정합 보존)

### 결정 3 — `lastLunchBlockSeenAt` 진입점 12:00 정합

기존 `t < 1300 && t > ~1130` 진입에서 점심 차단 진입을 검출. 신규 정책에서 `t < 1300 && t >= 1200` 로 자동 정합 (phase 조건 변경으로 부수효과 0).

### 결정 4 — ENV 우회 1종

`TRADE_WINDOW_LEGACY_HOURS=true` (default OFF) — ADR-0122 정합 09:00~14:30 매수 + 14:30~15:00 마감전 + 15:00 SELL_ONLY 동작 즉시 복원. ADR-0157 정확 비교 의무 (`=== 'true'`).

## 안전 invariant 5종

1. **LIVE 매매 본체 0줄 변경** — `kisClient/**` / `signalScanner.ts` / `signalScanner/preflight.ts` / `entryEngine.ts` / `exitEngine/**` / `orchestrator/**` / `autoTradeEngine*` 본체 무수정. *시간 게이트* 만 갱신.
2. **KIS/KRX 자동매매 quota 0 침범** — 절대 규칙 #2/#3/#4 — kisClient/orchestrator/autoTradeEngine 본체 무수정.
3. **ADR-0122 정합 보존** — 마감전 SELL_ONLY 15:00 → 15:30 격상 시 정상 매매 구간 (15:00~15:20) 도 SELL_ONLY 로 분류 — 15:20~15:30 동시호가는 KIS 자체 차단으로 자연 안전.
4. **ENV 롤백** — 회귀 발견 시 1줄 즉시 복원.
5. **점심 해제 강제 스캔 (`lastLunchBlockSeenAt` 진입 + 13:00~13:10 force scan)** — 신규 점심 구간 12:00~13:00 으로 변경되어도 자연 정합 (조건 `t < 1300` 그대로).

## 잘못된 해결 방법 영구 차단 5종

1. **`isMarketOpen` SSOT 본체 변경** — 외부 데이터 호출 게이트 (ADR-0009/0058) 와 매매 시간 정책은 분리 (marketClock.ts 헤더 명문화). 본 PR 은 매매 시간 정책만 변경, 외부 데이터 게이트 (09:00~15:30) 는 보존.
2. **시초가 SELL_ONLY 를 차단으로 격상** — adaptiveScanScheduler 가 SELL_ONLY 시 exitEngine 포지션 감시는 계속 수행 — 매도/손절 흐름 보존.
3. **마감 SELL_ONLY 시간 정책 변경** — ADR-0122 (사용자 보고 4/30 SELL_ONLY 14:55→15:00) 정합 보존.
4. **점심 차단 시간 변경 시 lastLunchBlockSeenAt 변수명 변경** — 회귀 위험 ↑, 변수명 보존.
5. **ENV default ON** — 운영자 명시적 옵션 결정 보존 (default 정책 적용).

## 회귀 테스트 ≥10 케이스

- `tradeWindowPolicyAdr0192.test.ts` — `isBuyableKstWindow` 갱신 (09:30 boundary / 11:59 boundary / 12:00 차단 / 12:30 차단 / 13:00 boundary / 15:29 boundary / 15:30 차단) + `decideScan` phase boundaries (09:00 시초가 SELL_ONLY / 11:30 오전 / 12:30 점심 / 13:30 오후 / 15:00 마감 SELL_ONLY).

## 운영자 활성화 절차

본 PR 머지 직후 자동 활성화. 회귀 발견 시 ENV `TRADE_WINDOW_LEGACY_HOURS=true` 1줄 즉시 롤백.

## 결과

1. 시초가 30분 변동성 제외 → 사용자 자본 보호 (시초가 갭 회피).
2. 점심 30분 단축 (오전 매매 11:30 → 12:00) → 매수 기회 +30분.
3. 마감전 SELL_ONLY 정상 매매 14:30 → 15:00 격상 → 오후 매수 기회 +30분.
4. 총 매수 가능 시간 5h 유지 (오전 2.5h + 오후 2.5h).
