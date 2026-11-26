/**
 * 应用外壳：顶栏（一级模块切换）+ 分区切换条（二级分区）+ 统计。
 *
 * 两个模块内部都必须能切换 hardware / embedded，这是本产品的结构约束，
 * 因此分区条放在外壳层统一渲染，而不是各视图各画一份。
 *
 * 统计口径：顶栏数字只反映**当前分区**，因为用户在哪个分区里就只关心哪个分区。
 * 全库总数放在「数据说明」页。
 */

import { escapeHtml } from '../core/markdown.js';
import { badge } from './components.js';

/**
 * 需要「知识分区」切换条的模块。
 *
 * 目标公司与数据说明页是按公司/按元数据组织的，与 hardware/embedded 分区无关；
 * 在这两个页面上显示分区条会让用户误以为点了会筛选内容，实际什么都不发生。
 */
const SHOW_DOMAINBAR = new Set(['kb', 'drill', 'review']);

const MODULES = [
  { id: 'kb', label: '知识库', hash: '#/kb', hint: '原理 · 边界 · 例题解析' },
  { id: 'drill', label: '面试刷题训练', hash: '#/drill', hint: '作答 · 踩分点 · 掌握标记' },
  { id: 'company', label: '目标公司', hash: '#/company', hint: '岗位要求 · 推荐项目 · 面试问答' }
];

/**
 * @param {{
 *   activeModule: 'kb'|'drill'|'review'|'about',
 *   activeDomain: string,
 *   repo: any,
 *   stats: any,
 *   providerInfo: {id: string, description: string},
 *   onFilter: (name: string, value: string) => void
 * }} ctx
 */
export function renderShell(ctx) {
  const { activeModule, activeDomain, repo, stats } = ctx;
  const moduleForDomain = activeModule === 'drill' ? 'drill' : 'kb';

  return `
  <header class="topbar">
    <div class="topbar__brand">
      <div class="brand__mark">HW<span>/</span>EM</div>
      <div class="brand__text">
        <div class="brand__title">嵌入式硬件工程师知识题库</div>
        <div class="brand__sub">知识库 · 面试刷题训练 · 目标公司</div>
      </div>
    </div>
    <nav class="module-nav" aria-label="一级模块">
      ${MODULES.map((m) => {
        const active = activeModule === m.id || (m.id === 'kb' && activeModule === 'review');
        return `<a class="module-nav__item${active ? ' is-active' : ''}" href="${m.hash}"
          data-nav="module" data-module="${m.id}">
          <span class="module-nav__label">${escapeHtml(m.label)}</span>
          <span class="module-nav__hint">${escapeHtml(m.hint)}</span>
        </a>`;
      }).join('')}
      <a class="module-nav__item module-nav__item--ghost${
        activeModule === 'about' ? ' is-active' : ''
      }" href="#/about" data-nav="module" data-module="about">
        <span class="module-nav__label">数据说明</span>
        <span class="module-nav__hint">来源与核验状态</span>
      </a>
    </nav>
    <div class="topbar__stats" title="${SHOW_DOMAINBAR.has(activeModule) ? '当前分区的掌握状态统计' : '全部内容的掌握状态统计'}">
      ${badge(`已掌握 ${stats.mastery.mastered}`, 'ok')}
      ${badge(`需复习 ${stats.mastery.review}`, 'warn')}
      ${badge(`错题 ${stats.mastery.wrong}`, 'bad')}
      ${
        stats.accuracy === null
          ? badge('正确率 —', 'muted')
          : badge(`正确率 ${Math.round(stats.accuracy * 100)}%`, 'neutral')
      }
    </div>
  </header>

  ${
    SHOW_DOMAINBAR.has(activeModule)
      ? `<div class="domainbar">
    <div class="domainbar__label">知识分区</div>
    <div class="domainbar__tabs" role="tablist" aria-label="二级分区">
      ${repo
        .domains()
        .map((d) => {
          const active = d.id === activeDomain;
          const counts = moduleForDomain === 'drill' ? ctx.counts.questions[d.id] : ctx.counts.knowledge[d.id];
          return `<button type="button" role="tab" aria-selected="${active}"
            class="domaintab${active ? ' is-active' : ''}"
            data-domain-tab="${d.id}" data-module-target="${moduleForDomain}">
            <span class="domaintab__name">${escapeHtml(d.label)}</span>
            <span class="domaintab__meta">${escapeHtml(d.short)} · ${counts?.total ?? 0} 条</span>
          </button>`;
        })
        .join('')}
    </div>
    <div class="domainbar__desc">${escapeHtml(repo.domain(activeDomain)?.description ?? '')}</div>
  </div>`
      : ''
  }`;
}

/**
 * 数据源提示条。
 *
 * 旧版把所有内容笼统标成「全部未核验」，一旦有一半内容升到 verified
 * 这句话就变成假话。现在按实际统计生成：有已核验的就如实说已核验多少条。
 */
export function renderSourceNotice(repo) {
  const { knowledge, questions } = repo.all();
  const rows = [...knowledge, ...questions];
  const total = rows.length;
  const verified = rows.filter((r) => r.verified_status === 'verified').length;
  const seed = rows.filter((r) => r.verified_status === 'seed_unverified').length;

  if (verified === 0) {
    return `<div class="notice notice--warn">
      <strong>数据状态：</strong>
      当前全部 ${total} 条内容均为 <code>seed_unverified</code>（种子未核验），
      仅由通用工程原理与经典面试题型整理，<b>未与数据手册、标准原文或实测数据逐条核对</b>。
      每条都标注了来源；升级核验状态需要补充可追溯的出处。
    </div>`;
  }

  const pct = Math.round((verified / total) * 100);
  return `<div class="notice notice--mixed">
    <strong>数据状态：</strong>
    共 ${total} 条，其中 <b>${verified} 条已核验</b>（${pct}%，附来源版本与章节定位）、
    ${seed} 条为 <code>seed_unverified</code> 种子内容（由通用原理整理，未逐条对照原文）。
    列表与详情页的徽章标注了每条的实际状态，点来源行的「原文 ↗」可跳转到出处。
  </div>`;
}

export function renderFooter(providerInfo) {
  return `<footer class="footer">
    <span>数据源：${escapeHtml(providerInfo.id)} — ${escapeHtml(providerInfo.description)}</span>
    <span class="footer__sep">·</span>
    <a href="#/about">数据 Schema 与可信度约定</a>
  </footer>`;
}
