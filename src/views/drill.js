/**
 * 面试刷题训练视图：列表 + 单题作答。
 *
 * 作答流程：
 *   选择/输入 → 提交（客观题自动判分）→ 展示参考答案、踩分点、常见误区
 *   → 标记 已掌握 / 需复习 / 错题 → 可跳回对应知识点
 *
 * 主观题（简答/计算/设计）不自动判分，而是提供「自评：达标 / 未达标」，
 * 避免用关键词匹配伪造判分能力。
 *
 * 本轮新增的闭环能力：
 *   - 「随机练习」：按错误权重抽题，seed 进 URL，可分享且刷新不变
 *   - 详情页上一题/下一题：连续刷题不用退回列表
 *   - 答对自动升为「已掌握」，答错自动进错题（旧版只做了后者）
 *   - 列表分页 + 搜索命中高亮
 */

import { escapeHtml, renderInline } from '../core/markdown.js';
import { buildPracticeSet, neighboursInSet } from '../core/grading.js';
import {
  badge,
  difficultyDots,
  emptyState,
  masteryBadge,
  sectionHeading,
  segmented,
  sourceLine,
  text,
  verifiedBadge,
  withFilters,
  pager,
  backBar
} from './components.js';

const PAGE_SIZE = 20;

/**
 * 解析抽题序列。
 *
 * 关键设计：序列一旦生成就**冻结**，题目 id 列表直接写进 URL 的 set 参数。
 *
 * 为什么不能用「seed + 当前掌握状态」重建：抽题带错误权重，而权重依赖
 * 掌握状态；用户答完一道题状态就变了，重建出的序列随之改变，当前题可能
 * 掉出序列，于是「下一题」在用户最需要它的时候消失。
 *
 * 用 seed 生成也有同样问题，所以：
 *   - 生成时（startPractice）按权重抽一次，把结果写进 URL；
 *   - 之后无论怎么作答，都用 URL 里的 set 重建，顺序绝对稳定；
 *   - set 里的题若被删（数据更新），重建时跳过，不会报错。
 */
export function resolvePracticeSet(repo, filters, activeDomain, progress) {
  // 优先用冻结的 id 列表
  const rawSet = filters?.set;
  if (rawSet) {
    const ids = String(rawSet)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length) {
      return ids.map((id) => repo.questionItem(id)).filter(Boolean);
    }
    return [];
  }

  // 兼容只带 seed 的旧链接：仍可生成，但不保证跨作答稳定
  const seed = Number(filters?.practice);
  if (!Number.isFinite(seed)) return null;

  const size = Math.min(Math.max(Number(filters?.n) || 20, 1), 100);
  const pool = repo.listQuestions({
    domain: activeDomain,
    category: filters.category,
    difficulty: filters.difficulty,
    type: filters.type,
    query: filters.query
  });

  return buildPracticeSet(pool, {
    masteryOf: (id) => progress.getMastery(id),
    size,
    seed
  });
}

/** 序列是否处于练习模式 */
export function isPracticeMode(filters) {
  return Boolean(filters?.set || Number.isFinite(Number(filters?.practice)));
}

