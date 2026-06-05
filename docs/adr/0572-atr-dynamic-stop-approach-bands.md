# ADR-0572 — ATR Dynamic Stop-Approach Bands (손절 접근 밴드 ATR 동적화)

@responsibility 손절 접근 3단계 경보 발동 임계를 종목 ATR14 동적 밴드(min(배수×ATR%, 고정 cap))로 전환 — 저변동주 과민 해소, 알림 전용.

## 상태

Accepted (2026-06-05)

## 컨텍스트

`server/trading/exitEngine/rules/stopApproachAlert.ts` 의 손절 접근 3단계 경보는
`distToStop`(현재가 → 손절선까지 거리 %)이 **고정 임계 5/3/1%** 이내일 때 단계별
개인 DM(`sendPrivateAlert`)을 발송한다.

```
Stage 1: distToStop < 5%  → 접근 경고
Stage 2: distToStop < 3%  → 임박 경고
Stage 3: distToStop < 1%  → 집행 임박
```

문제:

1. **변동성 무차별 임계** — KB금융 등 *저변동주*는 ATR(일중 평균 변동폭)이 작아
   손절선이 진입가에 가깝게 설정된다. 이 경우 현재가가 손절선까지 5%/3%/1% 안에
   들어오는 사건이 *정상 noise* 범위에서도 빈번히 발생한다.
2. **저변동주 과발생** — 사용자 보고: "조금밖에 안 떨어졌는데 손절 임박/집행 임박
   DM 이 온다. 너무 민감." 저변동주에서 소폭 하락에도 3단계 경보가 연쇄 발화.
3. **근본원인 = ATR 무관 고정 밴드** — 동일한 5/3/1% 가 ATR=300원 종목과 ATR=1500원
   종목에 똑같이 적용된다. 고변동주에는 적정하나 저변동주에는 과민하다.

이는 ADR-0079(ATR-Buffered BEP Glide)가 손절선 *설정 가격* 을 ATR 비례화한 것과
같은 결의 문제 — 여기서는 *알림 발동 임계* 를 ATR 비례화한다.

## 결정

`stopApproachAlert` 의 distToStop 발동 임계 5/3/1% 를 종목 ATR14 기반 **동적 밴드**로
교체하되, **고정 5/3/1% 를 상한(cap)** 으로 둔다.

### 공식

```
atrPct      = entryATR14 / currentPrice × 100        // 종목 변동성 %
band(stage) = min(MULTIPLIER[stage] × atrPct, LEGACY[stage])
```

| Stage | ATR 배수 | 레거시 cap |
|-------|----------|------------|
| 1     | 2.0 × ATR% | 5% |
| 2     | 1.0 × ATR% | 3% |
| 3     | 0.4 × ATR% | 1% |

### cap = "좁히기만" — 회귀 위험 0

`min(배수 × atrPct, 고정)` 구조이므로 ATR 스케일링은 밴드를 **좁히기만** 한다.
어떤 종목도 레거시 5/3/1% 보다 *더 민감해질 수 없다*.

- **고변동주** (예: atrPct ≈ 4% → 2.0×4 = 8% > cap 5) → cap 적용 → **현상 유지**.
- **저변동주** (예: atrPct ≈ 1% → 2.0×1 = 2% < cap 5) → 2% 발동 → **둔감화**(목표).

즉 고변동주는 레거시와 byte-equivalent, 저변동주만 과민이 해소된다.

### Fallback (고정 밴드 복원)

다음 중 하나라도 충족되면 고정 5/3/1% 로 안전 복귀(정보 부족 시 보수적):

- `entryATR14` 부재 / 비유한(NaN·Infinity) / ≤ 0
- `currentPrice` 비유한 / ≤ 0

### ENV 롤백 스위치

`STOP_APPROACH_ATR_BANDS_DISABLED=true` → ATR 동적 밴드 전면 비활성, 고정 5/3/1%
전체 복원. **default OFF = 기능 ON** (저변동주 과민 해소가 기본 동작).
운영 중 회귀 발견 시 컨테이너 재시작 없이 env 변경만으로 레거시 복원.

## 결과

### 효과

- 저변동주(KB금융 등)에서 소폭 하락 시 손절 접근 DM 과발생 해소 — 종목 변동성에
  비례한 발동 임계로 noise 트리거 차단.
- 고변동주는 cap 으로 현상 유지 — 변동성 큰 종목의 손절 접근 가시성은 보존.
- 사용자 "너무 민감" 피드백의 기계적 원인(ATR 무관 고정 밴드) 직접 제거.

### 회귀 위험 0

- **cap 단방향성** — ATR 스케일링이 밴드를 좁히기만 하므로 어떤 입력도 레거시보다
  더 자주 발화하지 않는다. 알림 *감소* 방향만 가능.
