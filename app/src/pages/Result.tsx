import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../lib/router';
import { useApp } from '../state/store';
import { idb } from '../lib/db';
import { letter, relativeTime } from '../lib/format';
import { locateEvidence, tokenize } from '../lib/text';
import type { Article, Question, QuizAttempt } from '../types';

function Evidence({ article, question }: { article: Article; question: Question }) {
  const hit = useMemo(() => locateEvidence(article.paragraphs, question.evidence), [article, question]);
  if (!hit) {
    return <p className="evidence evidence--missing">原文依据：{question.evidence || '（模型没有给出可定位的句子）'}</p>;
  }
  const tokens = tokenize(article.paragraphs[hit.paragraphIndex]);
  return (
    <div className="evidence">
      <div className="evidence__label">原文依据 · 第 {hit.paragraphIndex + 1} 段</div>
      <p className="evidence__text">
        {tokens.map((t, i) => (
          <span key={i} className={t.type === 'word' ? 'evidence__w' : undefined}>
            {t.text}
          </span>
        ))}
      </p>
      <p className="evidence__quote">“{question.evidence}”</p>
    </div>
  );
}

export default function Result({ articleId }: { articleId: string }) {
  const { notify } = useApp();
  const [article, setArticle] = useState<Article | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);

  useEffect(() => {
    void (async () => {
      const a = await idb.get<Article>('articles', articleId);
      setArticle(a ?? null);
      const qs = (await idb.all<Question>('questions'))
        .filter((q) => q.articleId === articleId)
        .sort((x, y) => x.index - y.index);
      setQuestions(qs);
      const attempts = (await idb.all<QuizAttempt>('attempts'))
        .filter((x) => x.articleId === articleId)
        .sort((x, y) => y.createdAt - x.createdAt);
      setAttempt(attempts[0] ?? null);
    })();
  }, [articleId]);

  if (!article || !attempt) {
    return (
      <div className="page page--narrow">
        <h1 className="h1">还没交卷</h1>
        <p className="lede">先去完成这一篇的题目，交卷后会显示分数、解析和原文依据。</p>
        <button type="button" className="btn btn--ghost" onClick={() => navigate(`quiz/${articleId}`)}>
          去做题
        </button>
      </div>
    );
  }

  const score = attempt.score;
  const total = attempt.total;
  const ratio = total ? score / total : 0;
  const band = ratio >= 0.8 ? '很稳' : ratio >= 0.6 ? '及格线以上' : '需要再看一遍';

  const retry = async () => {
    notify('重新开始练习，这一次不计入历史成绩', 'ok');
    navigate(`quiz/${articleId}`);
  };

  return (
    <div className="result">
      <header className="result__head">
        <p className="eyebrow">{article.exam.toUpperCase()} · 交卷于 {relativeTime(attempt.createdAt)}</p>
        <h1 className="result__score">
          {score}
          <span>/ {total}</span>
        </h1>
        <p className="result__band">{band}</p>
        <div className="result__bar">
          <div className="result__bar-fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <div className="result__actions">
          <button type="button" className="btn btn--ghost" onClick={retry}>
            重新练习
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => navigate(`read/${article.id}`)}>
            回文章
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => navigate('generate')}>
            再生成一篇
          </button>
        </div>
      </header>

      <ol className="review">
        {questions.map((q, i) => {
          const picked = attempt.answers[i];
          const correct = picked === q.answerIndex;
          return (
            <li className={`rcard ${correct ? 'is-correct' : 'is-wrong'}`} key={q.id}>
              <div className="rcard__head">
                <span className="rcard__no">{String(i + 1).padStart(2, '0')}</span>
                <span className={`rcard__flag ${correct ? 'ok' : 'bad'}`}>{correct ? '正确' : '错误'}</span>
                <span className="meta">
                  你选 {picked === null ? '—' : letter(picked)} · 答案 {letter(q.answerIndex)}
                </span>
              </div>
              <p className="rcard__stem">{q.stem}</p>
              <div className="rcard__options">
                {q.options.map((opt, oi) => {
                  const isAnswer = oi === q.answerIndex;
                  const isPicked = oi === picked;
                  return (
                    <div
                      key={oi}
                      className={`ropt ${isAnswer ? 'is-answer' : ''} ${isPicked && !isAnswer ? 'is-picked-wrong' : ''}`}
                    >
                      <span className="ropt__key">{letter(oi)}</span>
                      <span>{opt}</span>
                    </div>
                  );
                })}
              </div>
              <p className="rcard__explain">{q.explanation}</p>
              <Evidence article={article} question={q} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