export function renderDrillList(ctx) {
  const { repo, filters, progress, counts, activeDomain } = ctx;
  const domain = repo.domain(activeDomain);

  const practiceSet = resolvePracticeSet(repo, filters, activeDomain, progress);
  const isPractice = Array.isArray(practiceSet) && practiceSet.length > 0;

  const allQuestions = repo.listQuestions({
    domain: activeDomain,
    category: filters.category,
    difficulty: filters.difficulty,
    type: filters.type,
    query: filters.query
  });

  const page = Math.max(1, Number(filters.page) || 1);
  const total = allQuestions.length;
  const pageStart = (page - 1) * PAGE_SIZE;
  const questions = isPractice
    ? practiceSet
    : allQuestions.slice(pageStart, pageStart + PAGE_SIZE);

  const categoryOptions = repo.categoriesOf(activeDomain).map((c) => ({
    value: c.id,
    label: c.label,
    count: counts.questions[activeDomain]?.byCategory[c.id] ?? 0
  }));

  const difficultyOptions = repo.taxonomy.difficulty_levels.map((d) => ({
    value: String(d.value),
    label: d.label
  }));

  const typeOptions = repo.taxonomy.question_types.map((t) => ({
    value: t.id,
    label: t.label
  }));

  // 分区口径统计：与薄弱点页一致，避免跨分区串数
  const domainIds = new Set(
    repo.listQuestions({ domain: activeDomain }).map((q) => q.id)
  );
  const stats = progress.stats({ ids: domainIds });

  const listHref = (patch = {}) => {
    const next = { ...filters, ...patch };
    if (patch.page === undefined) delete next.page;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, String(v));
    const q = params.toString();
    return q ? `#/drill?${q}` : '#/drill';
  };

  return `
  <section class="panel">
    <div class="panel__head">
      ${sectionHeading(isPractice ? `${domain?.label ?? ''}随机练习` : `${domain?.label ?? ''}刷题`, total)}
      <div class="panel__tools">
        <input class="search" type="search" placeholder="搜索题干、解析、踩分点…"
          value="${escapeHtml(filters.query ?? '')}" data-search="drill" aria-label="搜索题目" />
      </div>
    </div>

    <div class="filterbar">
      <div class="filterbar__row">
        <span class="filterbar__label">分类</span>
        ${segmented('category', categoryOptions, filters.category ?? '', { allLabel: '全部分类' })}
      </div>
      <div class="filterbar__row">
        <span class="filterbar__label">题型</span>
        ${segmented('type', typeOptions, filters.type ?? '', { allLabel: '全部题型' })}
      </div>
      <div class="filterbar__row">
        <span class="filterbar__label">难度</span>
        ${segmented('difficulty', difficultyOptions, filters.difficulty ?? '', { allLabel: '全部难度' })}
      </div>
    </div>

    <div class="practicebar">
      ${
        isPractice
          ? `<div class="practicebar__info">
              本次练习 ${practiceSet.length} 题（按错题/需复习优先抽取，顺序已固定）
            </div>
            <div class="practicebar__actions">
              <a class="btn btn--primary btn--sm" href="#/drill/${encodeURIComponent(
                practiceSet[0]?.id ?? ''
              )}?${carryParams(filters)}">开始做题</a>
              <a class="btn btn--ghost btn--sm" href="${escapeHtml(listHref({ practice: '', n: '', set: '', page: '' }))}">退出练习</a>
            </div>`
          : `<div class="practicebar__info">
              本分区共 ${total} 题 · 已作答 ${stats.answeredTotal} 题
              ${stats.accuracy === null ? '' : ` · 正确率 ${Math.round(stats.accuracy * 100)}%`}
            </div>
            <div class="practicebar__actions">
              <button type="button" class="btn btn--primary btn--sm" data-action="start-practice"
                data-count="20">随机抽 20 题</button>
              <button type="button" class="btn btn--ghost btn--sm" data-action="start-practice"
                data-count="10">抽 10 题</button>
              <button type="button" class="btn btn--ghost btn--sm" data-action="start-practice"
                data-count="10" data-wrong="1">只抽错题</button>
              <a class="drill-summary__link" href="#/review?domain=${encodeURIComponent(activeDomain)}">查看薄弱点 →</a>
            </div>`
      }
    </div>

    ${
      questions.length === 0
        ? emptyState('没有匹配的题目', '试着放宽分类、题型或难度筛选，或清空搜索词。')
        : `<div class="qlist">${questions
            .map((q) => questionRow(repo, q, progress, filters.query, filters, activeDomain))
            .join('')}</div>`
    }

    ${
      isPractice
        ? ''
        : pager({
            page,
            pageSize: PAGE_SIZE,
            total,
            makeHref: (p) => listHref({ page: String(p) })
          })
    }
  </section>`;
}

/** 剔除抽题相关参数（进入练习时不该继承上一轮的 practice/set） */
function cleanFilters(filters) {
  const out = {};
  for (const k of ['domain', 'category', 'difficulty', 'type', 'query']) {
    if (filters?.[k]) out[k] = filters[k];
  }
  return out;
}

