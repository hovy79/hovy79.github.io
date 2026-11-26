/**
 * 知识库视图：列表 + 详情。
 *
 * 详情页的核心是「原理 → 工程边界 → 例题与分步解析」三段式，
 * 例题默认折叠，展开后按 已知条件 / 考点拆解 / 分步推导 / 常见误区 呈现。
 *
 * 本轮变化：
 *   - 搜索命中高亮（正文也参与检索后，必须让用户看到命中在哪儿）
 *   - 列表分页（条目扩到数十条后全量渲染会明显拖慢）
 *   - 详情页底部相关条目按「显式 related → 同分类」兜底
 *   - 返回链接保留筛选语境
 */

import { escapeHtml, renderInline } from '../core/markdown.js';
import {
  badge,
  difficultyDots,
  emptyState,
  masteryBadge,
  sectionHeading,
  segmented,
  sourceLine,
  tagList,
  text,
  verifiedBadge,
  pager,
  backBar
} from './components.js';

const PAGE_SIZE = 24;

export function renderKnowledgeList(ctx) {
  const { repo, filters, progress, counts, activeDomain } = ctx;
  const domain = repo.domain(activeDomain);

  const allItems = repo.listKnowledge({
    domain: activeDomain,
    category: filters.category,
    difficulty: filters.difficulty,
    query: filters.query
  });

  const page = Math.max(1, Number(filters.page) || 1);
  const pageStart = (page - 1) * PAGE_SIZE;
  const items = allItems.slice(pageStart, pageStart + PAGE_SIZE);

  const categoryOptions = repo.categoriesOf(activeDomain).map((c) => ({
    value: c.id,
    label: c.label,
    count: counts.knowledge[activeDomain]?.byCategory[c.id] ?? 0
  }));

  const difficultyOptions = repo.taxonomy.difficulty_levels.map((d) => ({
    value: String(d.value),
    label: d.label
  }));

  const listHref = (patch = {}) => {
    const next = { ...filters, ...patch };
    if (patch.page === undefined) delete next.page;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, String(v));
    const q = params.toString();
    return q ? `#/kb?${q}` : '#/kb';
  };

  return `
  <section class="panel">
    <div class="panel__head">
      ${sectionHeading(`${domain?.label ?? ''}知识库`, allItems.length)}
      <div class="panel__tools">
        <input class="search" type="search" placeholder="搜索标题、原理正文、边界、标签…"
          value="${escapeHtml(filters.query ?? '')}" data-search="knowledge" aria-label="搜索知识点" />
      </div>
    </div>

    <div class="filterbar">
      <div class="filterbar__row">
        <span class="filterbar__label">分类</span>
        ${segmented('category', categoryOptions, filters.category ?? '', { allLabel: '全部分类' })}
      </div>
      <div class="filterbar__row">
        <span class="filterbar__label">难度</span>
        ${segmented('difficulty', difficultyOptions, filters.difficulty ?? '', { allLabel: '全部难度' })}
      </div>
    </div>

    ${
      items.length === 0
        ? emptyState('没有匹配的知识点', '试着放宽分类或难度筛选，或清空搜索词。')
        : `<div class="card-grid">${items
            .map((item) => knowledgeCard(repo, item, progress, filters))
            .join('')}</div>`
    }

    ${pager({ page, pageSize: PAGE_SIZE, total: allItems.length, makeHref: (p) => listHref({ page: String(p) }) })}
  </section>`;
}

