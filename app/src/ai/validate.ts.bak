/** 结构化输出校验：把模型 JSON 收敛成前端可依赖的数据，坏数据在这里被拦下。 */
import { AppError } from '../lib/errors';
import type { Article, ArticleWord, Question, QuestionType, SelectionPlan, WordPick } from '../types';

const QUESTION_TYPES: QuestionType[] = ['detail', 'main', 'inference', 'vocab', 'attitude', 'structure'];

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v.trim() : fallback;
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function clampIndex(v: unknown, max: number): number {
  const n = typeof v === 'number' ? Math.round(v) : Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n) || n < 0 || n >= max) return -1;
  return n;
}

export function validateSelection(raw: unknown, allowedWords: string[]): SelectionPlan {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const picks: WordPick[] = asArray<Record<string, unknown>>(obj.picks)
    .map((p) => ({
      word: asString(p.word).toLowerCase(),
      role: p.role === 'support' ? ('support' as const) : ('core' as const),
      reason: asString(p.reason),
    }))
    .filter((p) => p.word.length > 0);
  if (!picks.length) throw new AppError('parse', '选词结果为空，模型没有按要求返回 picks');

  const allowSet = new Set(allowedWords.map((w) => w.toLowerCase()));
  const known = new Set(picks.map((p) => p.word));
  const articles = asArray<Record<string, unknown>>(obj.articles)
    .map((a) => ({
      title: asString(a.title),
      angle: asString(a.angle),
      targetWords: asArray<string>(a.targetWords)
        .map((w) => asString(w).toLowerCase())
        .filter((w) => w.length > 0),
    }))
    .filter((a) => a.targetWords.length > 0);

  if (!articles.length) {
    // 退化：把核心词整体作为一篇文章的分配
    articles.push({
      title: asString(obj.title, 'Today’s Reading'),
      angle: asString(obj.summary, '根据今日单词组织的一篇精读'),
      targetWords: picks.filter((p) => p.role === 'core').map((p) => p.word),
    });
  }

  const count = Math.min(3, Math.max(1, Number(obj.articleCount) || articles.length));
  const out: SelectionPlan = {
    summary: asString(obj.summary, '按记忆状态与语义关联组织的今日精读'),
    picks,
    dropped: asArray<Record<string, unknown>>(obj.dropped)
      .map((d) => ({ word: asString(d.word).toLowerCase(), reason: asString(d.reason) }))
      .filter((d) => d.word),
    articles: articles.slice(0, count),
    articleCount: count,
  };
  // 记录 AI 是否给出了当天词表之外的词，方便 UI 提示（不阻断生成）
  const outside = out.picks.filter((p) => allowSet.size > 0 && !allowSet.has(p.word) && !known.has(p.word));
  if (outside.length === out.picks.length) {
    out.summary += '（注意：模型给出的词与当日词表匹配度较低）';
  }
  return out;
}

export interface ArticleDraft {
  title: string;
  subtitle?: string;
  paragraphs: string[];
  translation: string[];
  words: ArticleWord[];
}

export function validateArticle(raw: unknown): ArticleDraft {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const paragraphs = asArray<string>(obj.paragraphs).map((p) => asString(p)).filter(Boolean);
  if (paragraphs.length < 3) throw new AppError('parse', `正文段落不足（得到 ${paragraphs.length} 段）`);
  const translation = asArray<string>(obj.translation).map((t) => asString(t));
  const words = asArray<Record<string, unknown>>(obj.words)
    .map((w) => ({
      word: asString(w.word).toLowerCase(),
      surface: asString(w.surface) || asString(w.word),
      meaning: asString(w.meaning),
      inContext: asString(w.inContext),
      note: asString(w.note) || undefined,
    }))
    .filter((w) => w.word && w.meaning);
  return {
    title: asString(obj.title, 'Untitled Reading'),
    subtitle: asString(obj.subtitle) || undefined,
    paragraphs,
    translation,
    words,
  };
}

export function validateQuestions(raw: unknown, articleId: string): Question[] {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const list = asArray<Record<string, unknown>>(obj.questions);
  if (!list.length) throw new AppError('parse', '命题结果为空');
  const questions: Question[] = [];
  list.forEach((q, i) => {
    const options = asArray<string>(q.options).map((o) => asString(o));
    const answerIndex = clampIndex(q.answerIndex, options.length);
    if (options.length !== 4 || answerIndex < 0) return;
    const type = QUESTION_TYPES.includes(q.type as QuestionType) ? (q.type as QuestionType) : 'detail';
    questions.push({
      id: `${articleId}-q${i + 1}`,
      articleId,
      index: questions.length,
      type,
      stem: asString(q.stem),
      options,
      answerIndex,
      evidence: asString(q.evidence),
      explanation: asString(q.explanation),
    });
  });
  if (!questions.length) throw new AppError('parse', '没有一道题满足四选一 + 合法答案的要求');
  return questions.map((q, i) => ({ ...q, index: i, id: `${articleId}-q${i + 1}` }));
}

export interface QaReport {
  pass: boolean;
  notes: string[];
  coverageIssues: string[];
  questionIssues: { index: number; problem: string }[];
}

export function validateQa(raw: unknown): QaReport {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    pass: Boolean(obj.pass),
    notes: asArray<string>(obj.notes).map((n) => asString(n)).filter(Boolean).slice(0, 6),
    coverageIssues: asArray<string>(obj.coverageIssues).map((n) => asString(n).toLowerCase()).filter(Boolean),
    questionIssues: asArray<Record<string, unknown>>(obj.questionIssues)
      .map((q) => ({ index: Number(q.index) || 0, problem: asString(q.problem) }))
      .filter((q) => q.problem),
  };
}

export interface RepairResult {
  fixes: { index: number; evidence: string; explanation: string }[];
}

export function validateRepairs(raw: unknown): RepairResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  return {
    fixes: asArray<Record<string, unknown>>(obj.fixes)
      .map((f) => ({
        index: Number(f.index) || 0,
        evidence: asString(f.evidence),
        explanation: asString(f.explanation),
      }))
      .filter((f) => f.index >= 0),
  };
}

export function buildArticle(
  draft: ArticleDraft,
  meta: Omit<Article, 'title' | 'subtitle' | 'paragraphs' | 'translation' | 'words' | 'wordCount' | 'readMinutes'>,
  wordCount: number,
  readMinutes: number,
): Article {
  return {
    ...meta,
    title: draft.title,
    subtitle: draft.subtitle,
    paragraphs: draft.paragraphs,
    translation: draft.translation,
    words: draft.words,
    wordCount,
    readMinutes,
  };
}