/**
 * 把当前筛选与冻结的练习序列编码成查询串。
 * 这是「上一题 / 下一题 / 返回列表」共用的一份上下文。
 */
function carryParams(filters) {
  const params = new URLSearchParams();
  for (const k of ['domain', 'category', 'difficulty', 'type', 'query', 'practice', 'n', 'set']) {
    if (filters?.[k]) params.set(k, String(filters[k]));
  }
  return params.toString();
}

function questionRow(repo, q, progress, query, filters, activeDomain) {
  const answer = progress.getAnswer(q.id);
  const mastery = progress.getMastery(q.id);
  const stateClass =
    answer?.correct === true ? 'is-correct' : answer?.correct === false ? 'is-wrong' : '';

  // 进入详情时带上当前筛选与练习序列，返回与下一题才能自洽
  const params = new URLSearchParams();
  for (const k of ['domain', 'category', 'difficulty', 'type', 'query', 'practice', 'n']) {
    if (filters?.[k]) params.set(k, String(filters[k]));
  }
  const qs = params.toString();
  const href = `#/drill/${encodeURIComponent(q.id)}${qs ? `?${qs}` : ''}`;

  return `<a class="qcard ${stateClass}" href="${href}">
    <div class="qcard__left">
      <span class="qcard__id">${escapeHtml(q.id)}</span>
      ${badge(repo.questionTypeLabel(q.type), 'soft')}
      ${difficultyDots(q.difficulty, repo.difficultyLabel(q.difficulty))}
    </div>
    <div class="qcard__main">
      <div class="qcard__stem">${text(q.stem, query)}</div>
      <div class="qcard__tags">
        <span class="qcard__cat">${escapeHtml(repo.categoryLabel(q.domain, q.category))}</span>
        ${
          q.knowledge_refs.length
            ? `<span class="qcard__ref">关联 ${q.knowledge_refs.length} 个知识点</span>`
            : ''
        }
      </div>
    </div>
    <div class="qcard__right">
      ${mastery !== 'unseen' ? masteryBadge(mastery, repo.masteryStates()) : ''}
      ${
        answer?.correct === true
          ? badge('答对', 'ok')
          : answer?.correct === false
            ? badge('答错', 'bad')
            : answer?.reveal
              ? badge('已看解析', 'muted')
              : badge('未作答', 'muted')
      }
      ${verifiedBadge(repo, q.verified_status)}
    </div>
  </a>`;
}

