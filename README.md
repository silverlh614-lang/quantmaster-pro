<div align="center">

# QuantMaster Pro 🚀
**AI 기반 한국 주식 퀀트 분석 시스템**



![Node.js](https://img.shields.io/badge/Node.js-18+-green)




![React](https://img.shields.io/badge/React-19-blue)




![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)




![License](https://img.shields.io/badge/License-Private-red)



</div>

---

> **본 정보는 AI 분석 결과이며 투자 권유가 아닙니다. 모든 투자의 책임은 본인에게 있습니다.**

---

## 이 시스템이 뭔가요?

Gemini AI + Yahoo Finance + DART + KIS 실시간 데이터를 결합한 한국 주식 퀀트 분석 도구입니다.

단순한 종목 추천이 아닙니다. **27개 체크리스트 + 3단계 Gate 필터**를 통과한 종목만 추천하며, 실제 과거 데이터로 백테스트까지 가능합니다.
일반 투자 앱   →  "이 종목 사세요"
QuantMaster   →  "27개 조건 중 25개 통과, Gate 3 도달,
확신도 87점, 분할매수 3단계 플랜"
---

## 데이터 소스

| 소스 | 용도 | 방식 |
|------|------|------|
| Google Gemini AI | 종목 선별, 정성 분석 | AI 추론 |
| Yahoo Finance | 실시간 가격, 기술지표 9개 | 실계산 |
| DART 전자공시 | ROE, OCF, 이자보상배율 | 실계산 |
| KIS 한국투자증권 | 외국인/기관 수급, 공매도 | 실계산 |

**27개 조건 중 13개 실데이터 기반 실계산 (48%)**

---

## 주요 기능

- **3-Gate 퀀트 필터** — 27개 조건, Gate 1/2/3 단계별 검증
- **기술적 지표 실계산** — RSI, MACD, 볼린저밴드, Stochastic, Ichimoku, VCP, 이격도
- **DART 재무 연동** — 분기 재무제표 실시간 파싱
- **KIS 수급 연동** — 외국인/기관 5일 순매수, P+A 동반매수 감지
- **백테스트** — 수수료/슬리피지/세금 반영 실데이터 시뮬레이션
- **Kelly Criterion** — 확신도 기반 포지션 사이징
- **관심종목 트래킹** — 추가 시점 가격 대비 등락 자동 표시
- **8개 분석 탭** — DISCOVER / WATCHLIST / SCREENER / BACKTEST / MARKET / WALK_FORWARD / SUBSCRIPTION / MANUAL_INPUT

---

## 시작하기

### 1. 필수 조건

- Node.js 18 이상
- Gemini API Key ([발급](https://aistudio.google.com/app/apikey))
- DART API Key ([발급](https://opendart.fss.or.kr))
- KIS API Key ([발급](https://apiportal.koreainvestment.com)) — 한국투자증권 계좌 필요

### 2. 설치

```bash
git clone https://github.com/your-repo/quantmaster-pro.git
cd quantmaster-pro
npm install
3. 환경변수 설정
cp .env.example .env
.env 파일에 키 입력:
GEMINI_API_KEY=발급받은키
DART_API_KEY=발급받은키
KIS_APP_KEY=발급받은키
KIS_APP_SECRET=발급받은키
KIS_IS_REAL=true
EMAIL_USER=gmail주소 (선택)
EMAIL_PASS=앱비밀번호 (선택)
4. 실행
npm run dev
브라우저에서 http://localhost:3000 접속
권장 사용 패턴
오후 3:30 장마감
    ↓
오후 4:00 DISCOVER 탭에서 검색 실행
    ↓
Gate 3 통과 종목 관심목록 추가
    ↓
다음날 오전 9:00 WATCHLIST 확인
    ↓
추가 시점 대비 등락 확인 후 진입 판단
3-Gate 시스템
Gate 1 — 생존 필터 (5개, 전부 통과 필수)
  주도주 사이클 / ROE 유형3 / Risk-On 환경
  기계적 손절 / 신규 주도주 여부

Gate 2 — 성장 검증 (12개 중 9개 이상)
  수급 질 / Ichimoku / 기관 수급 / 거래량
  목표가 여력 / 실적 서프라이즈 등

Gate 3 — 정밀 타이밍 (10개 중 7개 이상)
  VCP 패턴 / 다이버전스 / 이자보상배율
  터틀 돌파 / 피보나치 등
주의사항
본 시스템은 개인 투자 연구 목적으로 제작되었습니다
AI 분석 결과는 추정값이며 정확성을 보장하지 않습니다
투자로 인한 손실에 대해 어떠한 책임도 지지 않습니다
KIS API는 한국투자증권 실전 계좌가 필요합니다
로컬 환경(npm run dev)에서만 외부 API가 정상 작동합니다
