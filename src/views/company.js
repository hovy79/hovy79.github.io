/**
 * 目标公司视图：列表 + 详情。
 *
 * 这一模块是「求职导向」的：把桂林目标公司的真实岗位要求（JD）、对应知识点、
 * 推荐项目实物和面试问答放在一起，让用户可以按公司准备，而不是按章节学。
 *
 * 设计取舍：
 *   - 列表按 tier 排序（主力目标 → 冲刺 → 保底 → 待打探 → 不推荐），
 *     而不是按公司名拼音——用户关心的是「先投谁」。
 *   - 详情页分五段：公司概览 → 岗位与要求 → 考察重点 → 推荐项目 → 面试问答。
 *     前三段是「知道对手要什么」，后两段是「我该怎么准备」。
 *   - 没有公开 JD 的公司不隐藏，而是明确标注「待打探」并给出打探路径。
 *     假装有数据比没有数据更糟。
 */

import { escapeHtml, renderInline } from '../core/markdown.js';
import { badge, emptyState, sectionHeading, tagList, backBar } from './components.js';

const TIER_TONE = {
  主力目标: 'ok',
  冲刺: 'warn',
  保底选项: 'neutral',
  待打探: 'muted',
  不推荐: 'bad'
};

export function renderCompanyList(ctx) {
  const { repo } = ctx;
  const companies = repo.listCompanies();

  if (!companies.length) {
    return `<section class="panel">
      ${sectionHeading('目标公司')}
      ${emptyState(
        '还没有公司档案',
        '在 `data/companies/` 下添加公司数据，并登记到 `data/manifest.json` 的 `companies` 数组。'
      )}
    </section>`;
  }

  // 按 tier 分组
  const groups = new Map();
  for (const c of companies) {
    const t = c.tier ?? '其他';
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(c);
  }

  const summary = companies.reduce(
    (acc, c) => {
      acc.total += 1;
      if (c.project) acc.withProject += 1;
      if (!c.jobs?.length) acc.noJd += 1;
      return acc;
    },
    { total: 0, withProject: 0, noJd: 0 }
  );

  return `
  <section class="panel">
    <div class="panel__head">
      ${sectionHeading('桂林目标公司', summary.total)}
    </div>

    <div class="notice notice--mixed">
      <strong>怎么用这一页：</strong>
      先看「主力目标」——那是薪资、门槛和你最匹配的；「冲刺」是薪资高但年限不够的，
      可以当能力清单对照；「待打探」是公开渠道查不到 JD 的，需要官网或电话投递。
      每家公司的详情页里有<b>推荐项目实物</b>和<b>面试问答</b>。
    </div>

    <div class="statgrid">
      <div class="statcard"><div class="statcard__value">${summary.total}</div><div class="statcard__label">目标公司</div></div>
      <div class="statcard statcard--ok"><div class="statcard__value">${summary.withProject}</div><div class="statcard__label">有推荐项目</div></div>
      <div class="statcard statcard--warn"><div class="statcard__value">${summary.noJd}</div><div class="statcard__label">无公开 JD</div></div>
    </div>

    ${[...groups.entries()]
      .map(
        ([tier, list]) => `
      <div class="block">
        ${sectionHeading(`${tier}`, list.length)}
        <div class="cogrid">
          ${list.map((c) => companyCard(repo, c)).join('')}
        </div>
      </div>`
      )
      .join('')}
  </section>`;
}

function companyCard(repo, c) {
  const job = c.jobs?.[0];
  // 优先用 project_id 指向的开源项目，兼容旧式内嵌 project
  const ossProject = repo.projectForCompany(c);
  const project = c.project;
  const refCount = (c.knowledge_refs ?? []).length;

  return `<a class="cocard" href="#/company/${encodeURIComponent(c.id)}">
    <div class="cocard__top">
      ${badge(c.tier ?? '其他', TIER_TONE[c.tier] ?? 'neutral')}
      ${badge(c.industry ?? '', 'soft')}
    </div>
    <h3 class="cocard__name">${escapeHtml(c.name)}</h3>
    ${c.match_note ? `<p class="cocard__note">${renderInline(c.match_note)}</p>` : ''}
    <div class="cocard__meta">
      ${
        job
          ? `<span class="cocard__salary">${escapeHtml(job.salary ?? '—')}</span>
             <span class="cocard__sep">·</span>
             <span>${escapeHtml(job.experience ?? '')}</span>`
          : `<span class="cocard__muted">未获取到公开 JD</span>`
      }
    </div>
    <div class="cocard__foot">
      <span class="cocard__stat">考察 ${refCount} 个知识点</span>
      ${
        project
          ? `<span class="cocard__stat cocard__stat--ok">推荐项目：${escapeHtml(project.title.slice(0, 18))}…</span>`
          : `<span class="cocard__stat cocard__stat--muted">暂无推荐项目</span>`
      }
    </div>
  </a>`;
}