export function renderDrillDetail(ctx) {
  const { repo, question: q, progress, activeDomain, counts, filters } = ctx;
  if (!q) {
    return emptyState('题目不存在', '该 id 在当前数据源中找不到。', backLink('#/drill', '返回题库'));
  }

  const answer = progress.getAnswer(q.id);
  const mastery = progress.getMastery(q.id);
  const autoGradable = repo.isAutoGradable(q.type);
  const revealed = Boolean(answer?.reveal);

  // 练习序列：从 URL 重建，保证与列表页看到的是同一套题
  const practiceSet = resolvePracticeSet(repo, filters, activeDomain, progress);
  const setIds = Array.isArray(practiceSet) ? practiceSet.map((x) => x.id) : [];
  const nav = setIds.length ? neighboursInSet(setIds, q.id) : null;

  const carryQs = carryParams(filters);
  const backHref = carryQs ? `#/drill?${carryQs}` : '#/drill';
  const linkTo = (qid) => `#/drill/${encodeURIComponent(qid)}${carryQs ? `?${carryQs}` : ''}`;

  const navExtra =
    nav && nav.index >= 0
      ? `<span class="qnav__pos">${nav.index + 1} / ${nav.total}</span>
         ${nav.prev ? `<a class="btn btn--ghost btn--sm" href="${linkTo(nav.prev)}">← 上一题</a>` : ''}
         ${nav.next ? `<a class="btn btn--primary btn--sm" href="${linkTo(nav.next)}">下一题 →</a>` : ''}`
      : '';

  return `
  <article class="detail detail--drill">
    ${backBar({
      href: backHref,
      label: isPracticeMode(filters) ? '练习列表' : '刷题',
      crumbs: [repo.domain(q.domain)?.label ?? q.domain, repo.categoryLabel(q.domain, q.category), q.id],
      extra: navExtra
    })}

    <header class="detail__head">
      <div class="detail__topline">
        ${badge(repo.domain(q.domain)?.label ?? q.domain, 'domain')}
        ${badge(repo.questionTypeLabel(q.type), 'soft')}
        ${difficultyDots(q.difficulty, `难度 ${repo.difficultyLabel(q.difficulty)}`)}
        ${verifiedBadge(repo, q.verified_status)}
      </div>
      <div class="qstem">
        <span class="qstem__no">Q</span>
        <p class="qstem__text">${renderInline(q.stem)}</p>
      </div>
    </header>

    ${renderAnswerArea(repo, q, answer, autoGradable, revealed)}

    ${
      revealed
        ? `<section class="block block--answer">
            ${sectionHeading('参考答案')}
            <p class="reference">${renderInline(q.answer.reference)}</p>

            ${sectionHeading('核心踩分点', q.scoring_points.length)}
            <ul class="scoring">
              ${q.scoring_points
                .map(
                  (p) => `<li class="scoring__item">
                    <span class="scoring__mark">◆</span>
                    <span>${renderInline(p)}</span>
                  </li>`
                )
                .join('')}
            </ul>

            <div class="example__section example__section--analysis">
              <h5>解析</h5>
              <p>${renderInline(q.analysis)}</p>
            </div>

            <div class="example__section example__section--pitfall">
              <h5>常见误区</h5>
              <ul class="pitfalls">
                ${q.pitfalls.map((p) => `<li>${renderInline(p)}</li>`).join('')}
              </ul>
            </div>
          </section>`
        : ''
    }

    <section class="block">
      ${sectionHeading('掌握标记')}
      <div class="mastery-group" data-mastery-target="question:${escapeHtml(q.id)}">
        ${repo
          .masteryStates()
          .map(
            (s) => `<button type="button"
            class="mastery-btn mastery-btn--${s.tone}${mastery === s.id ? ' is-active' : ''}"
            data-mastery="question:${escapeHtml(q.id)}" data-state="${s.id}">${escapeHtml(s.label)}</button>`
          )
          .join('')}
      </div>
      <p class="hint">答对自动标记「已掌握」，答错自动进「错题」。也可手动覆盖。</p>
    </section>

    ${
      q.knowledge_refs.length
        ? `<section class="block">
            ${sectionHeading('关联知识点（跳回知识库）', q.knowledge_refs.length)}
            <div class="refcards">
              ${q.knowledge_refs
                .map((kid) => {
                  const k = repo.knowledgeItem(kid);
                  if (!k) {
                    return `<div class="refcard refcard--missing">
                      <div class="refcard__title">引用缺失：${escapeHtml(kid)}</div>
                      <div class="refcard__hint">该知识点未在当前数据源中找到</div>
                    </div>`;
                  }
                  const kMastery = progress.getMastery(kid);
                  return `<a class="refcard" href="#/kb/${encodeURIComponent(kid)}">
                    <div class="refcard__top">
                      ${badge(repo.categoryLabel(k.domain, k.category), 'domain')}
                      ${kMastery !== 'unseen' ? masteryBadge(kMastery, repo.masteryStates()) : ''}
                    </div>
                    <div class="refcard__title">${escapeHtml(k.title)}</div>
                    <div class="refcard__summary">${escapeHtml(k.summary)}</div>
                    <div class="refcard__cta">查看原理与例题 →</div>
                  </a>`;
                })
                .join('')}
            </div>
          </section>`
        : ''
    }

    <footer class="detail__foot">
      ${sourceLine(repo, q.source)}
      <div class="detail__foot-meta">
        <span>更新于 ${escapeHtml(q.updated_at)}</span>
        <span>·</span>
        <span>题目 ID <code>${escapeHtml(q.id)}</code></span>
        <span>·</span>
        <span>本分区共 ${counts.questions[activeDomain]?.total ?? 0} 题</span>
      </div>
    </footer>
  </article>`;
}

