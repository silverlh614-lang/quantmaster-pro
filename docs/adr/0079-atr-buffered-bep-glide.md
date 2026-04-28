# ADR-0079 — ATR-Buffered BEP Glide (BEP 점프 → 글라이드)

## 상태

Accepted (2026-04-28)

## 컨텍스트

`src/services/quant/dynamicStopEngine.ts` (LIVE 자동매매 BEP 정책 SSOT — 서버
`server/trading/exitEngine/rules/atrDynamicStop.ts` 가 직접 import) 의 BEP_TRIGGER
분기 (line 78) 가 수익 +5% 도달 시 `trailingStopPrice = Math.round(entryPrice)` 로
손절선을 **진입가에 단번에 점프**시킨다. ATR=1500원짜리 종목도, ATR=300원짜리
종목도 똑같이 진입가에 박는다.

문제:

1. **단일 신호 트리거** — 페르소나 자료 7번 "단일 신호 vs Confluence" 위반.
   1번 틱이 +5% 를 찍으면 손절선이 영구 점프하고, ATR 래칫 (atrDynamicStop.ts:34
   `if (effectiveDynamicStop > hardStopLoss)`) 으로 절대 내려오지 않는다.
2. **변동성 무차별** — ATR 1500 (고변동) 종목은 진입가 ±1.5% 출렁임이 정상이지만
   BEP 점프 직후 평소 noise 의 1봉으로 손절 트리거. 사용자 보고 "BEP 점프 직후
   손절" 패턴의 기계적 원인.
3. **noise vs true reversal 분리 부재** — 통계적으로 ATR 의 절반(0.5×ATR) 은
   *평균적인 일중 출렁임* 을 흡수하는 임계점. 이 마진 없이 진입가에 박으면
   noise 트리거 비율이 높아진다.

## 결정

`evaluateDynamicStop(input)` 의 BEP_TRIGGER 분기 (수익 +5% ≤ < +10%) 를
**ATR 버퍼 적용 글라이드** 로 교체한다.

### 공식

```
trailingStopPrice = entryPrice − 0.5 × atr14   (atr14 > 0 일 때)
                  = entryPrice                  (atr14 부재/0 시 기존 동작 보존)
```

ATR 1500 종목 → BEP 글라이드 = entryPrice − 750 (≈ -0.75% 마진)
ATR 300 종목  → BEP 글라이드 = entryPrice − 150 (≈ -0.15% 마진)
ATR 0 종목    → trailingStopPrice = entryPrice (회귀 — 기존 동작 100% 보존)

### Lock-in 분기 (≥+10%) 는 변경 없음

`trailingStopPrice = entryPrice × 1.03` 그대로 — 이미 +3% lock-in 이라
*수익권에서의 보호선* 이지 noise 흡수 목적이 아니다. 본 ADR scope 외.

### ENV 롤백 스위치

`BEP_GLIDE_DISABLED=true` → 기존 점프 패턴 (`trailingStopPrice = entryPrice`)
즉시 복원. 운영 중 회귀 발견 시 컨테이너 재시작 없이 env 변경만으로 차단.

## 결과

### 효과

- BEP 점프 직후 noise 트리거 차단 — ATR 절반은 평균 일중 출렁임을 흡수.
- 종목 변동성에 비례한 손절 마진 — ATR 1500 vs ATR 300 차등 보호.
- 페르소나 자료 7번 "단일 신호 vs Confluence" 정합 — 단일 +5% 트리거의 영구
  점프 대신 변동성 가중 글라이드.

### 회귀 위험

- **기존 테스트 단언 변경** — `quantEngine.dynamicStop.test.ts` 의 BEP 분기 케이스
  (line 79~94) 가 `trailingStopPrice = 10000` (=entryPrice) 단언. ATR=500 입력
  시 새 동작은 9750. 의도된 변경이라 기존 테스트 *기댓값* 갱신 (ADR-0079 정합
  주석 명문화).
- **신규 테스트 5+ 케이스 추가** — ATR 0 회귀 / 저 ATR / 중 ATR / 고 ATR (glide
  하한 검증) / Lock-in 분기 무영향 / ENV 롤백.
- **LIVE 자동매매 본체 0줄 변경** — `atrDynamicStop.ts` 가 클라이언트 모듈을
  import 만 하므로 자동 반영. ENV 롤백으로 즉시 차단 가능.