- **Fallback 보존** — entryATR14 부재 종목은 고정 5/3/1% byte-equivalent 동작.
- **ENV 즉시 롤백** — `STOP_APPROACH_ATR_BANDS_DISABLED=true` 1줄로 전면 복원.

### executionImpact = NONE

본 변경은 **개인 DM(`sendPrivateAlert`) 알림 발동 임계만** 조정한다.

- 실주문 / SourceSnapshot / Gate score / 포지션 사이징 / Shadow Learning **무접촉**.
- `hardStopLoss`(손절선 가격) 자체는 변경하지 않는다 — 알림이 언제 *뜨는지* 만 조정.
- 실제 청산은 별도 `channelSellSignal`(CH1)이 발동 시 사후 보고 (ADR-0042 계승).
- 알림이 안 떠도 손절 자체는 exitEngine 하드스톱이 정상 집행 — 보호선 무력화 0.

## Rollback

| 단계 | 조치 |
|------|------|
| 1차 (즉시) | `STOP_APPROACH_ATR_BANDS_DISABLED=true` env 설정 → 고정 5/3/1% 복원 |
| 2차 (코드) | 동적 밴드 산출 블록 revert → distToStop < 5/3/1% 직접 비교 복원 (byte-equivalent) |

ENV 롤백은 컨테이너 재시작 없이 즉시 적용 — 어떤 종목도 더 민감해지지 않는
단방향 변경이라 1차 롤백만으로 충분(2차는 안전망).

## Tests

- 고변동주(atrPct 큰 입력) → band = cap(5/3/1) → 레거시 동작 보존 단언.
- 저변동주(atrPct 작은 입력) → band < cap → 좁아진 임계 발동 단언 (둔감화 검증).
- entryATR14 부재 / NaN / ≤0 → 고정 5/3/1% fallback 회귀.
- currentPrice 비유한 / ≤0 → 고정 5/3/1% fallback 회귀.
- `STOP_APPROACH_ATR_BANDS_DISABLED=true` → 전체 고정 밴드 복원 (ENV 롤백).
- 3단계 dedupeKey / source 분류(ADR-0028·0079) 무영향 — 라벨 경로 회귀 0.
- cap 단방향성 — 동적 밴드가 레거시보다 *넓어지지 않음* 단언 (회귀 위험 0 증명).

## Invariants

9대 불변식 VERBATIM 0줄 변경. 본 ADR 은 알림 발동 임계 조정으로 다음을 보존한다:

- **불변식 #1** (Trading Engine 항상 가동) — 알림 임계만 조정, 엔진 무접촉.
- **불변식 #2** (Shadow Learning 비정지) — Shadow 판단/ledger 무접촉.
- **불변식 #6** (Provider 장애 ≠ market signal) — provider 무접촉.
- **불변식 #8** (실거래 차단 ≠ Shadow 차단 분리) — 실거래/Shadow 경계 무접촉.

손절선 가격(`hardStopLoss`) 산출과 실제 청산 집행(`channelSellSignal`)은 본 ADR
scope 외 — 알림이 *뜨는 시점* 만 ATR 비례화한다.

## 계보 (Lineage)

| ADR | 관계 |
|-----|------|
| ADR-0028a (exitEngine 분해) | `stopApproachAlert` 모듈을 exitEngine/rules 로 분리한 기반. |
| ADR-0042 (sendPrivateAlert · stop countdown) | 3단계 경보를 CH1 이 아닌 개인 DM 으로 발송하는 통로 — 본 ADR 이 그 발동 임계만 ATR 비례화. 실제 청산 사후 보고(channelSellSignal) 계승. |
| ADR-0079 (ATR-Buffered BEP Glide) | 손절선 *설정 가격* 을 0.5×ATR 로 비례화한 선례. 본 ADR 은 같은 ATR 비례화 원리를 *알림 발동 임계* 에 적용 (가격 무변경). source 분류기 entryATR14 흐름(PR-Z7 H1) 재사용. |

## 대안 검토

| 대안 | 채택? | 사유 |
|------|------|------|
| (A) min(배수×ATR%, 고정 cap) | ✅ | 본 ADR. cap 단방향(좁히기만) → 회귀 위험 0, 저변동주만 둔감화. |
| (B) 순수 배수×ATR% (cap 없음) | ❌ | 고변동주에서 밴드가 5% 초과로 *넓어져* 레거시보다 민감해짐 → 회귀 위험. |
| (C) 손절선 가격 자체 ATR 비례화 | ❌ | executionImpact 발생(청산 가격 변경) — 본 ADR scope(알림 전용) 밖. ADR-0079 영역. |
| (D) 종목 분류(저변동주 화이트리스트) | ❌ | 정적 분류는 변동성 regime 변화 미추종. ATR% 연속 산출이 적응적. |
