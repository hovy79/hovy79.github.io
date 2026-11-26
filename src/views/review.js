/**
 * 薄弱点中心：汇总「需复习 / 错题」的题目与知识点，并提供跳回知识库的入口。
 *
 * 这是把「刷题」与「知识库」真正连起来的一页：
 * 错题 → 对应知识点 → 原理与例题 → 回到题目重做。
 *
 * 本轮修正：统计口径改为按分区隔离。旧版此处用全库 stats()，
 * 于是「嵌入式薄弱点」页顶部的数字里混进了硬件的数据——数字对不上当时列表里的条目。
 */

import { escapeHtml } from '../core/markdown.js';
import {
  badge,
  difficultyDots,
  emptyState,
  masteryBadge,
  sectionHeading,
  statCard,
  verifiedBadge
} from './components.js';

export function renderReview(ctx) {
  const { repo, progress, activeDomain } = ctx;

  const domainQuestions = repo.listQuestions({ domain: activeDomain });
  const domainKnowledge = repo.listKnowledge({ domain: activeDomain });

  // 分区口径：只统计本分区内的 id
  const domainIds = new Set([
    ...domainQuestions.map((q) => q.id),
    ...domainKnowledge.map((k) => k.id)
  ]);
  const stats = progress.stats({ ids: domainIds });

  const flaggedQuestions = domainQuestions
    .filter((q) => {
      const state = progress.getMastery(q.id);
      const ans = progress.getAnswer(q.id);
      return state === 'review' || state === 'wrong' || ans?.correct === false;
    })
    // 错得最多的排前面：复习顺序应该由「最需要补」决定，而不是题库顺序
    .sort((a, b) => {
      const wa = progress.getAnswer(a.id)?.attempts ?? 0;
      const wb = progress.getAnswer(b.id)?.attempts ?? 0;
      return wb - wa;
    });

  const flaggedKnowledge = domainKnowledge.filter((k) => {
    const state = progress.getMastery(k.id);
    return state === 'review' || state === 'wrong';
  });

  // 由薄弱题目反推出的知识点（去重）
  const weakKnowledgeIds = new Set();
  for (const q of flaggedQuestions) {
    for (const kid of q.knowledge_refs) weakKnowledgeIds.add(kid);
  }
  const weakFromQuestions = [...weakKnowledgeIds]
    .map((id) => repo.knowledgeItem(id))
    .filter(Boolean);

  const allWeakKnowledge = dedupeById([...flaggedKnowledge, ...weakFromQuestions]);

  const domain = repo.domain(activeDomain);

  // 一键重练错题：把实际抽到的题 id 冻结进 URL，作答过程中序列不会变
  const wrongPool = flaggedQuestions.length
    ? repo.listQuestions({ domain: activeDomain }).filter((q) => {
        const st = progress.getMastery(q.id);
        const ans = progress.getAnswer(q.id);
        return st === 'wrong' || st === 'review' || ans?.correct === false;
      })
    : [];
  const retrySet = wrongPool.slice(0, 20).map((q) => q.id);
  const retryWrongHref = retrySet.length
    ? `#/drill?${new URLSearchParams({
        domain: activeDomain,
        n: String(retrySet.length),
        set: retrySet.join(',')
      }).toString()}`
    : '';

  return `
  <section class="panel">
    <div class="panel__head">
      ${sectionHeading(`${domain?.label ?? ''}薄弱点`, flaggedQuestions.length + allWeakKnowledge.length)}
      <div class="panel__tools">
        <a class="btn btn--ghost" href="#/drill?domain=${encodeURIComponent(activeDomain)}">去刷题</a>
        <a class="btn btn--ghost" href="#/kb?domain=${encodeURIComponent(activeDomain)}">去知识库</a>
      </div>
    </div>

    <div class="statgrid">
      ${statCard(stats.mastery.mastered, '已掌握', 'ok')}
      ${statCard(stats.mastery.review, '需复习', 'warn')}
      ${statCard(stats.mastery.wrong, '错题', 'bad')}
      ${statCard(stats.accuracy === null ? '—' : `${Math.round(stats.accuracy * 100)}%`, '本分区正确率')}
    </div>
    <p class="hint">以上数字只统计「${escapeHtml(domain?.label ?? '')}」分区的条目，与下方列表口径一致。</p>

    ${
      flaggedQuestions.length && retryWrongHref
        ? `<div class="reviewbar">
            <span>共 ${flaggedQuestions.length} 道待重做</span>
            <a class="btn btn--primary btn--sm" href="${retryWrongHref}">按错题权重重练一轮 →</a>
          </div>`
        : ''
    }

    <div class="block">
      ${sectionHeading('待重做题目', flaggedQuestions.length)}
      ${
        flaggedQuestions.length === 0
          ? emptyState(
              '还没有标记的题目',
              '在刷题页把题目标记为「需复习」或「错题」，或答错一道题，它们会自动汇总到这里。'
            )
          : `<div class="qlist">${flaggedQuestions.map((q) => weakQuestionRow(repo, q, progress, activeDomain)).join('')}</div>`
      }
    </div>

    <div class="block">
      ${sectionHeading('需要回看的知识点', allWeakKnowledge.length)}
      ${
        allWeakKnowledge.length === 0
          ? emptyState(
              '暂无薄弱知识点',
              '薄弱题目关联的知识点会自动出现在这里；也可以在知识库详情页直接标记掌握状态。'
            )
          : `<div class="card-grid">${allWeakKnowledge
              .map((k) => weakKnowledgeCard(repo, k, progress))
              .join('')}</div>`
      }
    </div>

    <div class="block">
      ${sectionHeading('复习建议')}
      <ul class="advice">
        <li>先看知识点里的<b>工程边界与坑点</b>，再回到例题，重点比对「你的推导」与「分步解析」在哪一步分叉。</li>
        <li>客观题答错时，先判断是<b>概念错误</b>还是<b>计算/单位错误</b>——两者的复习路径完全不同。</li>
        <li>计算题建议自己重算一遍并核对单位量级（mA / µA、ns / µs、inch / mm 是最常见的失分点）。</li>
        <li>连续两次答对同一知识点下的题目后，再把它从「需复习」改为「已掌握」。</li>
      </ul>
    </div>
  </section>`;
}

