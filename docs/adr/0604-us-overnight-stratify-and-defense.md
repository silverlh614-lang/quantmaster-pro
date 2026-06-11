# ADR-0604: 미국 야간↔KOSPI stratify 관측(2단계) + 야간 급락 개장 전 보수 강등(3단계, default OFF)

@responsibility policy — 미국 야간(SPX/NDX) 수익 밴드별 KOSPI 당일 수익을 ledger 로 실측(상관 가정 금지)하고, 실측 확인 후 켤 하방 대칭 가드(야간 급락 시 bias 감점 + R6 회복 가속 차단)를 flag default OFF 로 선구현

## Status

Accepted (2단계 구현·가동 — 3단계 구현·default OFF)

## Context

ADR-0603(SPX KIS 승격·NDX 수집)의 후속. 기존 연결은 상방 편향 — `usOvernightBoost`(SPX +1.5%↑
→ R6 회복 floor +10)는 있으나 **하방 대칭(야간 급락 → 개장 전 보수) 부재**. ADR-0592/0593 이
국내 지표의 동일 비대칭(하락 트리거만 있고 상방 fast-path 부재)을 수리한 것의 미국판 역방향.
단, 한미 상관은 비정상성(디커플링 구간)이 알려진 리스크 — 가드 활성화는 실측이 선행해야 한다.

## Decision

### 2단계 (구현·즉시 가동) — stratify 관측 ledger

- `server/learning/usOvernightStratifyLedger.ts` — KST 일자당 1행
  `{dateKey, spxOvernight, ndxOvernight, kospiDayReturn}` (캡 400행≈1.5년, 당일 완성 행이라
  단순 절단 무해). **upsert 의미론**: 야간 수익은 first-write-wins(KST 아침 첫 기록 고정 —
  미국 장중(KST 야간) 재계산의 당일 오염 방지), kospiDayReturn 은 last-write-wins(종가 수렴).
- 기록 지점: `refreshSpxSection` 말미 (KIS/Yahoo 소스 무관, 실패 격리).
- 표시: 신규 텔레그램 `/us_overnight` — SPX 야간 5밴드(<-2 / -2~-0.5 / -0.5~+0.5 / +0.5~+2 / >+2)
  별 n·KOSPI 평균·승률. **게이트 미소비** — 3단계/후속(fast-upgrade 보조 AND·SOXX 섹터축)
  활성화 판단의 유일 근거.

### 3단계 (구현·default OFF) — `US_OVERNIGHT_DEFENSE_ENABLED` (`=== 'true'`)

ON + `spxDayReturn < US_OVERNIGHT_DEFENSE_THRESHOLD_PCT`(가드 -10~-0.5, default **-2.5%**) 시:
1. **bias 감점** — `resolveRecoveryBiasScore` derived 에 −12 (usOvernightBoost +10 의 하방 대칭,
   보수 우위). 2. **R6 회복 가속 차단** — 급락 밤사이엔 `resolveR6RecoveryDecayFloor` 0 반환
   (회복 latch 가속 보류 — 다음 정상 밤 자동 해제). flag OFF = 양 경로 byte-equivalent.

활성화 기준(운영자): `/us_overnight` 에서 `<-2%` 밴드 n≥10 + KOSPI 평균이 명확한 음수·낮은 승률
확인 시 ON. 디커플링 구간(밴드 통계 중립화) 관찰 시 OFF 복귀.

### 미구현 (후속 ADR 후보) — **ADR-0605 로 일괄 이행 (2026-06-11)**

ADR-0593 fast-upgrade 보조 AND(상방) · SOXX→Gate2 반도체 섹터축(SOX 지수로 구현 — 해외지수
일봉 재사용, 해외주식 시세 API 불필요) · NDX 밴드 분리 통계 → 전부 `0605-us-leading-index-residual-wiring.md`.

## Guardrails

- 2단계 ledger 는 어떤 판정에도 미소비. 3단계는 flag OFF 기본 + bias/R6 보조 경로만(주문·게이트
  임계 0줄). FOMC/VIX 와 중복 계상 없음(신규 입력은 가중 합산이 아닌 임계 게이트형). lookahead 0
  (전일 종가만). 결손 시 미발동 (불변식 #6).

## Rollback

3단계: `US_OVERNIGHT_DEFENSE_ENABLED` 미설정/false (기본). 2단계: 기록 try/catch 격리 — 모듈
revert 로 제거 가능 (데이터 파일 잔존 무해).

## References

- ADR-0603(1단계 — KIS 승격·NDX 수집·로드맵) · ADR-0592/0593(비대칭 수리 선례·phased flag) ·
  `regimeBridge.ts` resolveRecoveryBiasScore/resolveR6RecoveryDecayFloor(usOvernightBoost 대칭점)
