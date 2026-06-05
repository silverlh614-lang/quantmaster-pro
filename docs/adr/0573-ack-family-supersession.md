# ADR-0573 — T1 Ack Family Supersession (T1 ack 패밀리 흡수)

@responsibility 같은 ackFamilyKey 의 새 pending ack 가 이전 단계 ack 를 흡수 — 손절 접근 다단계 재발송/에스컬레이션을 종목당 1건으로 축소, 알림 폐루프 전용.

## 상태

Accepted (2026-06-05)

## 컨텍스트

`server/trading/exitEngine/rules/stopApproachAlert.ts` 의 손절 접근 경보는 단계가
올라갈수록 priority 가 높아진다. Stage2("손절 임박")·Stage3("손절 집행 임박")는
priority **CRITICAL → tier T1_ALARM** 으로 분류되어 `ackTracker` 에 **T1 ack** 로 등록된다.
T1 ack 는 미확인 시 `sweepPendingAcks` 가 **30분 재발송 + 60분 에스컬레이션** 하는
안전망이다.

문제:

1. **단계별 dedupeKey 불일치** — Stage2/Stage3 의 dedupeKey 가 각각
   `stop_approach_2:CODE` / `stop_approach_3:CODE` 로 **다르다**. `registerPendingAck`
   의 기존 dedupeKey 흡수 로직은 *동일* dedupeKey 만 흡수하므로 두 단계가 서로
   안 걸린다.
2. **pending ack 중복 → 재발송 배가** — 한 종목에서 Stage2·Stage3 가 둘 다 pending
   으로 살아남아 `sweepPendingAcks` 가 **각각** 30분 재발송 + 60분 에스컬레이션 →
   "[재발송 — 미확인 T1 경보]" 가 한 종목에서 **이중**(단계 수만큼) 발생한다
   (사용자 보고 이미지).
3. **구조적 노이즈** — ADR-0572(ATR 동적 밴드)가 손절 접근 경보의 발생 *빈도* 를
   줄였으나, 일단 다단계가 울리면 재발송/에스컬레이션이 **단계 수만큼 배가**되는
   구조는 잔존한다. 빈도 완화와 별개의 폐루프 중복 문제다.

같은 종목의 손절 접근은 단계가 바뀌어도 **하나의 사건**이다 — 종목당 활성 [확인]
요청은 최신 단계 1건이면 충분하다.

## 결정 (engine-dev 동시 구현 — 본 ADR 은 문서화)

`ackTracker` 에 **ack family supersession**(패밀리 흡수)을 도입한다. 같은
`ackFamilyKey` 를 가진 새 pending ack 가 등록되면, 같은 패밀리의 이전 pending ack 를
**흡수**(supersede)하여 종목당 활성 [확인] 을 **1건만** 유지한다.

### 인터페이스 변경 (additive)

- `TelegramAlertOptions.ackFamilyKey?: string` 신설 — 호출자가 ack 들을 하나의
  패밀리로 묶는 opt-in 키.
- `T1AckEntry.familyKey` 영속 — pending ack 레코드에 패밀리 키 저장.
- `registerPendingAck` 가 새 ack 등록 시 **같은 familyKey 의 이전 pending ack 를
  흡수**(이전 단계 → 최신 단계 대체).

### stopApproachAlert 적용

3단계가 `ackFamilyKey: stop_approach:{종목코드}` 를 **공유**한다.

```
Stage2 등록 → familyKey = stop_approach:005930  (pending)
Stage3 등록 → familyKey = stop_approach:005930  → Stage2 ack 흡수
            → 종목당 활성 [확인] 1건(Stage3 만)
```

→ 재발송/에스컬레이션이 종목당 **3건 → 1건** 으로 축소된다.

### byte-equivalent (미지정 호출자)

- 기존 dedupeKey 흡수 로직은 **유지**(additive). `ackFamilyKey` 는 새 흡수 *축* 을
  추가할 뿐 기존 동작을 바꾸지 않는다.
- `ackFamilyKey` 미지정 모든 기존 호출자는 **byte-equivalent** — familyKey 가
  undefined 면 패밀리 흡수가 발화하지 않고 기존 단계별 개별 ack 동작 그대로다.
- 재발송/에스컬레이션 *간격*(`RESEND_AFTER_MS` 30분 / `ESCALATE_AFTER_MS` 60분)은
  **무변경** — 흡수만 추가, 타이밍 상수 무접촉.

## 결과

### 효과

- 손절 접근 다단계 경보의 재발송/에스컬레이션 중복(종목당 단계 수만큼 배가) 제거 —
  종목당 활성 [확인] 1건으로 수렴.
- 사용자 보고 "[재발송 — 미확인 T1 경보]" 이중 발생의 기계적 원인(단계별 dedupeKey
  불일치 → pending 다중 생존) 직접 제거.