### 운영 효과

- BEP 점프 직후 stopApproachAlert 트리거 빈도 감소 (예상 -15~-30%).
- 진짜 추세 반전(0.5×ATR 마진 초과) 시점에만 손절 발동 → 평균 보유 시간 +1~2일
  연장 → 자본 회전과 추세 추종 양 축 균형 회복.

## 대안 검토

| 대안 | 채택? | 사유 |
|------|------|------|
| (A) 0.5×ATR 글라이드 | ✅ | 본 ADR. 변동성 비례 + 통계적 평균 노이즈 마진. |
| (B) 1×ATR 글라이드 | ❌ | 너무 보수적 — BEP 점프 효과 실종. 진입가 -1×ATR ≈ 평균 -1~3% 손실 영구화. |
| (C) 시간 기반 confirmation gate (N분 유지) | ❌ | 본 ADR scope 밖. *2-Bar Confirmation Gate* (BEP 문제군 아이디어 2) 후속 PR 분리. |
| (D) regime 별 multiplier | ❌ | 복잡도 증가. 0.5 단일 상수가 RISK_ON/OFF/CRISIS 전반에서 적정. 후속 데이터 누적 후 검토. |

## 호환성

- 기존 `evaluateDynamicStop` 시그니처 (input/output) 변경 없음 — 옵셔널 ENV 만.
- 서버 `atrDynamicStop.ts` import 경로 그대로 유지.
- LIVE 매매 본체 (`signalScanner` / `entryEngine` / `exitEngine` orchestrator) 0줄 변경.

## 후속 PR

### PR-Z7 H1 (본 ADR follow-up commit, 같은 브랜치) — stopApproachAlert BEP Glide 라벨 흡수

**문제**: ADR-0079 본 PR 적용 후 `bepGlideStopPrice(10000, 1500) = 9250` 으로
손절선 설정. `stopApproachAlert` 의 `classifyStopSource(9250, 10000)` 는 -7.5%
차이 > BEP_TOLERANCE_PCT(0.5%) 이므로 **`LOSS_STOP` 분류 + "🚨 [손절 임박]
매수가 -7.50%"** 메시지 발송. ADR-0079 의도(수익 보호 강화)와 *반대 라벨* 로
운영자에게 패닉 매도 신호 → 사용자 수동 선행 청산 위험.

**수정**: `classifyStopSource` 시그니처에 `entryATR14?` 옵셔널 추가. 분류
우선순위 (정확 BEP > PROFIT_LOCK_IN > 글라이드 영역 > LOSS_STOP) 에 4번째
분기로 ADR-0079 글라이드 영역(`entryPrice − 0.5×ATR ≤ hardStopLoss < entryPrice`)
을 `BEP_PROTECTION` 으로 흡수. `BEP_GLIDE_DISABLED=true` env 시 글라이드 분기
무시 (기존 LOSS_STOP 동작 회귀). `stopApproachAlert` 가 `shadow.entryATR14`
전달.

**효과**: PR-Z6 이후 +5~+10% 수익 영역에서 손절선 접근 알림이 "[BEP 청산선
임박]" 라벨로 표시 → 운영자가 *수익 보호 의도* 정확 인지. 사용자 패닉 매도
유도 결함 영구 차단. 회귀 테스트 12 케이스 신규 (글라이드 흡수/회귀/ENV/우선순위).

### 추가 후속 PR

- BEP 문제군 아이디어 2 — Two-Bar Confirmation Gate (N분 누적 시간 조건).
- regime 별 glide multiplier 학습 (nightlyReflection 데이터 누적 후).
- BEP_GLIDE_RATIO env 로 운영자 튜닝 가능화 (현재 0.5 하드코딩).

## 페르소나 정합

- **자료 7번 — 단일 신호 vs Confluence**: 단일 +5% 트리거의 영구 점프 대신
  변동성 가중 마진으로 noise true-reversal 분리.
- **자료 23번 — 추세 추종**: 평균 노이즈를 흡수해 진짜 반전에만 청산 → 추세
  보유 시간 연장.
- **자료 8번 — 손절 운영비**: 손절 자체는 보존, *기계적 noise 트리거* 만 차단.
