/**
 * 外省公司视图：总部在外省、但在桂林有实体并招人的公司。
 *
 * 与「目标公司」互补：
 *   目标公司页 = 桂林本地企业
 *   这一页     = 外省总部 + 桂林上班（薪资体系、技术栈通常跟总部走）
 *
 * 判定标准写死在 data/outsiders.json 的 note 里，避免"算不算外省"扯皮。
 */

import { escapeHtml, renderInline } from '../core/markdown.js';
import { badge, emptyState, sectionHeading, backBar } from './components.js';

const MATCH_LABEL = {
  5: '技术高度对口',
  4: '技术较对口',
  3: '部分对口',
  2: '偏制造/测试',
  1: '基本不对口'
};
const MATCH_TONE = { 5: 'ok', 4: 'ok', 3: 'warn', 2: 'warn', 1: 'bad' };

export function renderOutsiderList(ctx) {
  const { repo } = ctx;
  const list = repo.listOutsiders();
  const ranking = typeof repo.outsidersRanking === 'function' ? repo.outsidersRanking() : null;

  if (!list.length) {
    return `<section class="panel">
      ${sectionHeading('外省公司在桂林')}
      ${emptyState('还没有数据', '在 `data/outsiders.json` 中添加并登记到 manifest。')}
    </section>`;
  }

  const good = list.filter((c) => (c.match ?? 0) >= 4);

  return `
  <section class="panel">
    <div class="panel__head">${sectionHeading('外省总部 · 桂林上班', list.length)}</div>

    <div class="notice notice--mixed">
      <strong>这一页解决什么问题：</strong>
      大家找工作默认只看桂林本地企业，但其实有几家<b>外省上市公司/央企在桂林设了实体</b>——
      薪资参照总部体系，往往比本地民企高一截；技术栈也跟一线城市同步。
      判定标准：①总部不在广西 ②桂林有独立法人或挂牌研发中心 ③现在在招人。
    </div>

    <div class="statgrid">
      <div class="statcard"><div class="statcard__value">${list.length}</div><div class="statcard__label">符合条件</div></div>
      <div class="statcard statcard--ok"><div class="statcard__value">${good.length}</div><div class="statcard__label">技术对口（4 级以上）</div></div>
      <div class="statcard"><div class="statcard__value">${new Set(list.map((c) => c.hq)).size}</div><div class="statcard__label">不同总部城市</div></div>
    </div>

    ${
      ranking
        ? `<div class="notice notice--ok" style="margin-top:1rem">
            <strong>${escapeHtml(ranking.title)}</strong>
            <ul class="advice" style="margin:0.5rem 0 0">
              ${ranking.reasons.map((r) => `<li>${renderInline(r)}</li>`).join('')}
            </ul>
          </div>`
        : ''
    }

    <div class="outgrid">
      ${list.map((c) => outCard(c)).join('')}
    </div>
  </section>`;
}

function outCard(c) {
  const roles = c.open_roles ?? [];
  const best = roles[0];
  return `<a class="outcard" href="#/outsiders/${encodeURIComponent(c.id)}">
    <div class="outcard__top">
      ${badge(`匹配度 ${c.match}`, MATCH_TONE[c.match] ?? 'neutral', MATCH_LABEL[c.match])}
      ${badge(c.hq, 'neutral')}
      ${c.hq_stock && !/^非上市/.test(c.hq_stock) ? badge('上市', 'ok', c.hq_stock) : badge('央企/非上市', 'soft')}
    </div>
    <h3 class="outcard__name">${escapeHtml(c.name)}</h3>
    <div class="outcard__hq">
      ${escapeHtml(c.hq_company)}<span class="outcard__sep">·</span>总部 ${escapeHtml(c.hq)}
    </div>
    <p class="outcard__note">${escapeHtml(c.match_note)}</p>
    <div class="outcard__footer">
      <span class="outcard__roles">${roles.length} 个在招岗位</span>
      ${best ? `<span class="outcard__salary">${escapeHtml(best.salary)} 起</span>` : ''}
    </div>
  </a>`;
}