export function renderCompanyDetail(ctx) {
  const { repo, company: c } = ctx;
  if (!c) {
    return emptyState('公司档案不存在', '该 id 在当前数据源中找不到。', backLink('#/company', '返回公司列表'));
  }

  // 优先用 project_id 指向的开源项目，兼容旧式内嵌 project
  const ossProject = repo.projectForCompany(c);
  const project = c.project;
  const refs = (c.knowledge_refs ?? [])
    .map((id) => repo.knowledgeItem(id))
    .filter(Boolean);

  return `
  <article class="detail">
    ${backBar({
      href: '#/company',
      label: '目标公司',
      crumbs: [c.short ?? c.name]
    })}

    <header class="detail__head">
      <div class="detail__topline">
        ${badge(c.tier ?? '其他', TIER_TONE[c.tier] ?? 'neutral')}
        ${badge(c.industry ?? '', 'soft')}
        ${c.tier_note ? badge(c.tier_note, 'muted') : ''}
      </div>
      <h1 class="detail__title">${escapeHtml(c.name)}</h1>
      <p class="detail__summary">${escapeHtml(c.product_desc ?? '')}</p>
      <div class="detail__meta-grid">
        <div><span class="detail__meta-k">地点</span><span class="detail__meta-v">${escapeHtml(c.location ?? '—')}</span></div>
        <div><span class="detail__meta-k">规模</span><span class="detail__meta-v">${escapeHtml(c.scale ?? '—')}</span></div>
      </div>
      ${c.match_note ? `<div class="notice notice--mixed">${renderInline(c.match_note)}</div>` : ''}
    </header>

    ${
      c.info_gap
        ? `<section class="block">
            ${sectionHeading('信息缺口说明')}
            <p class="hint">${renderInline(c.info_gap)}</p>
          </section>`
        : ''
    }

    ${
      c.jobs?.length
        ? `<section class="block">
            ${sectionHeading('在招岗位与要求', c.jobs.length)}
            ${c.jobs.map((j) => jobCard(j)).join('')}
          </section>`
        : ''
    }

    ${
      (c.interview_focus ?? []).length
        ? `<section class="block">
            ${sectionHeading('面试考察重点', c.interview_focus.length)}
            <ul class="advice">
              ${c.interview_focus.map((f) => `<li>${renderInline(f)}</li>`).join('')}
            </ul>
          </section>`
        : ''
    }

    ${
      refs.length
        ? `<section class="block">
            ${sectionHeading('对应知识点（可跳回题库）', refs.length)}
            <div class="refcards">
              ${refs
                .map(
                  (k) => `<a class="refcard" href="#/kb/${encodeURIComponent(k.id)}">
                    <div class="refcard__top">
                      ${badge(repo.categoryLabel(k.domain, k.category), 'domain')}
                    </div>
                    <div class="refcard__title">${escapeHtml(k.title)}</div>
                    <div class="refcard__summary">${escapeHtml(k.summary)}</div>
                    <div class="refcard__cta">查看原理与例题 →</div>
                  </a>`
                )
                .join('')}
            </div>
            <div class="answer-actions">
              <a class="btn btn--primary btn--sm" href="#/drill?domain=${encodeURIComponent(refs[0].domain)}">去刷这些知识点的题 →</a>
            </div>
          </section>`
        : ''
    }

    ${
      ossProject
        ? `<section class="block block--project">
            ${sectionHeading(`推荐复刻的开源项目`)}
            <div class="notice notice--mixed">${renderInline(c.project_note ?? ossProject.why)}</div>
            <a class="prjcard prjcard--inline" href="#/projects/${encodeURIComponent(ossProject.id)}">
              <div class="prjcard__top">
                ${badge(`难度 ${ossProject.difficulty}`, 'warn')}
                ${badge(`⭐ ${ossProject.stars}`, 'neutral')}
                ${badge(ossProject.license, 'ok')}
              </div>
              <h3 class="prjcard__name">${escapeHtml(ossProject.name)}</h3>
              <div class="prjcard__repo">${escapeHtml(ossProject.repo)}</div>
              <div class="prjcard__meta">
                <span>${escapeHtml(ossProject.duration)}</span>
                <span class="prjcard__sep">·</span>
                <span>约 ${escapeHtml(ossProject.cost_cny)} 元</span>
              </div>
              <div class="refcard__cta">查看复刻步骤与资料 →</div>
            </a>
            <div class="answer-actions">
              <a class="btn btn--ghost btn--sm" href="${escapeHtml(ossProject.url)}" target="_blank" rel="noopener noreferrer">
                打开 GitHub 仓库 ↗
              </a>
            </div>
          </section>`
        : project
          ? renderProject(project)
          : ''
    }

    <footer class="detail__foot">
      <div class="detail__foot-meta">
        <span>公司 ID <code>${escapeHtml(c.id)}</code></span>
        <span>·</span>
        <span>数据来源：公开招聘页面（猎聘 / 智联 / 桂林人才网 / 公司官网）</span>
      </div>
    </footer>
  </article>`;
}

