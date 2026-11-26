/**
 * 开源项目视图：列表 + 详情。
 *
 * 与「目标公司」互补：
 *   公司页回答「对方要什么」，这一页回答「我拿什么去证明」。
 *
 * 项目全部来自公开 GitHub 仓库，star / 最近更新 / 许可证都经过 API 核实，
 * 并写明复刻所需的具体资料与步骤——这是「能真正做出来」和「只是列个名字」的区别。
 */

import { escapeHtml, renderInline } from '../core/markdown.js';
import { badge, emptyState, sectionHeading, backBar } from './components.js';

const DIFF_TONE = { 1: 'ok', 2: 'ok', 3: 'warn', 4: 'warn', 5: 'bad' };

/** 许可证 tone：宽松协议绿，GPL 黄，无协议红 */
function licenseTone(license) {
  const s = String(license ?? '');
  if (/^(MIT|Apache|BSD|ISC|Unlicense)/i.test(s)) return 'ok';
  if (/GPL|LGPL|AGPL/i.test(s)) return 'warn';
  if (/^无/.test(s)) return 'bad';
  return 'neutral';
}

export function renderProjectList(ctx) {
  const { repo } = ctx;
  const projects = repo.listProjects();

  if (!projects.length) {
    return `<section class="panel">
      ${sectionHeading('开源项目')}
      ${emptyState('还没有开源项目', '在 `data/projects.json` 中添加，并登记到 `data/manifest.json`。')}
    </section>`;
  }

  // 按分类分组
  const groups = new Map();
  for (const p of projects) {
    const key = p.category ?? '其他';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }

  const totalStars = projects.reduce((s, p) => s + (p.stars ?? 0), 0);
  const easy = projects.filter((p) => p.difficulty <= 2).length;

  return `
  <section class="panel">
    <div class="panel__head">
      ${sectionHeading('开源项目库', projects.length)}
    </div>

    <div class="notice notice--mixed">
      <strong>这一页是干什么的：</strong>
      面试最常被问「你做过什么」。这里每个项目都是<b>真实存在的 GitHub 仓库</b>，
      star 数、最近更新、许可证都逐个核实过，并写明了<b>复刻需要的资料</b>（原理图 / Gerber / BOM / 固件）
      和<b>具体步骤</b>。按难度从低到高挑一个做出来，比空谈「我熟悉电路设计」有用得多。
    </div>

    <div class="statgrid">
      <div class="statcard"><div class="statcard__value">${projects.length}</div><div class="statcard__label">开源项目</div></div>
      <div class="statcard statcard--ok"><div class="statcard__value">${easy}</div><div class="statcard__label">入门难度（1-2 级）</div></div>
      <div class="statcard"><div class="statcard__value">${(totalStars / 1000).toFixed(1)}k</div><div class="statcard__label">累计 star</div></div>
    </div>

    ${[...groups.entries()]
      .map(
        ([cat, list]) => `
      <div class="block">
        ${sectionHeading(cat, list.length)}
        <div class="prjgrid">
          ${list.map((p) => projectCard(p)).join('')}
        </div>
      </div>`
      )
      .join('')}
  </section>`;
}

function projectCard(p) {
  return `<a class="prjcard" href="#/projects/${encodeURIComponent(p.id)}">
    <div class="prjcard__top">
      ${badge(`难度 ${p.difficulty}`, DIFF_TONE[p.difficulty] ?? 'neutral')}
      ${badge(`⭐ ${p.stars}`, 'neutral')}
      ${badge(p.license, licenseTone(p.license))}
    </div>
    <h3 class="prjcard__name">${escapeHtml(p.name)}</h3>
    <div class="prjcard__repo">${escapeHtml(p.repo)}</div>
    <p class="prjcard__why">${escapeHtml(p.why)}</p>
    <div class="prjcard__meta">
      <span>${escapeHtml(p.lang)}</span>
      <span class="prjcard__sep">·</span>
      <span>${escapeHtml(p.duration)}</span>
      <span class="prjcard__sep">·</span>
      <span>约 ${escapeHtml(p.cost_cny)} 元</span>
    </div>
  </a>`;
}

