// @responsibility localRag 서버 모듈
/**
 * localRag.ts — 로컬 임베딩 RAG (Idea 11)
 *
 * 프로젝트 페르소나·전략 텍스트를 1회 임베딩하여 종목 설명/매도 논리/리스크
 * 조언을 Gemini 호출 없이 유사도 검색 + 템플릿 조립으로 생성한다.
 *
 * 비용 모델:
 *   - 초기 임베딩: 20개 청크 × 평균 500토큰 = 10K 토큰 1회 (~$0.0003)
 *   - 런타임 쿼리: 임베딩 1회 + 코사인 유사도 (Gemini 호출 0)
 *
 * 의존성: @google/genai (이미 설치) — text-embedding-004 모델 사용.
 *         외부 vector store(sqlite-vec 등) 없이 메모리 + JSON 파일로 충분
 *         (지식 청크 ≤ 200개 가정).
 *
 * 디렉토리:
 *   data/knowledge/*.txt        — 사용자가 업로드하는 페르소나/전략/리포트 원본
 *   data/rag-embeddings.json    — 임베딩 캐시 (텍스트 해시 → 벡터 매핑)
 *
 * API:
 *   - buildIndex()              : *.txt 스캔 + 신규/변경 청크만 임베딩
 *   - queryRag(query, k=3)      : 상위 k개 관련 청크 반환
 *   - generateAdvice(topic)     : 템플릿 조립 결과 (Gemini 호출 없음)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATA_DIR, ensureDataDir } from '../persistence/paths.js';
import { getGeminiClient, isBudgetBlocked } from '../clients/geminiClient.js';

const KNOWLEDGE_DIR = path.join(DATA_DIR, 'knowledge');
const EMBEDDINGS_FILE = path.join(DATA_DIR, 'rag-embeddings.json');
const EMBEDDING_MODEL = 'text-embedding-004';
const EMBEDDING_DIM = 768;
const CHUNK_MAX_CHARS = 1200;       // 한 청크 최대 길이 (토큰 ≈ chars/2 가정)
const CHUNK_OVERLAP_CHARS = 100;    // 의미 연속성 보장용 오버랩

interface RagChunk {
  id: string;            // sha256(content) 첫 16자 — 청크 고유 식별
  source: string;        // 원본 파일명 (예: 'persona.txt')
  content: string;       // 청크 텍스트
  embedding: number[];   // 768차원 벡터
}

interface EmbeddingsStore {
  builtAt: string;
  model: string;
  chunks: RagChunk[];
}

let _store: EmbeddingsStore | null = null;

function loadStore(): EmbeddingsStore {
  if (_store) return _store;
  ensureDataDir();
  if (!fs.existsSync(EMBEDDINGS_FILE)) {
    return (_store = { builtAt: '', model: EMBEDDING_MODEL, chunks: [] });
  }
  try {
    _store = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE, 'utf-8')) as EmbeddingsStore;
    return _store;
  } catch (e) {
    console.warn('[LocalRag] 임베딩 로드 실패 — 빈 상태로 시작:', e instanceof Error ? e.message : e);
    return (_store = { builtAt: '', model: EMBEDDING_MODEL, chunks: [] });
  }
}

function saveStore(store: EmbeddingsStore): void {
  ensureDataDir();
  fs.writeFileSync(EMBEDDINGS_FILE, JSON.stringify(store));
}

function hashId(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function chunkText(content: string): string[] {
  const trimmed = content.trim();
  if (trimmed.length <= CHUNK_MAX_CHARS) return [trimmed];
  const out: string[] = [];
  let cursor = 0;
  while (cursor < trimmed.length) {
    const end = Math.min(cursor + CHUNK_MAX_CHARS, trimmed.length);
    out.push(trimmed.slice(cursor, end));
    if (end >= trimmed.length) break;
    cursor = end - CHUNK_OVERLAP_CHARS;
  }
  return out;
}

interface EmbedContentResponse {
  embedding?: { values?: number[] };
  embeddings?: Array<{ values?: number[] }>;
}

async function embedSingle(text: string): Promise<number[] | null> {
  const ai = getGeminiClient();
  if (!ai) return null;
  if (isBudgetBlocked()) {
    console.warn('[LocalRag] 예산 차단 — 임베딩 생략');
    return null;
  }
  try {
    // @google/genai SDK 시그니처: ai.models.embedContent({ model, contents })
    const res = await (ai.models as unknown as {
      embedContent: (args: { model: string; contents: string }) => Promise<EmbedContentResponse>;
    }).embedContent({ model: EMBEDDING_MODEL, contents: text });
    const vec = res.embedding?.values ?? res.embeddings?.[0]?.values;
    if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIM) {
      console.warn('[LocalRag] 임베딩 응답 형식 오류 — 차원:', vec?.length);
      return null;
    }
    return vec;
  } catch (e) {
    console.error('[LocalRag] 임베딩 실패:', e instanceof Error ? e.message : e);
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/**
 * data/knowledge/*.txt 를 스캔하여 신규/변경 청크만 증분 임베딩.
 * 반환: { added, total } — added=신규 임베딩 수, total=전체 청크 수.
 */