function knowledgeCard(repo, item, progress, filters) {
  const exampleCount = item.examples.length;
  const mastery = progress.getMastery(item.id);
  const query = filters?.query ?? '';

  const params = new URLSearchParams();
  for (const k of ['domain', 'category', 'difficulty', 'query', 'page']) {
    if (filters?.[k]) params.set(k, String(filters[k]));
  }
  const qs = params.toString();
  const href = `#/kb/${encodeURIComponent(item.id)}${qs ? `?${qs}` : ''}`;

  return `<a class="kcard" href="${href}">
    <div class="kcard__top">
      ${badge(repo.categoryLabel(item.domain, item.category), 'domain')}
      ${difficultyDots(item.difficulty, repo.difficultyLabel(item.difficulty))}
    </div>
    <h3 class="kcard__title">${text(item.title, query)}</h3>
    <p class="kcard__summary">${text(item.summary, query)}</p>
    ${tagList(item.tags.slice(0, 4))}
    <div class="kcard__foot">
      <span class="kcard__meta">${exampleCount} 道例题 · ${item.boundaries.length} 条边界</span>
      <span class="kcard__badges">
        ${mastery !== 'unseen' ? masteryBadge(mastery, repo.masteryStates()) : ''}
        ${verifiedBadge(repo, item.verified_status)}
      </span>
    </div>
  </a>`;
}

export function renderKnowledgeDetail(ctx) {
  const { repo, item, progress, activeDomain, counts, filters } = ctx;
  if (!item) {
    return emptyState('知识点不存在', '该 id 在当前数据源中找不到。', backLink('#/kb', '返回知识库'));
  }

  const relatedQuestions = repo.questionsForKnowledge(item.id);
  const mastery = progress.getMastery(item.id);

  // 返回列表时保留筛选语境的链接
  const backParams = new URLSearchParams();
  for (const k of ['domain', 'category', 'difficulty', 'query', 'page']) {
    if (filters?.[k]) backParams.set(k, String(filters[k]));
  }
  const backQs = backParams.toString();
  const backHref = backQs ? `#/kb?${backQs}` : '#/kb';

  const drillParams = new URLSearchParams();
  drillParams.set('domain', item.domain);
  const drillHref = `#/drill?${drillParams.toString()}`;

  return `
  <article class="detail">
    ${backBar({
      href: backHref,
      label: '知识库',
      crumbs: [
        repo.domain(item.domain)?.label ?? item.domain,
        repo.categoryLabel(item.domain, item.category),
        item.title
      ]
    })}

    <header class="detail__head">
      <div class="detail__topline">
        ${badge(repo.domain(item.domain)?.label ?? item.domain, 'domain')}
        ${badge(repo.categoryLabel(item.domain, item.category), 'soft')}
        ${difficultyDots(item.difficulty, `难度 ${repo.difficultyLabel(item.difficulty)}`)}
        ${verifiedBadge(repo, item.verified_status)}
      </div>
      <h1 class="detail__title">${escapeHtml(item.title)}</h1>
      <p class="detail__summary">${renderInline(item.summary)}</p>
      ${tagList(item.tags)}
      <div class="detail__actions">
        <span class="detail__mastery-label">掌握状态</span>
        <div class="mastery-group" data-mastery-target="knowledge:${escapeHtml(item.id)}">
          ${repo
            .masteryStates()
            .map(
              (s) => `<button type="button"
              class="mastery-btn mastery-btn--${s.tone}${mastery === s.id ? ' is-active' : ''}"
              data-mastery="knowledge:${escapeHtml(item.id)}" data-state="${s.id}">${escapeHtml(s.label)}</button>`
            )
            .join('')}
        </div>
        ${relatedQuestions.length ? `<a class="btn btn--primary btn--sm" href="${escapeHtml(drillHref)}">去刷这一类的题 →</a>` : ''}
      </div>
    </header>

    <section class="block">
      ${sectionHeading('核心原理')}
      <div class="principles">
        ${item.principle
          .map(
            (p, i) => `<div class="principle">
              <div class="principle__no">${i + 1}</div>
              <div class="principle__body">
                <h4>${escapeHtml(p.heading)}</h4>
                <p>${renderInline(p.body)}</p>
              </div>
            </div>`
          )
          .join('')}
      </div>
    </section>

    <section class="block">
      ${sectionHeading('关键工程边界与坑点', item.boundaries.length)}
      <ul class="boundaries">
        ${item.boundaries
          .map(
            (b) => `<li class="boundary">
              <div class="boundary__head">${escapeHtml(b.heading)}</div>
              <p>${renderInline(b.body)}</p>
            </li>`
          )
          .join('')}
      </ul>
    </section>

    <section class="block">
      ${sectionHeading('例题与分步解析', item.examples.length)}
      <div class="examples">
        ${item.examples.map((ex, i) => exampleCard(repo, item, ex, i)).join('')}
      </div>
    </section>

    ${
      relatedQuestions.length
        ? `<section class="block">
            ${sectionHeading('相关练习题', relatedQuestions.length)}
            <div class="qlist qlist--compact">
              ${relatedQuestions
                .map(
                  (q) => `<a class="qrow" href="#/drill/${encodeURIComponent(q.id)}${backQs ? `?${backQs}` : ''}">
                    <span class="qrow__type">${escapeHtml(repo.questionTypeLabel(q.type))}</span>
                    <span class="qrow__stem">${escapeHtml(q.stem)}</span>
                    ${difficultyDots(q.difficulty)}
                  </a>`
                )
                .join('')}
            </div>
          </section>`
        : ''
    }

    ${
      (() => {
        const related = repo.relatedKnowledge(item, 4);
        if (!related.length) return '';
        return `<section class="block">
          ${sectionHeading('相关内容', related.length)}
          <div class="related">
            ${related
              .map(
                (rel) => `<a class="related__item" href="#/kb/${encodeURIComponent(rel.id)}">
                  <span class="related__title">${escapeHtml(rel.title)}</span>
                  <span class="related__meta">${escapeHtml(repo.categoryLabel(rel.domain, rel.category))} · ${escapeHtml(repo.difficultyLabel(rel.difficulty))}</span>
                </a>`
              )
              .join('')}
          </div>
        </section>`;
      })()
    }

    <footer class="detail__foot">
      ${sourceLine(repo, item.source)}
      <div class="detail__foot-meta">
        <span>更新于 ${escapeHtml(item.updated_at)}</span>
        <span>·</span>
        <span>条目 ID <code>${escapeHtml(item.id)}</code></span>
        <span>·</span>
        <span>本分区共 ${counts.knowledge[activeDomain]?.total ?? 0} 条</span>
      </div>
    </footer>
  </article>`;
}