export function renderProjectDetail(ctx) {
  const { repo, project: p } = ctx;
  if (!p) {
    return emptyState('项目不存在', '该 id 在当前数据源中找不到。', backLink('#/projects', '返回项目列表'));
  }

  const refs = (p.related_knowledge ?? [])
    .map((id) => repo.knowledgeItem(id))
    .filter(Boolean);

  // 哪些公司的岗位适合拿这个项目去投
  const companies = repo
    .listCompanies()
    .filter((c) => c.project_id === p.id);

  return `
  <article class="detail">
    ${backBar({
      href: '#/projects',
      label: '开源项目',
      crumbs: [p.category ?? '项目', p.name]
    })}

    <header class="detail__head">
      <div class="detail__topline">
        ${badge(`难度 ${p.difficulty}`, DIFF_TONE[p.difficulty] ?? 'neutral')}
        ${badge(`⭐ ${p.stars}`, 'neutral')}
        ${badge(p.license, licenseTone(p.license))}
        ${badge(p.category ?? '', 'soft')}
      </div>
      <h1 class="detail__title">${escapeHtml(p.name)}</h1>
      <div class="detail__meta-grid">
        <div><span class="detail__meta-k">仓库</span>
          <a class="source-line__link" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(p.repo)} ↗
          </a>
        </div>
        <div><span class="detail__meta-k">最近更新</span><span class="detail__meta-v">${escapeHtml(p.updated)}</span></div>
        <div><span class="detail__meta-k">周期</span><span class="detail__meta-v">${escapeHtml(p.duration)}</span></div>
        <div><span class="detail__meta-k">成本</span><span class="detail__meta-v">约 ${escapeHtml(p.cost_cny)} 元</span></div>
      </div>
      <div class="notice notice--mixed">${renderInline(p.why)}</div>
    </header>

    <section class="block">
      ${sectionHeading('能学到什么', (p.what_you_learn ?? []).length)}
      <ul class="advice">
        ${(p.what_you_learn ?? []).map((x) => `<li>${renderInline(x)}</li>`).join('')}
      </ul>
    </section>

    <section class="block">
      ${sectionHeading('仓库里有什么（复刻资料）', (p.materials ?? []).length)}
      <ul class="datalist">
        ${(p.materials ?? []).map((m) => `<li>${renderInline(m)}</li>`).join('')}
      </ul>
    </section>

    <section class="block">
      ${sectionHeading('复刻步骤', (p.replicate_steps ?? []).length)}
      <ol class="steps">
        ${(p.replicate_steps ?? [])
          .map(
            (s, i) => `<li class="step">
              <div class="step__title">第 ${i + 1} 步</div>
              <p class="step__body">${renderInline(s)}</p>
            </li>`
          )
          .join('')}
      </ol>
    </section>

    ${
      (p.risks ?? []).length
        ? `<section class="block">
            ${sectionHeading('坑与风险（动手前必读）', p.risks.length)}
            <ul class="pitfalls">
              ${p.risks.map((r) => `<li>${renderInline(r)}</li>`).join('')}
            </ul>
          </section>`
        : ''
    }

    ${
      p.firmware_repo
        ? `<section class="block">
            ${sectionHeading('配套固件 / 工具')}
            <p class="hint">${renderInline(p.firmware_repo)}</p>
          </section>`
        : ''
    }

    ${
      companies.length
        ? `<section class="block">
            ${sectionHeading('这个项目适合投哪些公司', companies.length)}
            <div class="refcards">
              ${companies
                .map(
                  (c) => `<a class="refcard" href="#/company/${encodeURIComponent(c.id)}">
                    <div class="refcard__top">
                      ${badge(c.tier ?? '', 'domain')}
                    </div>
                    <div class="refcard__title">${escapeHtml(c.short ?? c.name)}</div>
                    <div class="refcard__summary">${escapeHtml(c.project_note ?? '')}</div>
                    <div class="refcard__cta">查看岗位要求 →</div>
                  </a>`
                )
                .join('')}
            </div>
          </section>`
        : ''
    }

    ${
      refs.length
        ? `<section class="block">
            ${sectionHeading('相关知识点', refs.length)}
            <div class="refcards">
              ${refs
                .map(
                  (k) => `<a class="refcard" href="#/kb/${encodeURIComponent(k.id)}">
                    <div class="refcard__top">${badge(repo.categoryLabel(k.domain, k.category), 'domain')}</div>
                    <div class="refcard__title">${escapeHtml(k.title)}</div>
                    <div class="refcard__summary">${escapeHtml(k.summary)}</div>
                    <div class="refcard__cta">查看原理与例题 →</div>
                  </a>`
                )
                .join('')}
            </div>
          </section>`
        : ''
    }
  </article>`;
}

export function backLink(href, label) {
  return `<a class="btn btn--ghost" href="${href}">← ${escapeHtml(label)}</a>`;
}