export async function buildRagIndex(): Promise<{ added: number; total: number; skipped: number }> {
  ensureDataDir();
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    console.log(`[LocalRag] knowledge/ 디렉토리 생성. *.txt 파일 추가 후 다시 호출하세요.`);
    return { added: 0, total: 0, skipped: 0 };
  }
  const files = fs.readdirSync(KNOWLEDGE_DIR).filter((f) => f.endsWith('.txt'));
  if (files.length === 0) {
    console.log('[LocalRag] knowledge/*.txt 파일 없음 — 인덱스 비어있음');
    return { added: 0, total: 0, skipped: 0 };
  }
  const store = loadStore();
  const existingIds = new Set(store.chunks.map((c) => c.id));
  let added = 0, skipped = 0;

  for (const file of files) {
    const content = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf-8');
    const chunks = chunkText(content);
    for (const chunk of chunks) {
      const id = hashId(chunk);
      if (existingIds.has(id)) { skipped++; continue; }
      const embedding = await embedSingle(chunk);
      if (!embedding) {
        console.warn(`[LocalRag] ${file} 청크 임베딩 실패 — 건너뜀`);
        continue;
      }
      store.chunks.push({ id, source: file, content: chunk, embedding });
      existingIds.add(id);
      added++;
      // 과다 호출 방지 — 청크 간 50ms
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  store.builtAt = new Date().toISOString();
  saveStore(store);
  console.log(`[LocalRag] 인덱스 빌드 완료 — 신규 ${added}, 스킵 ${skipped}, 전체 ${store.chunks.length}`);
  return { added, total: store.chunks.length, skipped };
}

/**
 * 쿼리 텍스트와 가장 유사한 상위 k개 청크 반환.
 * 인덱스가 비어있거나 임베딩 실패 시 빈 배열 — 호출자가 폴백 책임.
 */
export async function queryRag(query: string, k = 3): Promise<Array<{ chunk: RagChunk; score: number }>> {
  const store = loadStore();
  if (store.chunks.length === 0) return [];
  const qVec = await embedSingle(query);
  if (!qVec) return [];
  const scored = store.chunks
    .map((c) => ({ chunk: c, score: cosineSimilarity(qVec, c.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  return scored;
}

/**
 * 템플릿 조립으로 자연어 조언 생성 — Gemini 호출 없음.
 * topic 예: "삼성전자 매수 사유", "VKOSPI 25 돌파 시 대응", "에코프로 패턴 위험"
 *
 * 반환 형식: 페르소나 톤 유지 마크다운.
 *   - RAG 히트가 있으면 발췌 + 요약 템플릿
 *   - 히트가 없으면 (인덱스 비어있거나 유사도 < 0.4) 빈 문자열 → 호출자가 다른 경로 시도
 */
export async function generateAdvice(topic: string): Promise<string> {
  const hits = await queryRag(topic, 3);
  if (hits.length === 0 || hits[0].score < 0.4) return '';
  const lines: string[] = [`### ${topic}`, ''];
  for (const { chunk, score } of hits) {
    const snippet = chunk.content.length > 300 ? chunk.content.slice(0, 300) + '…' : chunk.content;
    lines.push(`> ${snippet.replace(/\n+/g, ' ')}`);
    lines.push(`> — *${chunk.source} (유사도 ${(score * 100).toFixed(0)}%)*`);
    lines.push('');
  }
  return lines.join('\n');
}

/** 디버깅/테스트용 — 인덱스 통계 */
export function getRagStats(): { builtAt: string; model: string; chunkCount: number; sources: string[] } {
  const store = loadStore();
  const sources = Array.from(new Set(store.chunks.map((c) => c.source)));
  return { builtAt: store.builtAt, model: store.model, chunkCount: store.chunks.length, sources };
}

/** 테스트용 — 메모리 캐시 초기화 */
export function resetRagMemory(): void { _store = null; }
