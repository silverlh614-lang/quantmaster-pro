# ADR 0067 — Multi-Timeframe Confluence Gate (페어 B PR-Q, 사용자 #2)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0030 (signalScanner Phase B EntryGate Chain) · 자기학습 시리즈 PR-A~P (#393)

## 배경

페어 A (PR-L+M) / 페어 D (PR-N) / #8 (PR-O) 데이터 인프라가 main 에 머지된 위에
사용자 10 결합 아이디어 페어 B 시작 — Entry Confluence Layer (#2 + #7 + #4).

본 PR-Q 는 페어 B 의 첫 항목 — **#2 Multi-Timeframe Signal Confluence**.

기존:
- `server/trading/signalScanner.ts` 는 일봉 단일 시간프레임 기반.
- `server/trading/signalScanner/entryGates/` Phase B 7 게이트 (cooldown / blacklist
  / addBuyBlock / rrr / sectorConcentration / sectorPreGuard / portfolioRisk) 만 존재.
- 다중 시간프레임 정렬 검증 부재 — 30분봉 / 일봉 / 주봉 동시 정렬 시점이 진짜
  고승률 진입점인데 측정 안 됨.

## 결정

신규 게이트 `timeframeConfluenceGate` 를 ENTRY_GATES_PHASE_B 배열 마지막에 추가.

### 1. 설계 — 옵셔널 입력 패턴 (안전 우선)

```ts
interface TimeframeAlignment {
  /** 일목균형표 구름대 위 + MA20 정배열 = true */
  daily?: boolean;
  weekly?: boolean;
  intraday30m?: boolean;
}

// EntryGateContext 에 옵셔널 필드 추가
interface EntryGateContext {
  // ... 기존 필드
  timeframeConfluence?: TimeframeAlignment;
}
```

데이터 부재 시 (perSymbolEvaluation 가 미주입) 게이트는 자동 PASS — wiring
완료 시점부터 실제 검증 시작.

### 2. 의사결정 매트릭스

| 통과 timeframe 수 | 결과 | 메시지 |
|---|---|---|
| 3 (모든 timeframe 정렬) | PASS + STRONG | `confluence=3 — 강한 신호` |
| 2 (2/3 정렬) | PASS + STANDARD | `confluence=2 — CONVICTION 권장` |
| 1 (1/3 정렬) | PASS + WARN | `confluence=1 — PROBING 사이즈 권장` |
| 0 (모두 미정렬) | **FAIL** | `confluence=0 — 다중 시간프레임 부정렬` |
| 데이터 부재 | PASS (skip) | `timeframe 데이터 부재 — 게이트 우회` |

`logMessage` 의 confluence count 가 후속 PR (sizingDecider wiring) 에서 사이즈
조정 입력으로 사용됨. 본 PR 은 차단 기능만 (count=0).

### 3. 위치 — ENTRY_GATES_PHASE_B 마지막

기존 7 게이트 다음. 이유:
- portfolioRisk 까지 통과한 후보만 진정한 multi-timeframe 검증 가치
- async 가능한 게이트 시그니처 호환

### 4. wiring 본 PR scope 밖

`perSymbolEvaluation` 의 ctx 빌더가 `timeframeConfluence` 데이터를 주입하는
wiring 은 후속 PR. 본 PR 은:
- 게이트 모듈 + EntryGateContext 옵셔널 필드 + 단위 테스트
- ENTRY_GATES_PHASE_B 추가만

데이터 주입 wiring 은 stockScreener 어댑터에서 KIS 일목/MA20 계산 후 stock
객체에 첨부하는 별도 PR.

### 5. LIVE 매매 무영향 보장

- signalScanner 본체 무수정 — entryGates 배열 자동 적용
- 데이터 부재 시 PASS skip — wiring 전까지 무동작
- 환경변수 롤백: `ENTRY_TIMEFRAME_CONFLUENCE_DISABLED=true` → 항상 PASS

## 비결정 (out of scope)

- `perSymbolEvaluation` 의 timeframe 데이터 주입 wiring → 후속 PR
- `sizingDecider` 의 confluence count 기반 사이즈 조정 → 후속 PR
- KIS 30분봉 / 주봉 fetch wiring → 후속 PR

## 회귀 위험

- LIVE 자동매매 무영향 (signalScanner / kisClient / orchestrator 무수정).
- 옵셔널 필드 추가만 — EntryGateContext 호출자 무변경.
- ENTRY_GATES_PHASE_B 게이트 추가는 데이터 부재 시 PASS skip 으로 회귀 0.

## 검증

- `npm run lint`
- `npm run validate:all`
- `npm run precommit`
- 회귀 테스트 ≥ 8 케이스:
  - 데이터 부재 → PASS (skip 메시지)
  - 0/3 통과 → FAIL
  - 1/3 통과 → PASS + WARN
  - 2/3 통과 → PASS + STANDARD
  - 3/3 통과 → PASS + STRONG
  - DISABLED env → 항상 PASS
  - 부분 undefined (daily=true, 나머지 undefined) → 정의된 것만 카운트
  - ENTRY_GATES_PHASE_B 배열에 마지막으로 추가됨 검증
