/**
 * 复用的小组件。全部返回 HTML 字符串，由视图拼接。
 * 所有插值都经过 escapeHtml / renderInline，避免数据源注入。
 */

import { escapeHtml, renderInline, renderInlineMarked } from '../core/markdown.js';

export function badge(text, tone = 'neutral', title = '') {
  const t = title ? ` title="${escapeHtml(title)}"` : '';
  return `<span class="badge badge--${tone}"${t}>${escapeHtml(text)}</span>`;
}

/** 未核验状态徽章：真实性约束的可见化 */
export function verifiedBadge(repo, status) {
  const meta = repo.verifiedStatusMeta(status);
  const tone = status === 'verified' ? 'ok' : status === 'deprecated' ? 'muted' : 'warn';
  const label = meta?.label ?? status;
  const title = meta?.description ?? '';
  return badge(label, tone, title);
}

export function difficultyDots(value, label = '') {
  const level = Math.max(1, Math.min(5, Number(value) || 1));
  const dots = Array.from({ length: 5 }, (_, i) =>
    `<i class="dot${i < level ? ' dot--on' : ''}"></i>`
  ).join('');
  const text = label ? `<span class="difficulty__label">${escapeHtml(label)}</span>` : '';
  return `<span class="difficulty" title="难度 ${level}/5">${dots}${text}</span>`;
}

export function masteryBadge(state, statesMeta) {
  const meta = statesMeta.find((s) => s.id === state) ?? statesMeta[0];
  return badge(meta.label, meta.tone);
}

/**
 * 来源行。
 *
 * 相比旧版的增强：来源若是标准/数据手册/应用笔记这类**可追溯**类型，
 * 把 url 渲染成真链接，并显示 edition（版本/日期）。
 * 这才是「来源不清」的实际解法——用户能一键跳到原文。
 */
export function sourceLine(repo, source) {
  if (!source?.source_id) return '';
  const meta = repo.sourceOf(source);
  const title = meta?.title ?? source.source_id;
  const locator = source.ref ? ` · ${source.ref}` : '';
  const edition = meta?.edition ? ` · ${meta.edition}` : '';
  const trust = meta?.trust ? ` · 可信度 ${meta.trust}` : '';
  const link = meta?.url
    ? `<a class="source-line__link" href="${escapeHtml(meta.url)}" target="_blank" rel="noopener noreferrer">原文 ↗</a>`
    : '';
  return `<div class="source-line" title="${escapeHtml(meta?.note ?? '')}">
    <span class="source-line__label">来源</span>
    <span class="source-line__value">${escapeHtml(title)}${escapeHtml(edition)}${escapeHtml(locator)}${escapeHtml(trust)}</span>
    ${link}
  </div>`;
}

export function emptyState(title, hint = '', action = '') {
  return `<div class="empty">
    <div class="empty__title">${escapeHtml(title)}</div>
    ${hint ? `<div class="empty__hint">${renderInline(hint)}</div>` : ''}
    ${action}
  </div>`;
}

export function sectionHeading(title, count) {
  const c = Number.isFinite(count) ? `<span class="section__count">${count}</span>` : '';
  return `<h2 class="section__title">${escapeHtml(title)}${c}</h2>`;
}

export function tagList(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return '';
  return `<div class="tags">${tags
    .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
    .join('')}</div>`;
}

/** 分段筛选器：选项形如 [{value, label, count}] */
export function segmented(name, options, activeValue, { allLabel = '全部', allValue = '' } = {}) {
  const items = [{ value: allValue, label: allLabel, count: null }, ...options];
  return `<div class="segmented" role="group" data-segmented="${escapeHtml(name)}">
    ${items
      .map((opt) => {
        const active = String(opt.value ?? '') === String(activeValue ?? '');
        const count =
          opt.count === null || opt.count === undefined
            ? ''
            : `<span class="segmented__count">${opt.count}</span>`;
        return `<button type="button" class="segmented__btn${active ? ' is-active' : ''}"
          data-filter="${escapeHtml(name)}" data-value="${escapeHtml(opt.value ?? '')}"
          aria-pressed="${active}">${escapeHtml(opt.label)}${count}</button>`;
      })
      .join('')}
  </div>`;
}