export function renderOutsiderDetail(ctx) {
  const { company: c } = ctx;
  if (!c) {
    return emptyState('公司不存在', '该 id 在当前数据源中找不到。', `<a class="btn btn--ghost" href="#/outsiders">← 返回列表</a>`);
  }

  const wt = c.work_time ?? {};

  return `
  <article class="detail">
    ${backBar({ href: '#/outsiders', label: '外省公司在桂林', crumbs: [c.hq, c.short] })}

    <header class="detail__head">
      <div class="detail__topline">
        ${badge(`匹配度 ${c.match}`, MATCH_TONE[c.match] ?? 'neutral', MATCH_LABEL[c.match])}
        ${badge(c.hq, 'neutral')}
        ${badge(c.relation, 'soft')}
      </div>
      <h1 class="detail__title">${escapeHtml(c.name)}</h1>
      <div class="detail__meta-grid">
        <div><span class="detail__meta-k">总部</span><span class="detail__meta-v">${escapeHtml(c.hq_company)}</span></div>
        ${c.hq_stock ? `<div><span class="detail__meta-k">股票</span><span class="detail__meta-v">${escapeHtml(c.hq_stock)}</span></div>` : ''}
        <div><span class="detail__meta-k">股权关系</span><span class="detail__meta-v">${escapeHtml(c.relation)}</span></div>
        <div><span class="detail__meta-k">桂林地址</span><span class="detail__meta-v">${escapeHtml(c.guilin_address ?? '未公开')}</span></div>
        <div><span class="detail__meta-k">成立</span><span class="detail__meta-v">${escapeHtml(c.established ?? '未公开')}</span></div>
        <div><span class="detail__meta-k">规模</span><span class="detail__meta-v">${escapeHtml(c.scale ?? '未公开')}</span></div>
      </div>
      <div class="notice notice--mixed">${renderInline(c.match_note ?? '')}</div>
    </header>

    <section class="block block--reputation">
      ${sectionHeading('工作时间与加班')}
      <div class="rep-warn">
        <span class="rep-warn__icon">⚠</span>
        <span>这一栏只写「可查证」的信息。写「无公开表述」就是真的没查到，不是没查。</span>
      </div>
      <div class="rep-card">
        <div class="rep-card__head">
          ${badge(wt.evidence_level === 'official_claim' ? '企业自述' : '无公开信息',
            wt.evidence_level === 'official_claim' ? 'warn' : 'muted')}
        </div>
        <p class="rep-card__verdict">${renderInline(wt.claim ?? '无公开表述')}</p>
        ${wt.source ? `<p class="rep-card__src">来源：${escapeHtml(wt.source)}</p>` : ''}
        ${wt.note ? `<p class="rep-card__detail">${renderInline(wt.note)}</p>` : ''}
      </div>
    </section>

    ${
      (c.benefits ?? []).length
        ? `<section class="block">
            ${sectionHeading('福利清单', c.benefits.length)}
            <ul class="datalist">${c.benefits.map((b) => `<li>${renderInline(b)}</li>`).join('')}</ul>
          </section>`
        : ''
    }

    ${
      (c.open_roles ?? []).length
        ? `<section class="block">
            ${sectionHeading('在招岗位', c.open_roles.length)}
            <div class="rolegrid">
              ${c.open_roles
                .map(
                  (r) => `<div class="rolecard">
                    <div class="rolecard__title">${escapeHtml(r.title)}</div>
                    <div class="rolecard__salary">${escapeHtml(r.salary)}</div>
                    <div class="rolecard__meta">${escapeHtml(r.req)}</div>
                    <div class="rolecard__focus">${escapeHtml(r.focus)}</div>
                  </div>`
                )
                .join('')}
            </div>
          </section>`
        : ''
    }

    ${c.interview_hint ? `<section class="block">
        ${sectionHeading('面试考察重点')}
        <div class="notice notice--mixed">${renderInline(c.interview_hint)}</div>
      </section>` : ''}

    ${c.risk_note ? `<section class="block">
        ${sectionHeading('风险提示')}
        <div class="notice notice--warn">${renderInline(c.risk_note)}</div>
      </section>` : ''}

    ${c.tips ? `<section class="block">
        ${sectionHeading('投递建议')}
        <div class="notice notice--ok">${renderInline(c.tips)}</div>
      </section>` : ''}

    ${
      (c.sources ?? []).length
        ? `<div class="rep-sources">
            <span class="rep-sources__label">信息来源</span>
            ${c.sources
              .map(
                (s) => `<a class="rep-sources__item" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">
                  ${escapeHtml(s.type)} ↗
                </a>`
              )
              .join('')}
          </div>`
        : ''
    }
  </article>`;
}
