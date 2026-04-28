# ADR-0078: Enemy Checklist 자동 차단 — 신용잔고율·개인 비중 기반 SSOT 정책

- 일자: 2026-04-27
- 상태: ACCEPTED
- 작성자: QuantMaster Harness (orchestrator)
- 관련: ADR-0031 (PR-D EnemyChecklistFlag UI), ADR-0077 (PR #398 TradeSignalStatus + ENEMY BlockGate), 절대 규칙 #2/#4

## 1. 배경

사용자 12-영역 자동매매 안전 게이트 audit (PR #398) 결과 **Gap 3 — Enemy Checklist 자동 차단 (PARTIAL)** 확인. 현재 상태:

- `server/clients/enemyCheckClient.ts:18-24` 가 KIS 두 개 TR (`FHKST01010100` + `FHKST01010300`) 로 **신용잔고율(creditRate)** + **개인 비중(individualDominance)** 두 데이터 수집은 작동 중.
- `server/trading/buyPipeline.ts:300` 가 `fetchEnemyCheckData` 를 매수 직전 호출.
- `server/telegram/buyApproval.ts:142` 가 텔레그램 메시지에 `formatEnemyCheckSummary` 로 ⚠️/⚠️⚠️ 마커와 함께 *표시* 만 수행.
- 자동 감점·차단 로직은 `enemyCheckClient.ts:5-7` 주석 "모의매매 데이터가 충분히 쌓인 후 유효성 검증 시 도입 예정" 으로 보류.
- ADR-0077 (PR #398) 의 `TradeSignalBlockGate` union 에 `'ENEMY'` 가 포함됐으나 `markBlocked('ENEMY')` 호출자 0건.

사용자 audit 제안서의 7 카테고리 (보호예수 / 대주주 / 신용 / 공매도 / 목표가 / 실적 / 섹터 헤지) 는 *이상적 목표* 였으나 현재 KIS 로 수집 가능한 것은 **2개 항목** 만. 본 PR 은 *수집 가능한 2개* 한정으로 자동 차단 정책을 정착하고 후속 PR 에서 데이터 소스 확장 시 임계 추가.

## 2. 결정

`server/trading/enemyAutoBlock.ts` SSOT 모듈을 신설해 `EnemyCheckResult → EnemyAutoBlockDecision` 평가를 단일 진입점으로 통합. `buyPipeline.ts` 가 매수 직전 1회 호출 후 차단 시 `markBlocked('ENEMY')` + `REJECTED` 처리.

### 2.1 임계값 SSOT

| 지표 | 표시 경고 (기존) | 강한 경고 (기존) | **자동 차단 (본 PR)** | ENV 오버라이드 |
|------|------------------|-----------------|----------------------|----------------|
| `creditRate` | > 5% (⚠️) | > 8% (⚠️⚠️) | **≥ 12%** | `ENEMY_CREDIT_RATE_BLOCK` |
| `individualDominance` | > 70% (⚠️) | > 80% (⚠️⚠️) | **≥ 88%** | `ENEMY_INDIVIDUAL_BLOCK` |

자동 차단 임계는 **표시 ⚠️⚠️ 임계보다 4~8% 더 높은** 보수적 default — 표시 경고 단계(8%/80%)에서 운영자가 인지하고, 차단(12%/88%)은 *명백한* 위험에서만 발동. False positive 차단.

차단 조건: **OR** — 두 지표 중 하나라도 BLOCK 임계 이상이면 차단. 사용자 제안서의 "치명 항목 1개 이상" 정합.

### 2.2 결정 결과 schema

```ts
export interface EnemyAutoBlockDecision {
  shouldBlock: boolean;
  reason: string;        // BLOCK 임계 위반 사유 본문 (' / ' 결합)
  warnings: string[];    // BLOCK 미달이지만 ⚠️ 임계 통과 사유 (운영자 인지용)
  thresholds: {           // 평가에 사용된 임계값 (ENV 오버라이드 추적)
    creditRateBlock: number;
    individualBlock: number;
  };
}
```

`shouldBlock=true` 시 `reason` 본문이 `markBlocked` 의 `reason` 인자로 전달되어 `/signal_status` 에 표시.

### 2.3 평가 로직

```ts
evaluateEnemyAutoBlock(enemy: EnemyCheckResult | null, thresholds?): EnemyAutoBlockDecision
```

1. `enemy === null` 또는 `source === 'UNAVAILABLE'` → `shouldBlock: false` (데이터 부재 시 진입 허용 — KIS 일시 장애가 매매 차단 안 하도록).
2. `creditRate !== null && creditRate >= creditRateBlock` → `reason` 에 `신용잔고율 X.X% ≥ 12.0%` 추가.
3. `individualDominance !== null && individualDominance >= individualBlock` → `reason` 에 `개인 비중 X% ≥ 88%` 추가.
4. `creditRate >= creditRateWarn` 이지만 `< creditRateBlock` → `warnings` 에 `신용잔고율 X.X%` 추가 (차단 안 함).
5. `individualDominance >= individualWarn` 이지만 `< individualBlock` → `warnings` 추가.
6. `reason` 비어있으면 `shouldBlock: false`. 어느 하나라도 차있으면 `shouldBlock: true`.

NaN/Infinity/음수 입력은 `< 임계` 자연 처리 (안전 fallback).

### 2.4 ENV 회로 차단

| 변수 | 효과 | 기본값 |
|------|------|--------|
| `ENEMY_AUTO_BLOCK_DISABLED` | `'true'` 시 평가 skip — 항상 `shouldBlock: false` | (미설정 = 활성) |
| `ENEMY_CREDIT_RATE_BLOCK` | creditRate 차단 임계 | 12.0 |
| `ENEMY_CREDIT_RATE_WARN` | creditRate 경고 임계 | 8.0 |
| `ENEMY_INDIVIDUAL_BLOCK` | individualDominance 차단 임계 | 88.0 |
| `ENEMY_INDIVIDUAL_WARN` | individualDominance 경고 임계 | 80.0 |

운영 사고 발생 시 `ENEMY_AUTO_BLOCK_DISABLED=true` 즉시 비상 우회 가능. 운영 데이터 누적 후 임계는 ENV 로 단계적 조정.

## 3. wiring 위치

### 3.1 buyPipeline.ts (단일 진입점)

`fetchEnemyCheckData` 호출 직후 (line 312 부근, `Promise.all` 결과 received 후) `evaluateEnemyAutoBlock` 평가 → `shouldBlock=true` 시:

1. `console.warn` 진단 로그
2. `markBlocked({ id: signalId, gate: 'ENEMY', reason })` 호출 (signalId 있을 때만, try/catch 보호)
3. `approvalPromise: Promise.resolve('SKIP')` 반환 — 텔레그램 메시지 발송 자체 차단
4. `execute` 콜백이 `p.trade.status = 'REJECTED'` + `p.onRejected?.(p.trade, 'SKIP')` 처리

기존 enemyCheck 가 `requestBuyApproval` 에 전달되는 경로 그대로 유지 — 본 PR 이전엔 표시만 했고 본 PR 부터는 BLOCK 임계 미달이지만 WARN 임계 통과 시에도 동일하게 표시 + 차단 안 함.

### 3.2 ADR-0077 ENEMY BlockGate 정착

본 PR 이 ADR-0077 의 `'ENEMY'` BlockGate 첫 호출자. `/signal_status` 텔레그램 명령에서 `❌ 005930 삼성전자 — BLOCKED — ENEMY (신용잔고율 14.2% ≥ 12.0%)` 형식으로 표시.

## 4. 대안 검토

### A) 기존 정책 유지 (관찰만, 자동 차단 X)
- ✅ 회귀 위험 0
- ❌ 사용자 audit Gap 3 미해결
- ❌ ENEMY BlockGate 사용처 없음

### B) 사용자 제안 7 카테고리 모두 도입 (보호예수 / 대주주 / 공매도 / 목표가 / 실적)
- ✅ 사용자 의도 완전 충족
- ❌ 데이터 소스 미확보 (5개 카테고리 KIS 미제공) — DART/외부 API 인프라 신설 필요
- ❌ 회귀 위험 ↑
- → 후속 PR 분리 (데이터 소스 확장 인프라 별도 ADR)

### C) 본 ADR (수집 가능 2개 한정 자동 차단) ← 채택
- ✅ 즉시 효과 (이미 수집 중인 데이터 활용)
- ✅ 회귀 위험 격리 (기존 enemyCheck 호출 흐름 그대로)
- ✅ ADR-0077 ENEMY BlockGate 정착
- 비용: 인프라 +1 모듈, ENV 5개

## 5. 회귀 위험 분석

### 5.1 LIVE 매매 본체 무수정 보장

신규 모듈 (`enemyAutoBlock.ts`) 은 순수 함수만. `buyPipeline.ts` 에 추가되는 wiring 은 `Promise.all` 결과 처리 직후 분기 1개 (조건부 early return). 기존 `requestBuyApproval` / `placeKisOrder` / `execute` 콜백 본체 0줄 변경.

### 5.2 위험 시나리오

| 시나리오 | 보호장치 |
|----------|----------|
| `EnemyCheckResult` 데이터 부재 (KIS 일시 장애) | `source === 'UNAVAILABLE'` 또는 `null` → `shouldBlock: false` |
| 임계 ENV 잘못된 입력 (NaN, 음수) | `Number.isFinite + > 0` 가드 후 default fallback |
| `markBlocked` throw | try/catch 로 wrapping — 매매 결정 차단 안 함 (REJECTED 그대로 진행) |
| 사용자 보유 종목 신용잔고율 갑자기 폭증 | 본 PR scope 외 — `exitEngine` 의 별도 청산 규칙 영역 |
| False positive (정상 종목인데 단발성 신용 급등) | ENV 오버라이드로 임계 즉시 조정 + `ENEMY_AUTO_BLOCK_DISABLED=true` 비상 우회 |

### 5.3 운영 데이터 누적 후 조정 경로

본 PR 의 임계는 보수적 default — 운영 1~2주 누적 후 다음 데이터로 조정:
- BLOCKED 발생 빈도 (너무 많으면 임계 ↑)
- BLOCKED 종목의 사후 수익률 (BLOCK=올바른 결정인지 측정)
- WARN 단계만 통과한 종목의 사후 수익률 (8~12% 신용 구간이 진짜 위험한지)

추가 SSOT 모듈 변경 없이 ENV 1줄로 조정 가능.

## 6. 검증 체크리스트

- [ ] vitest `enemyAutoBlock.test.ts` ≥ 20 케이스 (임계 분기 / NaN-Infinity / OR 결합 / source UNAVAILABLE / ENV override / DISABLED 회로)
- [ ] vitest `buyPipeline.enemyBlock.test.ts` ≥ 5 케이스 (정상 통과 / BLOCK 자동 차단 / signalId 미전달 시 markBlocked skip / markBlocked throw 차단 안 함 / DISABLED 우회)
- [ ] lint(client + server tsc) + validate:all 8종 + ALLOW_DEPLOY_WINDOW=1 precommit 본체 통과
- [ ] LIVE 매매 본체 0줄 변경 검증 (`git diff --stat` 에 entryEngine / kisClient / autoTradeEngine 부재)
- [ ] ADR-0077 ENEMY BlockGate 첫 호출자 wiring 검증 (`/signal_status` 메시지에 ENEMY 표시)

## 7. 후속 PR (본 PR scope 밖)

- **사용자 제안 7 카테고리 데이터 소스 확장** — DART 보호예수 / 대주주 매도 / 공매도 잔고 / 목표가 컨센서스 / 실적 가이던스. 별도 ADR (데이터 소스 클라이언트 인프라).
- **운영 데이터 기반 임계 조정** — 본 PR default 의 1~2주 운영 후 false positive 비율 측정 + ENV 조정.
- **WARN 단계 사이즈 축소** — BLOCK 까진 안 되지만 WARN 통과 시 Kelly multiplier ×0.7 등 SizingDecider 분기. 별도 PR.
- **enemyAutoBlock 결과 영속** — TradeSignalRecord 의 `transitions[].reason` 에 `warnings[]` 병기 → `/signal_status` 에 경고 이력 노출. 본 PR 은 차단 시 reason 만 영속, warnings 는 텔레그램 메시지 전용.