function jobCard(j) {
  return `<div class="jobcard">
    <div class="jobcard__head">
      <div class="jobcard__title">${escapeHtml(j.title)}</div>
      <div class="jobcard__tags">
        ${badge(j.salary ?? '—', 'ok')}
        ${badge(j.experience ?? '—', 'soft')}
        ${badge(j.education ?? '—', 'soft')}
      </div>
    </div>
    ${
      j.duties?.length
        ? `<div class="jobcard__section">
            <h5>岗位职责</h5>
            <ul class="datalist">${j.duties.map((d) => `<li>${renderInline(d)}</li>`).join('')}</ul>
          </div>`
        : ''
    }
    ${
      j.requirements?.length
        ? `<div class="jobcard__section">
            <h5>任职要求</h5>
            <ul class="datalist">${j.requirements.map((r) => `<li>${renderInline(r)}</li>`).join('')}</ul>
          </div>`
        : ''
    }
    ${
      j.source_url
        ? `<div class="jobcard__foot">
            <a class="source-line__link" href="${escapeHtml(j.source_url)}" target="_blank" rel="noopener noreferrer">查看原始 JD ↗</a>
          </div>`
        : ''
    }
  </div>`;
}

function renderProject(p) {
  return `<section class="block block--project">
    ${sectionHeading(`推荐项目：${p.title}`)}
    <p class="project__subtitle">${escapeHtml(p.subtitle ?? '')}</p>

    <div class="project__meta">
      <div><span class="detail__meta-k">难度</span><span class="detail__meta-v">${'●'.repeat(p.difficulty)}${'○'.repeat(5 - p.difficulty)}</span></div>
      <div><span class="detail__meta-k">周期</span><span class="detail__meta-v">${escapeHtml(p.duration ?? '—')}</span></div>
      <div><span class="detail__meta-k">成本</span><span class="detail__meta-v">${escapeHtml(p.cost ?? '—')}</span></div>
    </div>

    <div class="notice notice--mixed">${renderInline(p.why_this)}</div>

    <div class="project__section">
      <h4>做完能达到什么</h4>
      <ul class="advice">${p.goal.map((g) => `<li>${renderInline(g)}</li>`).join('')}</ul>
    </div>

    <div class="project__section">
      <h4>硬件组成（每个模块为什么选它）</h4>
      <div class="prjblocks">
        ${p.blocks
          .map(
            (b) => `<div class="prjblock">
              <div class="prjblock__name">${escapeHtml(b.name)}</div>
              <div class="prjblock__spec">${escapeHtml(b.spec)}</div>
              <div class="prjblock__reason">${renderInline(b.reason)}</div>
            </div>`
          )
          .join('')}
      </div>
    </div>

    <div class="project__section">
      <h4>设计决策（面试会追问的就是这些）</h4>
      ${p.design_points
        .map(
          (d) => `<div class="designpoint">
            <div class="designpoint__title">${escapeHtml(d.title)}</div>
            <p class="designpoint__body">${renderInline(d.body)}</p>
            <p class="designpoint__why"><span>为什么这是加分项：</span>${renderInline(d.why)}</p>
          </div>`
        )
        .join('')}
    </div>

    <div class="project__section">
      <h4>必须做的测试（没有数据等于没做）</h4>
      <ul class="datalist">${p.test_items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</ul>
    </div>

    <div class="project__section">
      <h4>交付物清单（面试带的材料）</h4>
      <ul class="datalist">${p.deliverables.map((d) => `<li>${renderInline(d)}</li>`).join('')}</ul>
    </div>

    <div class="project__section">
      <h4>面试问答演练（${p.interview_qa.length} 问）</h4>
      ${p.interview_qa
        .map(
          (qa, i) => `<details class="qa" ${i === 0 ? 'open' : ''}>
            <summary class="qa__q"><span class="qa__no">Q${i + 1}</span>${escapeHtml(qa.q)}</summary>
            <div class="qa__body">
              <div class="qa__a"><span class="qa__label">参考答案</span>${renderInline(qa.a)}</div>
              <div class="qa__tip"><span class="qa__label">技巧</span>${renderInline(qa.tip)}</div>
            </div>
          </details>`
        )
        .join('')}
    </div>
  </section>`;
}

export function backLink(href, label) {
  return `<a class="btn btn--ghost" href="${href}">← ${escapeHtml(label)}</a>`;
}
