# ADR-0586: Revert VKOSPI flat-during-move heuristic — 73.4 was the real KRX crash value

@responsibility regime — revert the flat-during-move stale heuristic (ADR-0584 Phase B guard + ADR-0585 correction + /regime ⚠️STALE marker) after /vkospi_index_dump proved 73.4 is the genuine KRX-official VKOSPI during a real crash; keep only factual freshness visibility + tighten the VKOSPI row name filter

## Status

Accepted. **Supersedes the flat-during-move heuristic of ADR-0584 (Phase B `VKOSPI_STALE_GUARD_ENABLED`) and ADR-0585 (`VKOSPI_FETCH_CORRECTION_ENABLED`) — both reverted.** ADR-0584 Phase A (factual visibility) retained. ADR-0530 classic guard restored unchanged.

## Context

ADR-0584/0585 진단은 라이브 VKOSPI 73.4(dayChange 0.00 · VIX 16.1)를 stale/오류로 판정하고
flat-during-move("KOSPI 급변 중 VKOSPI flat") 휴리스틱으로 격리/교정하려 했다. `/vkospi_index_dump`
(2026-06-07, KRX `idx/drvprod_dd_trd` 306행 read-only 덤프) 결과 그 전제가 **틀렸음이 드러났다**:

- **이름 매칭 정확**: `코스피 200 변동성지수` = 공식 VKOSPI. wrong-row 아님. 응답 전체에 ~16짜리 VKOSPI
  대체행 **없음**(다른 "변동성" 행은 `최소변동성지수` 14694 등 지수포인트 스케일 *주식* 지수).
- **진짜 대폭락 확인**: 같은 덤프에 KRX 300 레버리지 −11.88% · SK하이닉스 선물 레버리지 −26.70% ·
  2차전지 레버리지 −8.56% 등 전반 −5~26% 카니지. → **VKOSPI 73 은 폭락장에서 현실적**(COVID 2020-03
  ~69). VIX 16(미국 평온)은 **한국발 국지 폭락**이면 디커플링이 정상 → 73 vs 16 괴리가 "implausible"
  근거가 안 됨. 73.44 는 KRX 공식값일 가능성이 높다.
- **유일 잔존 이상치 = chg%=0.00**(같은 baseDate 06-05 에 KOSPI −5.54% 인데 VKOSPI 변화율만 0) —
  변화율(FLUC_RT) 서브필드가 이상하거나 변동성이 전일 고점에서 plateau. 단 종가 73.44 자체는 KRX 공식.
- **휴리스틱 false-positive 확인**: flat-during-move 는 "진짜 spike(큰 변화)"는 안 막지만 **"진짜
  plateau(높고 변화 작음)"는 막는다** → 실제 폭락장의 진짜 높은 VKOSPI 를 오격리. ADR-0530 이 G2 로
  피하려던 "진짜 폭락 마스킹" 위험을 본 휴리스틱이 재도입한 셈.
- **부수 발견**: bare `'변동성지수'` 필터가 `KRX 최소변동성지수`(주식 지수)까지 매칭. 현재는 VKOSPI 가
  먼저라 맞게 선택되나, 순서 변동 시 14694 를 줍는 fragility.

## Decision

1. **flat-during-move 휴리스틱 전면 revert**: ADR-0584 Phase B 가드(vkospiSanityGuard G4) +
   ADR-0585 교정(KRX-reject/Yahoo-validate) + `/regime` ⚠️STALE 마커 + flag 2종
   (`VKOSPI_STALE_GUARD_ENABLED`/`VKOSPI_FETCH_CORRECTION_ENABLED`) + `vkospiFreshness.ts` 모듈 +
   freshness 테스트 2건 제거. **ADR-0530 classic 가드(G1∧G2∧G3) 원복**.
2. **ADR-0584 Phase A 사실 가시화 유지**: `vkospiBaseDate`(BAS_DD)/`vkospiFetchedAt` 영속 +
   `VKOSPI_ROW_AMBIGUOUS`/`VKOSPI_CARRY_FORWARD` 경고 + `/regime` baseDate/fetchedAt 표시. 이들은
   *판정*이 아니라 *사실*이라 false-positive 없음.
3. **VKOSPI 행 이름 필터 정밀화**: bare `'변동성지수'` → `'코스피 200 변동성지수'`/`'코스피200변동성지수'`
   (+ VKOSPI/코스피변동성)로 좁혀 `최소변동성지수` 등 동음이의 배제. 현 선택과 byte-equivalent(올바른
   행 동일 선택) + 순서 변동 robustness.
4. **`/vkospi_index_dump` 진단 유지**(정답을 알려준 도구).

## Consequences

- 프로덕션 즉시 효과: `/regime` 이 진짜 VKOSPI 73.4 에 대해 **잘못된 ⚠️STALE 을 더 이상 표기 안 함**
  (always-on 마커가 유일하게 prod 에서 오작동하던 부분). 가드/교정 flag 는 기본 OFF 였으므로 매매 영향 0.
- 순net: VKOSPI 경로는 **사실 영속(baseDate/fetchedAt) + 경고 + 정밀 필터**만 남고, 자동 *판정/거부*
  휴리스틱은 없음. ADR-0530 classic 가드 무변경.
- **교훈**: 변동성지수 단일값을 "stale" 로 자동 단정하기 전에 **시장 맥락(동반 지수 카니지)**을 먼저
  봐야 한다. 단일 지표 implausibility 판정은 폭락장에서 위험. 더 나은 stale 판별자는 flat 여부가 아니라
  **baseDate 거래일 신선도**(미구현 후속).
- 미해결: chg%=0.00 (FLUC_RT 이상)의 정확한 원인 · 73.44 의 외부 교차확인(네이버/KRX "코스피200
  변동성지수" 2026-06-05) · baseDate 거래일 캘린더 stale-gate. 73 이 외부와 불일치로 확인되면 그때
  KIS 지수 소스 검토(별도 ADR).
- 회귀: lint(tsc x2) 0 · vkospiSanityGuard(ADR-0530) 테스트 통과 · validate:all EXIT=0.

## Guardrails

- No live trading path change — 가드/교정 제거분은 기본 OFF 였어 prod byte-equivalent; ⚠️STALE 마커
  제거만 prod 표시 정정(매매 무관).
- ADR-0530 classic 가드 동작 보존(원복).
- 단일 지표 implausibility 로 진짜 시장 신호(폭락장 VKOSPI spike/plateau) 마스킹 금지(불변식 #6).
- 필터 정밀화는 올바른 행 선택을 바꾸지 않음(byte-equivalent) — robustness만.