function renderAnswerArea(repo, q, answer, autoGradable, revealed) {
  const selected = new Set(answer?.choice ?? []);
  const submitted = answer?.correct !== null && answer?.correct !== undefined;

  if (q.options.length === 0) {
    return `<section class="block block--answerarea">
      ${sectionHeading('作答')}
      <p class="hint">本题为${escapeHtml(repo.questionTypeLabel(q.type))}题，请先在纸上或草稿中作答，再查看解析并自评。</p>
      <div class="answer-actions">
        ${
          revealed
            ? `<button type="button" class="btn btn--ghost" data-action="hide-answer" data-question="${escapeHtml(q.id)}">收起解析</button>`
            : `<button type="button" class="btn btn--primary" data-action="reveal-answer" data-question="${escapeHtml(q.id)}">查看参考答案与踩分点</button>`
        }
      </div>
      ${
        revealed
          ? `<div class="selfgrade">
              <span class="selfgrade__label">自评：</span>
              <button type="button" class="btn btn--sm${answer?.correct === true ? ' is-active' : ''}"
                data-action="self-grade" data-correct="true" data-question="${escapeHtml(q.id)}">达标</button>
              <button type="button" class="btn btn--sm${answer?.correct === false ? ' is-active' : ''}"
                data-action="self-grade" data-correct="false" data-question="${escapeHtml(q.id)}">未达标</button>
            </div>`
          : ''
      }
    </section>`;
  }

  const isMulti = q.type === 'multi';

  return `<section class="block block--answerarea">
    ${sectionHeading(isMulti ? '作答（多选）' : '作答（单选）')}
    <p class="hint">${isMulti ? '多选题需全部选中才判对，少选算错。' : '单选题选一个最准确的。'}
      ${q.id ? '' : ''}</p>
    <div class="options" data-options-for="${escapeHtml(q.id)}">
      ${q.options
        .map((opt) => {
          const isSelected = selected.has(opt.key);
          const isCorrectKey = q.answer.choice.includes(opt.key);
          let cls = 'option';
          if (isSelected) cls += ' is-selected';
          if (submitted && revealed) {
            if (isCorrectKey) cls += ' is-answer';
            else if (isSelected) cls += ' is-wrong';
          }
          return `<button type="button" class="${cls}"
            data-option="${escapeHtml(opt.key)}" data-question="${escapeHtml(q.id)}"
            ${submitted && revealed ? 'disabled' : ''}>
            <span class="option__key">${escapeHtml(opt.key)}</span>
            <span class="option__text">${renderInline(opt.text)}</span>
            ${
              submitted && revealed && isCorrectKey
                ? '<span class="option__flag option__flag--ok">正确答案</span>'
                : ''
            }
            ${
              submitted && revealed && isSelected && !isCorrectKey
                ? '<span class="option__flag option__flag--bad">你的选择</span>'
                : ''
            }
          </button>`;
        })
        .join('')}
    </div>

    <div class="answer-actions">
      ${
        submitted && revealed
          ? `<div class="verdict verdict--${answer.correct ? 'ok' : 'bad'}">
              ${answer.correct ? '✓ 回答正确' : '✗ 回答错误'}
              <span class="verdict__detail">正确答案：${escapeHtml(q.answer.choice.join('、'))}</span>
            </div>
            <button type="button" class="btn btn--ghost" data-action="retry" data-question="${escapeHtml(q.id)}">重新作答</button>`
          : `<button type="button" class="btn btn--primary" data-action="submit-answer" data-question="${escapeHtml(q.id)}"
              ${selected.size === 0 ? 'disabled' : ''}>提交并查看解析</button>`
      }
    </div>
  </section>`;
}

function backLink(href, label) {
  return `<a class="btn btn--ghost" href="${href}">← ${escapeHtml(label)}</a>`;
}

export { withFilters };
