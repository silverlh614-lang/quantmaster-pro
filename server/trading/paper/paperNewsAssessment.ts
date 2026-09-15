// @responsibility Assess disclosure headline direction for independent Shadow research.
import type { PaperNewsAssessment, PaperNewsObservation } from '../../../src/types/paperExperiment.js';
import { PAPER_NEWS_VERSION } from '../../../src/utils/paperNews.js';

type Rule = [RegExp, string];
const positive: Rule[] = [
  [/흑자\s*전환/, '흑자 전환'],
  [/(?:영업|순)이익\s*(?:이\s*)?(?:증가(?!율|세)|급증|개선|최대|신기록)/, '이익 증가'],
  [/(?:사상\s*)?최대\s*실적|실적\s*서프라이즈/, '실적 개선'],
  [/적자\s*(?:폭\s*)?(?:축소|감소)/, '적자 축소'],
  [/(?:대규모\s*)?수주\s*(?:계약|성공|확정)|대규모\s*수주/, '수주'],
  [/(?:단일판매|공급|수출|판매).{0,12}계약\s*체결/, '판매·공급 계약 체결'],
  [/(?:자기\s*주식|자사주)\s*(?:취득|소각)|주식\s*소각\s*결정/, '자사주 취득·소각'],
  [/(?:배당금|주당\s*배당)\s*(?:증가|확대|인상)/, '배당 확대'],
  [/임상\s*(?:\d\s*상\s*)?성공|(?:신약|품목)\s*(?:허가|승인)\s*(?:획득|완료)/, '임상·허가 진전'],
];
const negative: Rule[] = [
  [/상장\s*폐지/, '상장 폐지'],
  [/(?:영업|순)이익\s*(?:이\s*)?(?:감소|급감|하락)/, '이익 감소'],
  [/적자\s*(?:전환|확대|지속)|손실\s*(?:확대|발생)/, '적자·손실'],
  [/(?:판매|공급|수출|수주).{0,12}계약\s*(?:해지|취소)|계약\s*(?:해지|취소)/, '계약 해지·취소'],
  [/부도\s*(?:발생)?|파산\s*(?:신청|선고)|회생\s*절차\s*(?:개시|신청)/, '지급 능력 위험'],
  [/횡령|배임/, '횡령·배임'],
  [/감사\s*의견\s*(?:거절|부적정)|관리\s*종목\s*지정/, '감사·상장 유지 위험'],
  [/임상\s*(?:\d\s*상\s*)?(?:실패|중단)|(?:품목|신약)\s*(?:허가|승인)\s*(?:취소|거절)/, '임상·허가 차질'],
];

export function assessPaperNews(item: Pick<PaperNewsObservation, 'headline' | 'source' | 'observedAt'>, assessedAt: string): PaperNewsAssessment {
  const result = (direction: PaperNewsAssessment['direction'], reason: string): PaperNewsAssessment => ({
    version: PAPER_NEWS_VERSION, method: 'DISCLOSURE_TITLE_RULES', assessedAt, direction, reason,
  });
  if (!(Date.parse(item.observedAt) <= Date.parse(assessedAt))) return result('UNKNOWN', '관측·평가 시각 확인 불가');
  if (item.source !== 'DART') return result('UNKNOWN', '간접 공급망·시장 자료로 해당 종목의 호악재를 확정할 수 없음');
  const title = typeof item.headline === 'string'
    ? item.headline.normalize('NFKC').replace(/[·ㆍ()\[\]]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!title) return result('UNKNOWN', '평가할 공시 제목 없음');
  if (/정정|철회|부인|사실\s*무근|해명|미확정|미정|검토|추진|루머|설에\s*대한|아니|않|없|불발|예정|해소|해제|취하/.test(title)
    || /(?:상장\s*폐지|관리\s*종목|파산).{0,12}취소|(?:자사주|자기\s*주식).{0,12}신탁.{0,8}해지/.test(title)) {
    return result('UNKNOWN', '정정·부정·미확정 표현은 원문 확인 필요');
  }
  const pos = positive.filter(([pattern]) => pattern.test(title)).map(([, reason]) => reason);
  const neg = negative.filter(([pattern]) => pattern.test(title)).map(([, reason]) => reason);
  if (pos.length && neg.length) return result('MIXED', `제목에 호재·악재 동시 관측: ${[...pos, ...neg].join(', ')}`);
  if (neg.length) return result('NEGATIVE', `공시 제목 단서: ${neg.join(', ')} · 주가 영향 미검증`);
  if (pos.length) return result('POSITIVE', `공시 제목 단서: ${pos.join(', ')} · 주가 영향 미검증`);
  if (/^(?:정기|임시)?주주총회\s*(?:결과|소집공고)$|^주식명의개서정지\s*주주명부폐쇄$/.test(title)) {
    return result('NEUTRAL', '주주총회·명의개서 행정 공시 제목');
  }
  return result('UNKNOWN', '제목만으로 방향 판단 불가 · 실적·계약 규모·조건 등 원문 확인 필요');
}