function weakQuestionRow(repo, q, progress, activeDomain) {
  const mastery = progress.getMastery(q.id);
  const answer = progress.getAnswer(q.id);
  const firstRef = q.knowledge_refs[0];
  const refTitle = firstRef ? repo.knowledgeItem(firstRef)?.title ?? firstRef : null;

  // 注意：外层不能用 <a>。卡片内需要放「跳知识点」链接，而 <a> 不能嵌套 <a>
  // （浏览器会拆开标签，导致外层 href 被改写）。因此用带 role/键盘处理的 div。
  return `<div class="qcard ${answer?.correct === false ? 'is-wrong' : ''}"
    role="link" tabindex="0" data-href="#/drill/${escapeHtml(q.id)}?domain=${encodeURIComponent(activeDomain)}">
    <div class="qcard__left">
      <span class="qcard__id">${escapeHtml(q.id)}</span>
      ${badge(repo.questionTypeLabel(q.type), 'soft')}
      ${difficultyDots(q.difficulty)}
    </div>
    <div class="qcard__main">
      <div class="qcard__stem">${escapeHtml(q.stem)}</div>
      <div class="qcard__tags">
        <span class="qcard__cat">${escapeHtml(repo.categoryLabel(q.domain, q.category))}</span>
        ${
          answer?.attempts
            ? `<span class="qcard__ref">已尝试 ${answer.attempts} 次</span>`
            : ''
        }
        ${
          refTitle
            ? `<a class="qcard__ref-link" href="#/kb/${encodeURIComponent(firstRef)}"
                data-stop-nav="1">→ ${escapeHtml(refTitle)}</a>`
            : ''
        }
      </div>
    </div>
    <div class="qcard__right">
      ${mastery !== 'unseen' ? masteryBadge(mastery, repo.masteryStates()) : ''}
      ${answer?.correct === false ? badge('答错', 'bad') : badge('待复习', 'warn')}
    </div>
  </div>`;
}

function weakKnowledgeCard(repo, k, progress) {
  const mastery = progress.getMastery(k.id);
  return `<a class="kcard" href="#/kb/${encodeURIComponent(k.id)}">
    <div class="kcard__top">
      ${badge(repo.categoryLabel(k.domain, k.category), 'domain')}
      ${difficultyDots(k.difficulty, repo.difficultyLabel(k.difficulty))}
    </div>
    <h3 class="kcard__title">${escapeHtml(k.title)}</h3>
    <p class="kcard__summary">${escapeHtml(k.summary)}</p>
    <div class="kcard__foot">
      <span class="kcard__meta">${k.examples.length} 道例题</span>
      <span class="kcard__badges">
        ${mastery !== 'unseen' ? masteryBadge(mastery, repo.masteryStates()) : ''}
        ${verifiedBadge(repo, k.verified_status)}
      </span>
    </div>
  </a>`;
}

function dedupeById(list) {
  const seen = new Set();
  const out = [];
  for (const row of list) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