function exampleCard(repo, item, ex, index) {
  return `<details class="example" ${index === 0 ? 'open' : ''}>
    <summary class="example__summary">
      <span class="example__badge">例 ${index + 1}</span>
      <span class="example__title">${escapeHtml(ex.title)}</span>
      <span class="example__meta">
        ${badge(repo.questionTypeLabel(ex.type), 'soft')}
        ${difficultyDots(ex.difficulty)}
      </span>
    </summary>
    <div class="example__body">
      <div class="example__section">
        <h5>已知条件</h5>
        <ul class="datalist">
          ${ex.given.map((g) => `<li>${renderInline(g)}</li>`).join('')}
        </ul>
      </div>

      <div class="example__section">
        <h5>考点拆解</h5>
        <ul class="chips">
          ${ex.exam_points.map((p) => `<li>${renderInline(p)}</li>`).join('')}
        </ul>
      </div>

      <div class="example__section">
        <h5>计算 / 推导过程</h5>
        <ol class="steps">
          ${ex.steps
            .map(
              (s) => `<li class="step">
                <div class="step__title">${escapeHtml(s.title)}</div>
                <p class="step__body">${renderInline(s.body)}</p>
                ${
                  s.formula
                    ? `<div class="step__formula"><code>${escapeHtml(s.formula)}</code></div>`
                    : ''
                }
              </li>`
            )
            .join('')}
        </ol>
      </div>

      <div class="example__section example__section--answer">
        <h5>结论</h5>
        <p>${renderInline(ex.answer)}</p>
      </div>

      <div class="example__section example__section--pitfall">
        <h5>常见误区</h5>
        <ul class="pitfalls">
          ${ex.pitfalls.map((p) => `<li>${renderInline(p)}</li>`).join('')}
        </ul>
      </div>

      <div class="example__foot">
        ${sourceLine(repo, item.source)}
        ${verifiedBadge(repo, item.verified_status)}
      </div>
    </div>
  </details>`;
}

export function backLink(href, label) {
  return `<a class="btn btn--ghost" href="${href}">← ${escapeHtml(label)}</a>`;
}
