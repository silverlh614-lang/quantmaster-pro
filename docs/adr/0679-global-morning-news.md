# ADR-0679: CH3 해외 뉴스 브리핑과 국내 연관주

@responsibility Keep sourced overseas news and sector hypotheses separate from execution and existing observation ledgers.

## Status

Accepted

## Decision

- 사용자가 기존 분류 봇에 해외 뉴스 수집·발송과 연관주 설명을 요청했다. 기존 Telegram CH3 INFO의 거래일 08:45 보고를 해외 뉴스·국내 연관주 요약으로 바꾼다. 추가 정기 알림·기사별 발송은 만들지 않으며 기존 `paper:morning:거래일` 원장의 중복 방지·재시도·09:30 만료를 재사용한다.
- 기존 국내 공시·수급 기록에는 해외 기사 URL·발행시각이 없다. BBC 경제·국제, CNBC 주요 뉴스, 미 연준 정책·연설의 고정 RSS 5개를 30분마다 병렬 수집한다. 출처별 10초·750KB 제한, 임의 URL/외부 엔티티 차단, 발행·최초 확인 시각 보존, 14일·2,000건 상한과 원자 저장을 적용한다. 출처 오류와 기사 없음은 구분한다.
- 직전 KRX 거래일 15:30부터 당일 08:30까지 발행된 기사 중 중요 사건을 3~5개 선정한다. 주말·한국 휴장일을 포함하고 부족한 사건 수를 꾸며 채우지 않는다. URL·유사 제목 중복을 제거하고 AI에 사건 중복 제거와 주제 분산을 요청한다. 공개 RSS의 제목·발췌 범위이며 전문 검증·완전한 해외 뉴스 전수 수집으로 표현하지 않는다.
- 중앙 Gemini 클라이언트가 제공된 기사 ID·제목·발췌만 한국어로 요약한다. 외부 검색·자유 생성 링크·종목은 사용하지 않고 ID·문자 수·방향 라벨·출처에 없는 숫자를 검증한다. 25초 이내 미완료/검증 실패 시 출처 제목과 방향 미확인으로 대체한다. AI 해석은 사실 확정으로 표시하지 않는다.
- 국내 연관주는 검증된 사업 소개를 가진 7개 기업의 제한된 키워드 사전으로 최대 2개 연결한다. 제목·발췌의 기업 언급과 업종 연관 추정을 구분하고 원가·수요·경쟁·조달 등 확인할 이유를 표시한다. 자동 계약/고객사 관계를 생성하지 않고 근거 없는 종목은 제시하지 않는다. 적용 범위를 늘릴 때 사업 출처와 매핑 테스트를 함께 추가한다.
- 기존 `paper_bot` 매분 작업은 비동기 수집을 시작만 하며 관측·가상매매·건강 알림을 기다리게 하지 않는다. 08:30부터 일자별 보고를 준비·저장한다. 재기동 후 재사용하며 늦은 시작은 08:50에 확인된 원문/장애 상태로 보고한다. `/api/shadow/morning-report`는 저장 자료 미리보기이며 수집·AI·Telegram 발송을 일으키지 않는다.
- 브리핑은 정보 전달 전용이다. SourceSnapshot, 기본 관측·전략 학습 원장, 매수 조건·실주문 경로에 연결하지 않는다. 기존 국내 공시 수집과 관측은 계속 유지한다.

## Evidence, validation and rollback

- [BBC 경제 RSS](https://feeds.bbci.co.uk/news/business/rss.xml), [BBC 국제 RSS](https://feeds.bbci.co.uk/news/world/rss.xml), [CNBC 주요 뉴스 RSS](https://www.cnbc.com/id/100003114/device/rss/rss.html), [미 연준 RSS 안내](https://www.federalreserve.gov/feeds/feeds.htm).
- 기업 사업 근거 URL은 `globalNewsBriefing.ts`의 종목 연결 사전에 보존하고 미리보기에도 노출한다. 가격·수급 데이터는 이 뉴스 출처에서 만들지 않는다.
- 휴일·주말·시각 경계, RSS 오류·허용 URL·중복, AI 응답 검증·시간 상한, 기업 언급/업종 추정, 캐시 손상·재기동·중복 작업, CH3 발송·기존 원장 재시도·읽기 전용 API를 검증한다.
- 복구 시 `paperBot.ts`의 배경 갱신과 morning 콜백을 제거하면 기존 준비 요약으로 돌아간다. 뉴스 캐시와 기존 Telegram/관측/거래 원장은 삭제하지 않는다.
