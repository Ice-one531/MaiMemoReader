import { describe, expect, it } from 'vitest';
import { validateArticle, validateQuestions, validateSelection, validateQa } from '../src/ai/validate';
import { AppError } from '../src/lib/errors';

const words = ['sustain', 'undermine', 'subtle', 'reclaim'];

describe('validateSelection', () => {
  it('缺 articles 时用核心词退化生成一篇', () => {
    const plan = validateSelection(
      {
        summary: '围绕注意力组织',
        picks: [
          { word: 'Sustain', role: 'core', reason: '高频' },
          { word: 'subtle', role: 'support', reason: '修饰' },
        ],
      },
      words,
    );
    expect(plan.articles).toHaveLength(1);
    expect(plan.articles[0].targetWords).toEqual(['sustain']);
    expect(plan.articleCount).toBe(1);
  });

  it('picks 为空时抛出可解释的解析错误', () => {
    expect(() => validateSelection({}, words)).toThrow(AppError);
  });

  it('限制文章数不超过 3 篇', () => {
    const plan = validateSelection(
      {
        picks: [{ word: 'sustain', role: 'core', reason: 'x' }],
        articles: [
          { title: 'a', angle: 'a', targetWords: ['sustain'] },
          { title: 'b', angle: 'b', targetWords: ['subtle'] },
          { title: 'c', angle: 'c', targetWords: ['reclaim'] },
          { title: 'd', angle: 'd', targetWords: ['undermine'] },
        ],
        articleCount: 4,
      },
      words,
    );
    expect(plan.articles).toHaveLength(3);
  });
});

describe('validateArticle', () => {
  it('段落少于 3 段视为无效', () => {
    expect(() => validateArticle({ paragraphs: ['one', 'two'] })).toThrow(AppError);
  });

  it('提取正文、译文与词表', () => {
    const draft = validateArticle({
      title: 'Test',
      paragraphs: ['A '.repeat(30), 'B '.repeat(30), 'C '.repeat(30)],
      translation: ['甲', '乙', '丙'],
      words: [{ word: 'Sustain', surface: 'sustaining', meaning: '维持', inContext: 'x' }],
    });
    expect(draft.title).toBe('Test');
    expect(draft.words[0].word).toBe('sustain');
    expect(draft.words[0].surface).toBe('sustaining');
  });
});

describe('validateQuestions', () => {
  it('丢弃选项数不为 4 或答案越界的题', () => {
    const qs = validateQuestions(
      {
        questions: [
          { stem: 'ok', options: ['a', 'b', 'c', 'd'], answerIndex: 2, evidence: 'x', explanation: 'y' },
          { stem: 'bad', options: ['a', 'b', 'c'], answerIndex: 0 },
          { stem: 'bad2', options: ['a', 'b', 'c', 'd'], answerIndex: 9 },
        ],
      },
      'a1',
    );
    expect(qs).toHaveLength(1);
    expect(qs[0].answerIndex).toBe(2);
    expect(qs[0].id).toBe('a1-q1');
  });

  it('全部不合格时抛错', () => {
    expect(() => validateQuestions({ questions: [] }, 'a1')).toThrow(AppError);
  });
});

describe('validateQa', () => {
  it('归一化质检报告字段', () => {
    const report = validateQa({ pass: false, notes: ['译文有漏'], coverageIssues: ['Subtle'], questionIssues: [{ index: 1, problem: '依据不匹配' }] });
    expect(report.notes).toHaveLength(1);
    expect(report.coverageIssues[0]).toBe('subtle');
    expect(report.questionIssues[0].index).toBe(1);
  });
});
