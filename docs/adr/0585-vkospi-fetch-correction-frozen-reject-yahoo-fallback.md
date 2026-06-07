# ADR-0585: VKOSPI fetch correction — reject frozen KRX value, fall back to Yahoo (flag-gated)

@responsibility regime — flag-gated VKOSPI fetch 교정: KRX 일별 값이 frozen(KOSPI 급변에도 flat)이면 거부하고 Yahoo `^VKOSPI` 검증값으로 대체해, stale 격리(ADR-0584)에 그치지 않고 실제 값을 교정한다

## Status

Accepted (flag-gated `VKOSPI_FETCH_CORRECTION_ENABLED` default OFF · ADR-0584 후속 #1의 안전 구현).

## Context

ADR-0584(VKOSPI stale 가시화 + flat-during-move 격리)는 stale 값(예 73.4)을 **격리/표시**하지만
**교정하지 않는다** — flag 를 켜도 `/regime` 엔 여전히 73.4 가 보이고 risk axis 도 원값을 읽는다.
사용자 요청 = "교정"(올바른 값을 받게).

근본 fix 후보 #1(이름 substring → 공식 KRX VKOSPI 인덱스코드 검증)은 **공식 코드를 외부 확인 없이
하드코딩하면 위험** + true VKOSPI 가 `idx/drvprod_dd_trd` 가 아닌 별 엔드포인트일 가능성(미검증).
대신 이미 존재하는 대체 소스(Yahoo `^VKOSPI`, `symbolMarketRegistry` KR_INDEX_PATTERN 인지, KRX
실패 시 기존 fallback)를 **frozen 일 때도** 활용하면, 코드 검증 없이도 실제 값으로 교정 가능하다.
KRX 는 L1 primary 유지·Yahoo 는 기존 문서화 fallback(신규 Yahoo 호출 0, ADR-0561/0562 정합).

## Decision

`marketDataRefresh` VKOSPI 경로에 flag-gated 교정 추가(신규 flag `VKOSPI_FETCH_CORRECTION_ENABLED`,
격리 flag `VKOSPI_STALE_GUARD_ENABLED` 와 **독립**):

1. **KRX 거부**: KRX 행 선택 후, flag ON ∧ `detectVkospiFlatDuringMove`(= |KOSPI 수익률|≥3 ∧
   |VKOSPI changePct|<0.5, ADR-0584 SSOT)면 → `VKOSPI_KRX_REJECTED_FROZEN` 경고 후 throw → 기존
   Yahoo fallback 경로로 진입.
2. **Yahoo 검증**: Yahoo `^VKOSPI` 대체값도 동일 frozen 판별 → frozen 이면 채택 안 함
   (`VKOSPI_YAHOO_REJECTED_FROZEN` 경고), 정상이면 채택(= 교정된 값).
3. 둘 다 거부/부재 → `computed.vkospi` 미설정 → 기존 carry-forward(ADR-0584 `VKOSPI_CARRY_FORWARD`
   경고) — 잘못된 값을 새로 쓰지 않고 직전 값 유지(no worse than 현행, 경고 동반).

**안전 판별자는 flat-during-move 만** 사용(VIX-괴리 단독 거부는 진짜 폭락 spike 를 마스킹할 위험 →
배제). frozen 은 "변동성지수가 KOSPI 급변에도 안 움직임" = stale 의 명백한 징후이고 진짜 spike 는
큰 changePct 라 flat 이 아님 → 정상값 오거부 0.

## Consequences

- **flag OFF(default)**: VKOSPI fetch 경로 **byte-identical**(거부/검증 미평가, KRX 값 그대로).
- **flag ON**: frozen KRX 값(예 73.4·dayChange 0) → 거부 → Yahoo 실제값(폭락일이면 spike 라 not flat
  → 채택) → `/regime` 이 **교정된 값** 표시. Yahoo 도 stale 이거나 미도달 → carry-forward(경고).
  executionImpact = execution-adjacent(served vkospi 값 변경 → risk axis/R6 입력) → **활성 시 관측 권고**.
- ADR-0584 격리(post)와 본 교정(fetch)은 독립 flag — 격리만/교정만/둘 다 선택 가능.
- 불변식 #6 보존(frozen = provider 신선도 이슈, market signal 아님·값 0 치환 0). KIS-primary(ADR-0561):
  KRX L1 우선 유지, Yahoo 는 기존 fallback 재사용(신규 Yahoo-first 0).
- 회귀: 신규 테스트(flag 독립성·detector 재사용은 ADR-0584 33건 커버) · lint(tsc x2) 0 ·
  complexity OK · responsibility 0 · validate:all EXIT=0. 롤백 = `VKOSPI_FETCH_CORRECTION_ENABLED`
  제거 byte-equivalent.
- **잔존 후속**: 공식 KRX VKOSPI 인덱스코드 검증(소스 신뢰 근본화) · risk axis(scoreRisk) trustState
  소비 · baseDate 거래일 캘린더 stale-gate. (Yahoo 도달성은 배포지에서 `/macro_source_probe` 계열로 확인.)

## Guardrails

- No live trading path change unless explicitly stated (flag default OFF = none).
- No new Yahoo-first dependency — 기존 `^VKOSPI` fallback 재사용만(ADR-0561/0562 정합), KRX L1 우선 유지.
- 진짜 폭락 시 VKOSPI spike 를 마스킹/거부 금지 — flat-during-move 판별자만 사용(VIX-괴리 단독 거부 배제).
- Provider 신선도 이슈를 market signal 로 변환 금지(불변식 #6) · 값 0 치환 금지(null≠0).
- No SourceSnapshot bypass — MacroState write 경로만.
