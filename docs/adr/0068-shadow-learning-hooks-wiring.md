# ADR 0068 — Shadow Learning Hooks Wiring (PR-R)

- 상태: Accepted
- 일자: 2026-04-26
- 관련: ADR-0028 (Rejection Tracker, PR-L) · ADR-0029 (Twin Portfolio, PR-M) · 자기학습 시리즈 #393

## 배경

자기학습 시리즈 PR-A~P 본문에서 **wiring 후속 PR** 로 분리한 항목 2건:

> | Rejection wiring (PR-L) | signalScanner Phase B 완주 |
> | Twin wiring (PR-M) | signalScanner Phase B 완주 |

main 의 signalScanner Phase B 분해 (ADR-0030/0031) 이미 완주 — perSymbolEvaluation
모듈에 entryRevalidationStep 패턴 정착. 동일 위치에 `recordCounterfactual` 가
이미 try/catch 격리로 wiring 되어 있어 같은 안전 패턴으로 PR-L/M 추가 가능.

## 결정

`recordCounterfactual` 와 같은 위치 / 같은 try/catch 패턴으로 2 학습 hook 추가:

### 1. PR-M `recordTwinEntries` — candidate 평가 시작점

```ts
// perSymbolEvaluation.ts evaluateBuyList for-loop 진입부
for (const stock of ctx.buyList) {
  // ... 기존 isMomentumShadow 분기

  // ADR-0068 (PR-R): Twin Portfolio 학습 hook — 모든 candidate 를 3 Twin 정책 평가.
  // 멱등 — 동일 (stockCode + signalDate + twin) 중복 무시. throw 시 LIVE 매매에 영향 없도록 try/catch.
  try {
    recordTwinEntries({
      stockCode: stock.code,
      stockName: stock.name,
      signalDate: kstDateStr(),
      gateScore: stock.gateScore ?? 0,
      entryPrice: stock.entryPrice,
      kellyWeight: 0.10,  // 기본값 — 실 Kelly 산출은 sizingDecider 가 별도 (후속 wiring)
    });
  } catch (e) {
    console.warn(`[TwinPortfolio] record 실패 ${stock.code}:`, e instanceof Error ? e.message : e);
  }

  // ... 기존 평가 루프
}
```

`recordTwinEntries` 본체가 Gate Score 별 정책 평가 (AGGRESSIVE ≥14 / DISCIPLINED
≥22 / EQUAL_WEIGHT ≥18) 후 통과한 Twin 만 영속. 한 번의 호출로 0~3 entry 추가.

### 2. PR-L `recordRejection` — entryRevalidation 실패 시점

`recordCounterfactual` 가 이미 entryRevalidation fail 분기에 있음. 같은 try
블록 안에 `recordRejection` 호출 추가:

```ts
if (!revalResult.proceed) {
  // ... 기존 stageLog + counterfactual

  // ADR-0068 (PR-R): Rejection Tracker 학습 hook — Gate 14~17 near-miss 만 추적.
  // gateScore 가 임계 (REJECTION_NEAR_MISS_MIN/MAX) 밖이면 모듈이 자동 silent skip.
  try {
    recordRejection({
      stockCode: stock.code,
      stockName: stock.name,
      signalDate: kstDateStr(),
      signalPriceKrw: currentPrice,
      gateScore: stock.gateScore ?? 0,
      rejectionReason: revalResult.failReasons.join(','),
    });
  } catch (e) {
    console.warn(`[RejectionShadow] record 실패 ${stock.code}:`, e instanceof Error ? e.message : e);
  }
}
```

### 3. KST 일자 헬퍼

`kstDateStr()` — 현재 KST 자정 기준 YYYY-MM-DD 문자열. 두 모듈 모두 `signalDate`
입력으로 KST 평일 기준 일자 사용. 신규 헬퍼 또는 기존 utils 재사용.

### 4. LIVE 매매 무영향 보장

- 두 hook 모두 try/catch 격리 — 학습 모듈 throw 시 진입/거절 결정 흐름 무중단
- `recordRejection` 은 Gate 점수 14~17 밖에서 silent skip — 노이즈 0
- `recordTwinEntries` 는 멱등 dupKey 로 중복 차단
- 영속 파일 (rejection-shadow.json / twin-portfolio.json) 만 영향, KIS 호출 0건

## 비결정 (out of scope)

- 클라이언트 PR-A~P (`useTradeStore`) 와 서버 SHADOW (`shadowTradeRepo`) 양방향
  동기화 → 별도 PR (#8 미완성)
- `recordTwinEntries` 의 `kellyWeight` 정확값 산출 (sizingDecider 결과 입력) → 후속 PR
- entryGates 거절 (entryRevalidation 이전 단계) 시점 wiring → 후속 PR

## 회귀 위험

- LIVE 자동매매 무영향 (kisClient / orchestrator / autoTradeEngine 무수정)
- signalScanner 본체 변경 = perSymbolEvaluation 의 try/catch 블록 2곳 추가만
- 영속 파일 충돌 없음 (별도 SSOT)

## 검증

- `npm run lint`
- `npm run validate:all`
- `npm run precommit`
- 회귀 테스트 ≥ 6 케이스:
  - recordTwinEntries hook 호출 검증 (mock spy)
  - recordRejection hook 호출 검증 (mock spy)
  - hook throw 시 LIVE 매매 흐름 무중단 (try/catch 격리)
  - Gate 14~17 외 점수에서 recordRejection silent skip
  - 동일 stockCode 중복 호출 시 멱등 (recordTwinEntries dupKey)
  - PR-L/M 모듈 영속 동작 (writeFileSync 실제 호출)