/**
 * 带高亮的文本渲染。query 为空时等价于 renderInline。
 * 视图里凡是「可能命中搜索词」的文本都该走这个，否则用户看不出为什么这条被搜到。
 */
export function text(text, query = '') {
  return renderInlineMarked(text, query);
}

/**
 * 保留筛选条件的链接。
 *
 * 旧版从筛选后的列表点进详情，面包屑返回时分类/难度/搜索词全丢了。
 * 这个函数统一生成「带着当前筛选语境」的返回链接。
 */
export function withFilters(hash, filters, keep = ['domain', 'category', 'difficulty', 'type', 'query']) {
  const params = new URLSearchParams();
  for (const key of keep) {
    const v = filters?.[key];
    if (v) params.set(key, String(v));
  }
  const q = params.toString();
  return q ? `${hash}?${q}` : hash;
}

/**
 * 分页控件。
 * 题库扩到上百题后，全量渲染列表会明显拖慢首屏，必须分页。
 */
export function pager({ page, pageSize, total, makeHref }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return '';
  const cur = Math.min(Math.max(1, page), pages);
  const items = [];
  const push = (p) => {
    items.push(
      p === cur
        ? `<span class="pager__item is-active" aria-current="page">${p}</span>`
        : `<a class="pager__item" href="${escapeHtml(makeHref(p))}">${p}</a>`
    );
  };

  // 首页、末页、当前页 ±2，其余用省略号
  const window = new Set([1, pages, cur, cur - 1, cur + 1, cur - 2, cur + 2]);
  let prev = 0;
  for (let p = 1; p <= pages; p += 1) {
    if (!window.has(p)) continue;
    if (p - prev > 1) items.push('<span class="pager__gap">…</span>');
    push(p);
    prev = p;
  }

  return `<nav class="pager" aria-label="分页">
    ${cur > 1 ? `<a class="pager__nav" href="${escapeHtml(makeHref(cur - 1))}">← 上一页</a>` : ''}
    ${items.join('')}
    ${cur < pages ? `<a class="pager__nav" href="${escapeHtml(makeHref(cur + 1))}">下一页 →</a>` : ''}
    <span class="pager__total">共 ${total} 条 / ${pages} 页</span>
  </nav>`;
}

/** 分区统计小卡（薄弱点页与首页共用口径） */
export function statCard(value, label, tone = '') {
  return `<div class="statcard${tone ? ` statcard--${tone}` : ''}">
    <div class="statcard__value">${escapeHtml(String(value))}</div>
    <div class="statcard__label">${escapeHtml(label)}</div>
  </div>`;
}

/**
 * 二级页面的返回条：一个显式的「← 返回上一级」按钮 + 面包屑。
 *
 * 为什么不能只靠浏览器后退：从搜索结果或分享链接直接打开详情页时，
 * 浏览器后退会离开本站，用户就回不到列表了。所以每个二级页面都必须
 * 自带一个到列表页的稳定链接。
 *
 * @param {{
 *   href: string,                  // 返回目标（列表页）
 *   label: string,                 // 返回目标的名称，如「知识库」
 *   crumbs?: string[],             // 当前路径的各级名称（最后一项是当前页）
 *   extra?: string                 // 右侧附加内容（如「上一题/下一题」）
 * }} opts
 */
export function backBar({ href, label, crumbs = [], extra = '' }) {
  const trail = crumbs.length
    ? `<ol class="backbar__trail" aria-label="当前位置">
        ${crumbs
          .map(
            (c, i) =>
              `<li class="backbar__crumb${i === crumbs.length - 1 ? ' is-current' : ''}">${escapeHtml(c)}</li>`
          )
          .join('<li class="backbar__sep" aria-hidden="true">/</li>')}
      </ol>`
    : '';
  return `<nav class="backbar" aria-label="页面导航">
    <a class="backbar__btn" href="${escapeHtml(href)}">
      <span class="backbar__arrow" aria-hidden="true">←</span>返回${escapeHtml(label)}
    </a>
    ${trail}
    ${extra ? `<div class="backbar__extra">${extra}</div>` : ''}
  </nav>`;
}
