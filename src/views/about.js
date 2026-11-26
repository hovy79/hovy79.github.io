/**
 * 数据说明页：把 Schema、可信度约定与数据源边界讲清楚。
 *
 * 这一页是「严禁编造」约束的对外可见承诺：用户能在此确认每条数据的来源状态、
 * 版本号与可点击的原文链接，而不是只看到一句笼统的「未核验」。
 */

import { escapeHtml } from '../core/markdown.js';
import { badge, sectionHeading, verifiedBadge } from './components.js';

export function renderAbout(ctx) {
  const { repo, progress, providerInfo } = ctx;
  const { knowledge, questions, sources, parts } = repo.all();

  const statusCount = {};
  for (const row of [...knowledge, ...questions]) {
    statusCount[row.verified_status] = (statusCount[row.verified_status] ?? 0) + 1;
  }

  const rows = [...knowledge, ...questions];
  const total = rows.length;
  const verified = statusCount.verified ?? 0;

  return `
  <section class="panel">
    <div class="panel__head">
      ${sectionHeading('数据说明与可信度约定')}
    </div>

    <div class="notice notice--mixed">
      <strong>核验状态：</strong>
      共 ${total} 条内容，<b>${verified} 条已核验</b>（${total ? Math.round((verified / total) * 100) : 0}%），
      ${statusCount.seed_unverified ?? 0} 条为 <code>seed_unverified</code> 种子内容。
    </div>

    <p class="hint">
      <b>两种状态的区别：</b><br>
      <b>已核验</b> = 结论能落到一份真实存在的文档的具体位置（标准条款号、数据手册表格、
      教材章节），来源表里有 <code>edition</code> 或 <code>url</code>，用户可自行核对。<br>
      <b>种子未核验</b> = 由通用工程原理推导整理，结论本身可复算，但没有逐条对照原文。
      这类内容不标注具体型号参数或实测数值——那些必须有出处才能写。
    </p>

    <div class="block">
      ${sectionHeading('数据源')}
      <table class="table">
        <tbody>
          <tr><th>Provider 实现</th><td><code>${escapeHtml(providerInfo.id)}</code></td></tr>
          <tr><th>说明</th><td>${escapeHtml(providerInfo.description)}</td></tr>
          <tr><th>数据基准 URL</th><td><code>${escapeHtml(providerInfo.baseUrl ?? '（未提供）')}</code><br>
            <span class="hint">该值为站点根，数据文件路径（如 <code>data/taxonomy.json</code>）由 Provider 追加。
            部署在根目录或任意子目录都无需修改；若需自定义，在 index.html 中设置
            <code>&lt;meta name="eh-data-base"&gt;</code> 指向站点根。</span></td></tr>
          <tr><th>知识条目</th><td>${knowledge.length} 条（硬件 ${countOf(knowledge, 'hardware')} / 嵌入式 ${countOf(knowledge, 'embedded')}）</td></tr>
          <tr><th>面试题</th><td>${questions.length} 道（硬件 ${countOf(questions, 'hardware')} / 嵌入式 ${countOf(questions, 'embedded')}）</td></tr>
          <tr><th>来源登记</th><td>${sources.length} 条</td></tr>
          <tr><th>器件登记</th><td>${parts.length} 个型号（有数据手册链接才能被引用）</td></tr>
          <tr><th>本地进度</th><td>${progress.available ? 'localStorage 可用，掌握状态已持久化' : 'localStorage 不可用，本次进度不会保存'}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="block">
      ${sectionHeading('核验状态分布')}
      <div class="statusrow">
        ${repo.taxonomy.verified_statuses
          .map((s) => {
            const n = statusCount[s.id] ?? 0;
            return `<div class="statuscard">
              <div class="statuscard__head">${verifiedBadge(repo, s.id)}<span class="statuscard__count">${n}</span></div>
              <p class="statuscard__desc">${escapeHtml(s.description)}</p>
            </div>`;
          })
          .join('')}
      </div>
    </div>

    <div class="block">
      ${sectionHeading('来源登记表', sources.length)}
      <p class="hint">每条知识/题目通过 <code>source.source_id</code> 指向下表。<code>edition</code> 是版本或发布日期，<code>url</code> 可点开核对原文——这两项缺一个，这条来源就无法被追溯。</p>
      <table class="table table--sources">
        <thead>
          <tr><th>source_id</th><th>标题</th><th>类型</th><th>版本 / 日期</th><th>定位</th><th>可信度</th></tr>
        </thead>
        <tbody>
          ${sources
            .map(
              (s) => `<tr>
                <td><code>${escapeHtml(s.source_id)}</code></td>
                <td>${escapeHtml(s.title)}${s.url ? `<br><a class="source-line__link" href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">原文 ↗</a>` : ''}</td>
                <td>${badge(s.kind, 'soft')}</td>
                <td>${escapeHtml(s.edition ?? '—')}</td>
                <td>${escapeHtml(s.locator ?? '—')}</td>
                <td>${badge(s.trust, trustTone(s.trust))}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>

    ${
      parts.length
        ? `<div class="block">
            ${sectionHeading('器件登记表', parts.length)}
            <p class="hint">内容里出现具体型号时，该型号必须在此登记并附数据手册链接。校验脚本会拦截「引用了型号但没有出处」的情况。</p>
            <table class="table table--sources">
              <thead>
                <tr><th>型号</th><th>厂商</th><th>类别</th><th>数据手册</th></tr>
              </thead>
              <tbody>
                ${parts
                  .map(
                    (p) => `<tr>
                      <td><code>${escapeHtml(p.part_number)}</code></td>
                      <td>${escapeHtml(p.manufacturer)}</td>
                      <td>${badge(p.category ?? '—', 'soft')}</td>
                      <td><a class="source-line__link" href="${escapeHtml(p.datasheet_url)}" target="_blank" rel="noopener noreferrer">datasheet ↗</a></td>
                    </tr>`
                  )
                  .join('')}
              </tbody>
            </table>
          </div>`
        : ''
    }

    <div class="block">
      ${sectionHeading('接入新数据源的方式')}
      <ol class="steps steps--plain">
        <li class="step">
          <div class="step__title">实现 Provider</div>
          <p class="step__body">按 <code>src/data/provider.js</code> 的契约实现 <code>loadTaxonomy / loadSources / loadKnowledge / loadQuestions</code>（<code>loadParts</code> 可选），返回符合 Schema 的对象。</p>
        </li>
        <li class="step">
          <div class="step__title">在装配处替换</div>
          <p class="step__body">修改 <code>src/data/index.js</code> 中的 <code>createProvider()</code>，其余代码无需改动。</p>
        </li>
        <li class="step">
          <div class="step__title">运行校验</div>
          <p class="step__body">执行 <code>npm run validate</code>，检查 Schema 完整性、引用有效性、来源可追溯性与型号登记。</p>
        </li>
      </ol>
    </div>

    <div class="block">
      ${sectionHeading('口碑数据的来源与局限')}
      <p class="hint">
        关于加班时长、调休政策、双休真实性——这三项<b>公开渠道几乎查不到可靠数据</b>。
        本系统的公司页只收录「可查证」的信息，并逐条标注证据等级。渠道现状：
      </p>
      <table class="table table--sources">
        <thead><tr><th>渠道</th><th>状态</th><th>说明</th></tr></thead>
        <tbody>
          <tr><td><b>看准网</b></td><td><span class="badge badge--bad">已关服</span></td>
            <td>2024 年 9 月官方公告关服。国内最集中的加班/薪资匿名评价源，它的关服是最大数据缺口。</td></tr>
          <tr><td><b>脉脉</b></td><td><span class="badge badge--bad">需登录</span></td>
            <td>直接请求返回 HTTP 418 反爬。需登录态 + 浏览器环境。</td></tr>
          <tr><td><b>BOSS直聘</b></td><td><span class="badge badge--warn">需登录</span></td>
            <td>公司页与岗位页均跳转人机验证页。</td></tr>
          <tr><td><b>职友集</b></td><td><span class="badge badge--ok">可访问</span></td>
            <td>有薪资分布与招聘趋势，<b>但没有加班/双休评价</b>。</td></tr>
          <tr><td><b>桂林人才网</b></td><td><span class="badge badge--ok">可访问</span></td>
            <td>有面试评价模块，但每家仅 2 条左右且全是满分，参考价值有限。</td></tr>
        </tbody>
      </table>
      <p class="hint">
        <b>结论：</b>真实的工作强度只能靠<b>面试时当面问</b>，或通过内部人脉打听。
        公司页的「工作强度与口碑」区块提供的是提问线索，不是结论。
      </p>
    </div>

    <div class="block">
      ${sectionHeading('进度管理')}
      <p class="hint">进度保存在浏览器 localStorage 的 <code>eh-interview-drill/progress/v1</code> 键下。换设备、换域名或清理浏览器数据会丢失，建议定期导出备份。</p>
      <div class="progress-tools">
        <button type="button" class="btn btn--ghost" data-action="export-progress">导出进度备份</button>
        <button type="button" class="btn btn--ghost" data-action="import-progress">导入进度备份</button>
        <button type="button" class="btn btn--danger" data-action="reset-progress">清空本地进度</button>
      </div>
      <p class="hint">
        本站内容已加密，访问口令默认保存在本机浏览器（键名 <code>eh-interview-drill/unlock/v1</code>），
        方便下次直接进入。共用电脑时建议清除：
      </p>
      <div class="progress-tools">
        <button type="button" class="btn btn--ghost" data-action="forget-unlock">清除已保存口令</button>
      </div>
    </div>

    <div class="block">
      ${sectionHeading('键盘快捷键')}
      <p class="kbd-hint">
        <kbd>1</kbd>–<kbd>9</kbd> 选择选项 ·
        <kbd>Enter</kbd> 提交作答 ·
        <kbd>N</kbd> 或 <kbd>→</kbd> 下一题 ·
        <kbd>Backspace</kbd> 或 <kbd>Alt</kbd>+<kbd>←</kbd> 返回上一级
      </p>
    </div>
  </section>`;
}

function countOf(rows, domain) {
  return rows.filter((r) => r.domain === domain).length;
}

function trustTone(trust) {
  if (trust === 'high') return 'ok';
  if (trust === 'medium') return 'warn';
  return 'muted';
}