- ack 안전망(미확인 시 재발송·에스컬레이션) 자체는 **보존** — 종목당 최신 단계 1건에
  대해 30분/60분 폐루프가 정상 유지된다.

### executionImpact = NONE

본 변경은 **알림 폐루프 엔트리 수만** 축소한다.

- 실주문 / SourceSnapshot / Gate score / 포지션 사이징 / Shadow Learning **무접촉**.
- 손절선 가격(`hardStopLoss`)·실제 청산 집행 무변경 — ack 추적 폐루프만 조정.
- ack 안전망 무력화 0 — 흡수된 이전 단계 대신 최신 단계가 재발송/에스컬레이션을
  계승하므로 미확인 경보가 사라지지 않는다(가시성 보존).

## Rollback

| 단계 | 조치 |
|------|------|
| 1차 (호출자 opt 제거) | `stopApproachAlert` 에서 `ackFamilyKey` 부여 제거 → 단계별 개별 ack 동작 byte-equivalent 복귀. 별도 ENV 불필요 — 호출자 opt 제거가 곧 롤백. |
| 2차 (코드) | `registerPendingAck` 의 familyKey 흡수 분기 + `T1AckEntry.familyKey` + `TelegramAlertOptions.ackFamilyKey` revert (additive 변경이라 미지정 경로 byte-equivalent). |

`ackFamilyKey` 는 opt-in 이므로 부여를 빼면 기존 동작으로 즉시 복귀한다. ENV 토글이
불필요한 구조(미지정 = 기존 동작).

## Tests

engine-dev 5케이스:

1. **familyKey 흡수** — 같은 familyKey 의 새 ack 등록 시 이전 pending ack 흡수,
   활성 ack 1건만 잔존.
2. **다른 familyKey 유지** — 서로 다른 familyKey 의 ack 는 흡수 없이 각각 pending
   유지(교차 흡수 0).
3. **미지정 회귀** — `ackFamilyKey` undefined 호출자는 패밀리 흡수 미발화, 기존
   단계별 개별 ack byte-equivalent.
4. **dedupeKey 회귀** — 기존 dedupeKey 흡수 로직 무영향(additive 검증).
5. **stopApproachAlert opt 전파** — 3단계가 `stop_approach:{코드}` 공유 → Stage3 이
   Stage2 ack 흡수 → 재발송/에스컬레이션 종목당 1건 단언.

## Invariants

9대 불변식 VERBATIM 0줄 변경. 본 ADR 은 ack 폐루프 엔트리 수 축소로 다음을 보존한다:

- **불변식 #1** (Trading Engine 항상 가동) — 알림 폐루프만 조정, 엔진 무접촉.
- **불변식 #2** (Shadow Learning 비정지) — Shadow 판단/ledger 무접촉.
- **불변식 #6** (Provider 장애 ≠ market signal) — provider 무접촉.
- **불변식 #8** (실거래 차단 ≠ Shadow 차단 분리) — 실거래/Shadow 경계 무접촉.

ack 안전망은 종목당 최신 단계 1건에 대해 유지되므로 미확인 경보의 가시성은 무손실이다.

## 계보 (Lineage)

| ADR | 관계 |
|-----|------|
| ADR-0042 (sendPrivateAlert · stop countdown) | 손절 접근 3단계를 개인 DM 으로 발송하는 통로 — 본 ADR 은 그 ack 폐루프를 패밀리 단위로 묶는다. |
| ADR-532 (telegram noise reduction) | CH 라우팅·사용자 노이즈 필터 계보. 본 ADR 은 ack 재발송/에스컬레이션 중복이라는 잔존 노이즈 축을 제거. |
| ADR-0572 (ATR Dynamic Stop-Approach Bands) | 손절 접근 경보 발생 *빈도* 를 줄임. 본 ADR 과 **상보** — 0572 는 빈도 완화, 0573 은 다단계 발생 시 폐루프 중복 제거. |

## 대안 검토

| 대안 | 채택? | 사유 |
|------|------|------|
| (A) ackFamilyKey 흡수(opt-in) | ✅ | 본 ADR. additive·미지정 byte-equivalent, 호출자 opt 제거가 곧 롤백, 안전망 보존. |
| (B) Stage2/3 dedupeKey 통일 | ❌ | 단계별 메시지 dedup 식별성 손실(Stage 전환 메시지 흡수돼 표시 누락). 흡수 축과 표시 dedup 축은 분리 유지. |
| (C) 재발송/에스컬레이션 간격 연장 | ❌ | 중복 *횟수* 미해결(여전히 단계 수만큼 배가) + 안전망 응답성 저하. |
| (D) Stage3 만 T1 등록 | ❌ | Stage2 미확인 가시성 손실(Stage3 도달 전 손절 임박 안전망 부재). |
