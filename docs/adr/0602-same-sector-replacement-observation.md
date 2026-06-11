# ADR-0602: 동일 섹터 강자 교체 — 교체 엔진 배선 부재 수리의 phased 관측 (Phase 0 표시 전용)

@responsibility policy — 섹터 한도 포화 시 "약한 보유→강한 신규 동일 섹터 교체" 경로를 Phase 0 관측(제안 표시·counterfactual 기록·실집행 0)부터 단계 도입해, 한도 해제 요구를 리스크 증가 없이 수용할 출구를 데이터로 검증

## Status

Accepted (Phase 0 구현 — 관측·표시 전용, default ON `!== 'false'` · **Phase 1 구현(2026-06-11)
— shadow 집행 default OFF** · Phase 2 미구현)

## Context — 2026-06-11 운영자 토론("섹터 리미트 해제?")의 코드 추적 결과

- 테크윙(반도체장비) 진입이 `MAX_SECTOR_CONCENTRATION`(2) 가드에 차단 → 운영자가 한도 해제 제기.
- 한도 해제 반대 근거: 동일 섹터 2종목은 상관 ~0.8+ 의 사실상 단일 베팅 — 3번째는 기대수익이
  아니라 하방 상관 손실을 1.5배 (테마 -15% 시 계좌 -4.5%, DAILY_LOSS_LIMIT 5% 근접).
- 올바른 출구 = "같은 2슬롯 내 약자→강자 교체"인데, 추적 결과 **이중 갭** 확정:
  1. `tradeReplacement.ts`(Phase 4-⑦ 교체 엔진)는 **운영 호출 0건의 미배선 dead 모듈**.
  2. 배선되더라도 `proposeReplacement` 조건 (iii)이 `heldSector !== candSector` 를 요구 —
     **동일 섹터 내 강자 교체는 설계상 불가** (엔진의 의도가 '섹터 중복 해소'였기 때문).

## Decision

### Phase 0 (구현) — 관측·표시 전용, 실집행 0

1. **`proposeSameSectorReplacement`** (tradeReplacement.ts 신규 순수 함수): 같은 섹터 open 보유 중
   교체 쿨다운이 아니고 **gate 우위 ≥ TRADE_REPLACEMENT_MIN_GATE_DELTA(1.5)** 인 약자를 선택.
   정체보유(momentumSlowing 또는 수익률 ≤0)는 필수가 아닌 **score 가중치(+5)** — Phase 0 목적이
   발동 빈도 자체의 관측이므로 임계는 counterfactual 데이터로 후속 튜닝.
2. **sectorConcentrationGate 통합**: 한도 차단 시 ① counterfactual 기록(직전 patch) ② 교체 관측
   평가 → 제안이 있으면 차단 로그/텔레그램에 `💡 교체 관측(Phase0·실집행 없음): 보유X(gate)→
   신규Y(gate) Δ…` 1줄 표기. 평가 실패는 격리(가드 동작 무영향).
3. flag `TRADE_REPLACEMENT_OBSERVE_ENABLED` — **default ON** (`!== 'false'`): 표시·기록 전용이라
   집행 위험 0, `=false` 1줄 롤백. 보유 뷰의 결손 필드(currentPrice 등)는 보수 기본값
   (entryPrice 대체 → returnPct 0 중립) — 결손 ≠ 신호 (불변식 #6).

### Phase 1 (구현 2026-06-11): shadow 교체 집행 — `TRADE_REPLACEMENT_SHADOW_EXECUTE_ENABLED === 'true'` (default OFF)

신규 `sameSectorShadowReplacement.ts` 단일 진입점. **게이트의 차단 결정(pass=false)은 무변경**
— flag ON 에서도 live 주문 경로 byte-equivalent, 교체는 shadow 장부 안에서만:
① 약자 shadow(**mode==='SHADOW' 만** — LIVE 무접촉, 불변식 #8) 전량 청산 fill +
`exitRuleTag='SECTOR_REPLACEMENT_EXIT'`(자동 평가 루프 비선택 신규 태그, 기존 종결 status 어휘
재사용) ② 청산 평가액으로 신규 후보 shadow 생성(PENDING — exitEngine 기존
backfill/ACTIVE 승급 경로 인수) ③ 청산 보유의 "유지했다면" counterfactual
(`SECTOR_REPLACEMENT_EXITED`) 기록 → 교체 forward(신규 shadow 자체 추적)와 대조.
가드: 20분 쿨다운(`markReplacement` 보유+후보 양방향)·일일 상한
`TRADE_REPLACEMENT_DAILY_MAX`(0~10, default 2)·후보 target/stop 결손 시 집행 보류(불변식 #6).
발동 조건 강화(정체보유 필수 여부)는 Phase 0 빈도 + SECTOR_CONCENTRATION_LIMIT counterfactual
라벨 분포로 후속 결정.

### Phase 2 (미구현 — 설계): live 교체

shadow 교체 표본 N≥30 + 교체 우위(교체 forward > 유지 forward) 통계 확인 + **운영자 승인** 후
별도 flag. live 교체 = 실매도+실매수 2주문이므로 autoTradeEngine 단일 통로·OCO 정리·부분체결
처리 설계가 선행 조건 (본 ADR 범위 밖, 후속 ADR).

## Guardrails

- Phase 0 은 주문 경로 0줄 — 가드의 차단 결정 무변경, 표시·기록만. KIS fetch 0.
- `MAX_SECTOR_CONCENTRATION` 무변경 — 본 ADR 은 한도 해제가 아니라 한도 내 질적 개선 경로.
- 기존 `proposeReplacement`(타 섹터 교체) 의미 무변경 — 동일 섹터판은 별도 함수로 격리.

## Rollback

`TRADE_REPLACEMENT_OBSERVE_ENABLED=false` 1줄 → 힌트 표시 0, 가드는 기존과 byte-equivalent.

## References

- 2026-06-11 운영자 토론 + Patch-SectorLimit-Blocked-Counterfactual (차단 counterfactual — 본 ADR
  Phase 판정의 데이터 원천) · `tradeReplacement.ts`(미배선 확정·조건 (iii) 동일 섹터 금지) ·
  `riskManager.MAX_SECTOR_CONCENTRATION` · ADR-0030(Regret Asymmetry — 추가 아닌 교체 철학 정합) ·
  ADR-0594/0598 (phased flag 선례)
