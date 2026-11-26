/**
 * 应用引导：装配数据 → 建立路由 → 渲染 → 绑定事件。
 *
 * 状态来源有三个，职责分明：
 *   1. URL hash 中的 filters   → 可分享、可回退的筛选与抽题序列
 *   2. progress store          → 掌握状态与作答记录
 *   3. repository              → 只读内容
 *
 * 渲染是「整页重绘」，因为数据量在原型阶段很小；换大数据源时只需把
 * render() 内部改成局部更新，事件委托已经按 data-* 解耦，不必重写。
 */

import { bootstrapData, NeedPasswordError, BadPasswordError } from './data/index.js';
import { createRouter, parseHash } from './core/router.js';
import { createProgressStore } from './core/progress.js';
import { escapeHtml } from './core/markdown.js';
import { isAnswerCorrect, buildPracticeSet } from './core/grading.js';
import { renderShell, renderSourceNotice, renderFooter } from './views/shell.js';
import { renderKnowledgeList, renderKnowledgeDetail } from './views/knowledge.js';
import { renderDrillList, renderDrillDetail, resolvePracticeSet } from './views/drill.js';
import { renderReview } from './views/review.js';
import { renderCompanyList, renderCompanyDetail } from './views/company.js';
import { renderAbout } from './views/about.js';

const MODULE_FOR_ROUTE = {
  'kb-list': 'kb',
  'kb-detail': 'kb',
  'drill-list': 'drill',
  'drill-detail': 'drill',
  review: 'review',
  'company-list': 'company',
  'company-detail': 'company',
  about: 'about'
};

const DEFAULT_DOMAIN = 'hardware';

/**
 * 口令缓存的 localStorage 键。
 *
 * 存口令本身有风险（同源脚本可读），但本站没有第三方脚本、也不上报任何数据，
 * 权衡下来「不用每次打开都输口令」的收益更大。用户可以在数据说明页清除。
 */
const UNLOCK_KEY = 'eh-interview-drill/unlock/v1';

function readCachedPassword() {
  try {
    const raw = globalThis.localStorage?.getItem(UNLOCK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.password === 'string' ? parsed.password : null;
  } catch {
    return null;
  }
}

function writeCachedPassword(password) {
  try {
    globalThis.localStorage?.setItem(
      UNLOCK_KEY,
      JSON.stringify({ password, savedAt: new Date().toISOString() })
    );
  } catch {
    /* 隐私模式等情况，忽略 */
  }
}

function clearCachedPassword() {
  try {
    globalThis.localStorage?.removeItem(UNLOCK_KEY);
  } catch {
    /* ignore */
  }
}

/** 渲染口令输入界面，返回用户输入的口令（或 null） */
function renderUnlockScreen(appEl, { message = '', canRetry = true } = {}) {
  return new Promise((resolve) => {
    appEl.innerHTML = `
      <div class="unlock">
        <div class="unlock__card">
          <div class="unlock__mark">HW<span>/</span>EM</div>
          <h1 class="unlock__title">嵌入式硬件工程师知识题库</h1>
          <p class="unlock__desc">
            本站内容已加密。输入访问口令后可解锁全部知识点、题库与目标公司档案。
          </p>
          <form class="unlock__form" id="unlock-form" autocomplete="on">
            <label class="unlock__label" for="unlock-input">访问口令</label>
            <input class="unlock__input" id="unlock-input" type="password"
              autocomplete="current-password" placeholder="请输入口令"
              ${canRetry ? '' : 'disabled'} />
            <label class="unlock__remember">
              <input type="checkbox" id="unlock-remember" checked />
              在这台设备上记住（下次不用再输）
            </label>
            <div class="unlock__msg" id="unlock-msg" role="alert">${escapeHtml(message)}</div>
            <button class="btn btn--primary unlock__submit" type="submit" ${canRetry ? '' : 'disabled'}>
              解锁
            </button>
          </form>
          <p class="unlock__hint">
            口令由维护者设置。忘记口令可重新运行 <code>npm run encrypt</code> 生成新口令，
            但这会更换本站的访问凭据。
          </p>
        </div>
      </div>`;

    const input = appEl.querySelector('#unlock-input');
    const remember = appEl.querySelector('#unlock-remember');
    const msg = appEl.querySelector('#unlock-msg');
    const form = appEl.querySelector('#unlock-form');

    input?.focus();

    form?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const value = input?.value?.trim();
      if (!value) {
        if (msg) msg.textContent = '请输入口令';
        return;
      }
      if (remember?.checked) writeCachedPassword(value);
      resolve(value);
    });
  });
}

async function main() {
  const appEl = document.getElementById('app');
  const progress = createProgressStore();

  let repo;
  let providerInfo;
  let boot;
  try {
    // 先试缓存的口令（如果有）
    const cached = readCachedPassword();
    try {
      boot = await bootstrapData(cached ? { password: cached } : {});
    } catch (e) {
      if (e?.code !== 'NEED_PASSWORD' && e?.code !== 'BAD_PASSWORD') throw e;

      // 需要口令：循环直到成功（或用户一直输错）
      let errMsg = cached ? '已保存的口令失效，请重新输入' : '';
      for (;;) {
        const pwd = await renderUnlockScreen(appEl, { message: errMsg });
        try {
          boot = await bootstrapData({ password: pwd });
          break;
        } catch (retryErr) {
          if (retryErr?.code === 'BAD_PASSWORD') {
            errMsg = '口令不正确，请重试';
            continue;
          }
          if (retryErr?.code === 'NEED_PASSWORD') {
            errMsg = '请输入口令';
            continue;
          }
          throw retryErr;
        }
      }
    }

    repo = boot.repository;
    providerInfo = {
      id: repo.providerId,
      description: repo.providerDescription,
      baseUrl: boot.provider.baseUrl ?? null
    };
  } catch (err) {
    const isFileProtocol = globalThis.location?.protocol === 'file:';
    appEl.innerHTML = `<div class="boot-error">
      <h1>数据加载失败</h1>
      <p class="boot-error__msg">${escapeHtml(String(err?.message ?? err))}</p>
      <h2>排查步骤</h2>
      <ol>
        <li><b>是否用 file:// 直接打开？</b> 浏览器会拦截 ES 模块与 JSON 请求。
            必须通过 HTTP(S) 访问本页面（本地预览、内网静态服务器或公网托管均可）。
            ${isFileProtocol ? '<br><b>当前页面正是 file:// 协议。</b>' : ''}</li>
        <li><b>data/ 目录是否随站点一起部署？</b>
            页面需要 <code>data/taxonomy.json</code>、<code>data/sources.json</code>、
            <code>data/knowledge/*.json</code>、<code>data/questions/*.json</code> 全部就位。</li>
        <li><b>服务器是否返回了 HTML 而非 JSON？</b>
            某些托管平台对 404 返回自定义页面；若 JSON 解析报错，通常是文件缺失或路径不对。</li>
        <li><b>部署在子目录下？</b> 数据基准默认自动推导为站点根，无需配置。
            若站点根无法被自动推导（例如通过非常规方式嵌入），在
            <code>index.html</code> 的 <code>&lt;head&gt;</code> 中把它指向站点根：
            <br><code>&lt;meta name="eh-data-base" content="/your/site-root/" /&gt;</code>
            <br>注意该值指向<b>站点根</b>，不是 <code>data/</code> 目录。</li>
      </ol>
    </div>`;
    return;
  }

  const counts = repo.counts();
  let currentRoute = parseHash(globalThis.location.hash);

  const router = createRouter((route) => {
    currentRoute = route;
    render(route);
  });

  /** 当前路由应展示哪个分区；URL 没给就沿用另一个模块记住的分区，最后退回默认 */
  function resolveDomain(route) {
    const fromUrl = route.filters.domain;
    if (fromUrl && repo.domain(fromUrl)) return fromUrl;
    const isDrill = route.name.startsWith('drill');
    const primary = progress.getFilters(isDrill ? 'drill' : 'kb').domain;
    if (primary && repo.domain(primary)) return primary;
    // 跨模块延续：在知识库选了嵌入式，切到刷题也应停在嵌入式
    const secondary = progress.getFilters(isDrill ? 'kb' : 'drill').domain;
    if (secondary && repo.domain(secondary)) return secondary;
    return DEFAULT_DOMAIN;
  }

  /** 当前分区的题目 id 集合，用于把统计口径限定在本分区 */
  function domainQuestionIds(domainId) {
    return new Set(repo.listQuestions({ domain: domainId }).map((q) => q.id));
  }

  function render(route) {
    const moduleKey = MODULE_FOR_ROUTE[route.name] ?? 'kb';
    const activeDomain = resolveDomain(route);

    // 记住分区选择，两个模块共享同一分区，避免来回切换时上下文丢失
    progress.setFilters(moduleKey === 'drill' ? 'drill' : 'kb', { domain: activeDomain });
    progress.setFilters(moduleKey === 'drill' ? 'kb' : 'drill', { domain: activeDomain });

    // 统计口径：知识库/刷题/薄弱点按当前分区算（与页面内容一致）；
    // 目标公司与数据说明页与分区无关，用全库口径，否则数字和页面内容对不上。
    const statsScopedToDomain = moduleKey === 'kb' || moduleKey === 'drill' || moduleKey === 'review';

    const ctx = {
      repo,
      progress,
      filters: route.filters,
      activeDomain,
      counts,
      stats: statsScopedToDomain
        ? progress.stats({ ids: domainQuestionIds(activeDomain) })
        : progress.stats(),
      providerInfo
    };

    let content = '';
    switch (route.name) {
      case 'kb-list':
        content = renderKnowledgeList(ctx);
        break;
      case 'kb-detail':
        content = renderKnowledgeDetail({ ...ctx, item: repo.knowledgeItem(route.id) });
        break;
      case 'drill-list':
        content = renderDrillList(ctx);
        break;
      case 'drill-detail':
        content = renderDrillDetail({ ...ctx, question: repo.questionItem(route.id) });
        break;
      case 'review':
        content = renderReview(ctx);
        break;
      case 'company-list':
        content = renderCompanyList(ctx);
        break;
      case 'company-detail':
        content = renderCompanyDetail({ ...ctx, company: repo.company(route.id) });
        break;
      case 'about':
        content = renderAbout(ctx);
        break;
      default:
        content = `<div class="empty"><div class="empty__title">页面不存在</div>
          <div class="empty__hint"><a href="#/kb">返回知识库</a></div></div>`;
    }

    appEl.innerHTML = `
      ${renderShell({ ...ctx, activeModule: moduleKey })}
      <main class="main">
        ${route.name === 'about' ? '' : renderSourceNotice(repo)}
        ${content}
      </main>
      ${renderFooter(providerInfo)}
    `;

    // 详情页滚动到顶部，列表页保留位置会让人困惑
    if (route.name.endsWith('-detail')) {
      globalThis.scrollTo({ top: 0, behavior: 'instant' in globalThis ? 'instant' : 'auto' });
    }
  }

  /** 进入随机练习：按权重抽一次，把结果冻结进 URL */
  function startPractice({ count = 20, wrongOnly = false } = {}) {
    const filters = currentRoute.filters;
    const domain = resolveDomain(currentRoute);

    let pool = repo.listQuestions({
      domain,
      category: filters.category,
      difficulty: filters.difficulty,
      type: filters.type,
      query: filters.query
    });

    if (wrongOnly) {
      pool = pool.filter((q) => {
        const st = progress.getMastery(q.id);
        const ans = progress.getAnswer(q.id);
        return st === 'wrong' || st === 'review' || ans?.correct === false;
      });
      if (pool.length === 0) {
        globalThis.alert('当前分区还没有错题或需复习的题目，先做几题吧。');
        return;
      }
    }

    if (pool.length === 0) {
      globalThis.alert('当前筛选条件下没有题目。');
      return;
    }

    // 抽一次就固定下来。之后作答改变了掌握状态也不会影响这套题的组成，
    // 否则「下一题」会在用户答完题后突然消失。
    const picked = buildPracticeSet(pool, {
      masteryOf: (id) => progress.getMastery(id),
      size: Math.min(count, pool.length),
      seed: Date.now() % 1000000
    });

    const params = new URLSearchParams();
    params.set('domain', domain);
    for (const k of ['category', 'difficulty', 'type', 'query']) {
      if (filters[k]) params.set(k, String(filters[k]));
    }
    params.set('n', String(picked.length));
    params.set('set', picked.map((q) => q.id).join(','));
    globalThis.location.hash = `#/drill?${params.toString()}`;
  }

  /**
   * 当前路由对应的「上一级」列表地址。
   * 详情页返回列表，列表页没有上一级（返回 null）。
   */
  function backTarget(route) {
    switch (route.name) {
      case 'kb-detail':
        return '#/kb';
      case 'drill-detail':
        return '#/drill';
      case 'company-detail':
        return '#/company';
      default:
        return null;
    }
  }

  /** 跳到练习序列里的下一题（最后一题则回列表） */
  function gotoNextInSet() {
    const route = currentRoute;
    if (route.name !== 'drill-detail' || !route.id) return false;
    const domain = resolveDomain(route);
    const set = resolvePracticeSet(repo, route.filters, domain, progress);
    if (!Array.isArray(set) || set.length === 0) return false;
    const idx = set.findIndex((q) => q.id === route.id);
    if (idx < 0) return false;
    const params = new URLSearchParams();
    for (const k of ['domain', 'category', 'difficulty', 'type', 'query', 'practice', 'n', 'set']) {
      if (route.filters[k]) params.set(k, String(route.filters[k]));
    }
    const qs = params.toString();
    if (idx < set.length - 1) {
      globalThis.location.hash = `#/drill/${encodeURIComponent(set[idx + 1].id)}${qs ? `?${qs}` : ''}`;
    } else {
      globalThis.location.hash = qs ? `#/drill?${qs}` : '#/drill';
    }
    return true;
  }

  // ---------- 事件委托 ----------

  appEl.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    // 分区切换
    const domainTab = target.closest('[data-domain-tab]');
    if (domainTab) {
      const domainId = domainTab.getAttribute('data-domain-tab');
      const moduleTarget = domainTab.getAttribute('data-module-target');
      const routeName = moduleTarget === 'drill' ? 'drill-list' : 'kb-list';
      progress.setFilters(moduleTarget === 'drill' ? 'drill' : 'kb', { domain: domainId });
      router.navigate(routeName, { filters: { domain: domainId } });
      return;
    }

    // 开始随机练习
    const practiceBtn = target.closest('[data-action="start-practice"]');
    if (practiceBtn) {
      startPractice({
        count: Number(practiceBtn.getAttribute('data-count')) || 20,
        wrongOnly: practiceBtn.getAttribute('data-wrong') === '1'
      });
      return;
    }

    // 筛选按钮（分类/难度/题型）
    const filterBtn = target.closest('[data-filter]');
    if (filterBtn) {
      const name = filterBtn.getAttribute('data-filter');
      const value = filterBtn.getAttribute('data-value');
      const next = { ...currentRoute.filters };
      if (!value) delete next[name];
      else next[name] = value;
      // 换分类时清掉题型筛选：题型只属于刷题页，跨页残留会让人误以为没数据
      if (name === 'category') delete next.type;
      // 换任何筛选都回到第一页，否则可能停在一个空页上
      delete next.page;
      router.setFilters(next);
      return;
    }

    // 掌握状态（知识点与题目共用同一套状态机）
    const masteryBtn = target.closest('[data-mastery]');
    if (masteryBtn) {
      const ref = masteryBtn.getAttribute('data-mastery');
      const state = masteryBtn.getAttribute('data-state');
      const id = ref.split(':').slice(1).join(':');
      progress.setMastery(id, state);
      render(currentRoute);
      return;
    }

    // 选项选择
    const optionBtn = target.closest('[data-option]');
    if (optionBtn && !optionBtn.hasAttribute('disabled')) {
      const qid = optionBtn.getAttribute('data-question');
      const key = optionBtn.getAttribute('data-option');
      const q = repo.questionItem(qid);
      if (!q) return;
      const existing = progress.getAnswer(qid);
      const current = new Set(existing?.choice ?? []);
      if (q.type === 'multi') {
        if (current.has(key)) current.delete(key);
        else current.add(key);
      } else {
        current.clear();
        current.add(key);
      }
      progress.setAnswer(qid, {
        choice: [...current].sort(),
        correct: null,
        reveal: false
      });
      render(currentRoute);
      return;
    }

    // 提交答案
    const submitBtn = target.closest('[data-action="submit-answer"]');
    if (submitBtn) {
      const qid = submitBtn.getAttribute('data-question');
      const q = repo.questionItem(qid);
      const answer = progress.getAnswer(qid);
      if (!q || !answer) return;
      const correct = isAnswerCorrect(q, answer.choice);
      progress.recordAttempt(qid, { correct, choice: answer.choice });
      // 闭环：答对升「已掌握」，答错进「错题」。
      // 旧版只处理了答错，导致「已掌握」永远是 0。
      progress.setMastery(qid, correct ? 'mastered' : 'wrong');
      render(currentRoute);
      return;
    }

    // 主观题：展开解析
    const revealBtn = target.closest('[data-action="reveal-answer"]');
    if (revealBtn) {
      const qid = revealBtn.getAttribute('data-question');
      const existing = progress.getAnswer(qid);
      progress.setAnswer(qid, {
        choice: existing?.choice ?? [],
        correct: existing?.correct ?? null,
        reveal: true
      });
      render(currentRoute);
      return;
    }

    // 收起解析
    const hideBtn = target.closest('[data-action="hide-answer"]');
    if (hideBtn) {
      const qid = hideBtn.getAttribute('data-question');
      progress.setAnswer(qid, { reveal: false });
      render(currentRoute);
      return;
    }

    // 自评
    const selfGrade = target.closest('[data-action="self-grade"]');
    if (selfGrade) {
      const qid = selfGrade.getAttribute('data-question');
      const correct = selfGrade.getAttribute('data-correct') === 'true';
      progress.recordAttempt(qid, {
        correct,
        choice: progress.getAnswer(qid)?.choice ?? []
      });
      progress.setMastery(qid, correct ? 'mastered' : 'wrong');
      render(currentRoute);
      return;
    }

    // 重做
    const retryBtn = target.closest('[data-action="retry"]');
    if (retryBtn) {
      const qid = retryBtn.getAttribute('data-question');
      progress.clearAnswer(qid);
      progress.setMastery(qid, 'unseen');
      render(currentRoute);
      return;
    }

    // 导出进度
    const exportBtn = target.closest('[data-action="export-progress"]');
    if (exportBtn) {
      exportProgress();
      return;
    }

    // 导入进度
    const importBtn = target.closest('[data-action="import-progress"]');
    if (importBtn) {
      const input = document.getElementById('progress-file');
      input?.click();
      return;
    }

    // 清除已保存的口令
    const forgetBtn = target.closest('[data-action="forget-unlock"]');
    if (forgetBtn) {
      clearCachedPassword();
      globalThis.alert('已清除保存的口令。下次打开本站需要重新输入。');
      globalThis.location.reload();
      return;
    }

    // 清空进度
    const resetBtn = target.closest('[data-action="reset-progress"]');
    if (resetBtn) {
      if (globalThis.confirm('确定清空全部掌握状态与作答记录？此操作不可撤销，建议先导出备份。')) {
        progress.reset();
        render(currentRoute);
      }
      return;
    }

    // 薄弱点页里的「跳到知识点」链接不应触发整卡跳转
    const stopNav = target.closest('[data-stop-nav]');
    if (stopNav) {
      event.stopPropagation();
      return;
    }

    // 含内部链接的卡片用 div + data-href 实现（<a> 不能嵌套 <a>）
    const hrefCard = target.closest('[data-href]');
    if (hrefCard) {
      const href = hrefCard.getAttribute('data-href');
      if (href) globalThis.location.hash = href;
      return;
    }
  });

  function exportProgress() {
    const data = progress.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `刷题进度备份-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importProgress(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('文件内容不是合法的进度 JSON');
      const merge = globalThis.confirm(
        '合并导入？\n\n确定 = 与现有进度合并（同题目取较新的记录）\n取消 = 覆盖现有进度'
      );
      const r = progress.importAll(parsed, { merge });
      globalThis.alert(`导入完成：新增/更新 ${r.imported} 条${r.skipped ? `，跳过 ${r.skipped} 条较旧记录` : ''}。`);
      render(currentRoute);
    } catch (e) {
      globalThis.alert(`导入失败：${e.message}`);
    }
  }

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'progress-file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  document.body.appendChild(fileInput);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) importProgress(file);
    fileInput.value = '';
  });

  // 键盘可达性：role=link 的卡片支持 Enter / Space
  appEl.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = /** @type {HTMLElement} */ (event.target);
    const hrefCard = target.closest('[data-href]');
    if (!hrefCard || target.closest('[data-stop-nav]')) return;
    event.preventDefault();
    const href = hrefCard.getAttribute('data-href');
    if (href) globalThis.location.hash = href;
  });

  // 全局快捷键：连续刷题时不必去够鼠标
  document.addEventListener('keydown', (event) => {
    // 输入框内不拦截
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    // Backspace 或 Alt+← 返回上一级列表（与浏览器后退不同：不会离开本站）
    if (event.key === 'Backspace' || (event.altKey && event.key === 'ArrowLeft')) {
      const back = backTarget(currentRoute);
      if (back) {
        globalThis.location.hash = back;
        event.preventDefault();
      }
      return;
    }

    if (event.key === 'ArrowRight' || event.key === 'n') {
      if (gotoNextInSet()) event.preventDefault();
      return;
    }
    if (currentRoute.name === 'drill-detail') {
      const q = repo.questionItem(currentRoute.id);
      if (!q) return;
      // 1-9 选择选项
      if (/^[1-9]$/.test(event.key) && q.options.length > 0) {
        const opt = q.options[Number(event.key) - 1];
        if (opt) {
          const existing = progress.getAnswer(q.id);
          const cur = new Set(existing?.choice ?? []);
          if (q.type === 'multi') {
            if (cur.has(opt.key)) cur.delete(opt.key);
            else cur.add(opt.key);
          } else {
            cur.clear();
            cur.add(opt.key);
          }
          progress.setAnswer(q.id, { choice: [...cur].sort(), correct: null, reveal: false });
          render(currentRoute);
          event.preventDefault();
        }
        return;
      }
      // Enter 提交
      if (event.key === 'Enter') {
        const answer = progress.getAnswer(q.id);
        if (!answer || answer.choice.length === 0) return;
        if (answer.correct !== null && answer.reveal) return;
        const correct = isAnswerCorrect(q, answer.choice);
        progress.recordAttempt(q.id, { correct, choice: answer.choice });
        progress.setMastery(q.id, correct ? 'mastered' : 'wrong');
        render(currentRoute);
        event.preventDefault();
      }
    }
  });

  // 搜索输入（防抖，避免每个字符都触发整页重绘）
  let searchTimer = null;
  appEl.addEventListener('input', (event) => {
    const input = /** @type {HTMLElement} */ (event.target);
    if (!(input instanceof HTMLInputElement) || !input.hasAttribute('data-search')) return;
    const value = input.value;
    const field = input.getAttribute('data-search');
    globalThis.clearTimeout(searchTimer);
    searchTimer = globalThis.setTimeout(() => {
      const next = { ...currentRoute.filters };
      if (value.trim()) next.query = value.trim();
      else delete next.query;
      delete next.page;
      router.setFilters(next);
      // 保持焦点与光标位置
      const again = appEl.querySelector(`[data-search="${field}"]`);
      if (again instanceof HTMLInputElement) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    }, 220);
  });

  // 订阅进度变化：跨标签页/跨组件时保持顶部统计同步
  progress.subscribe(() => {
    /* 目前所有变更都由本文件的 render() 触发；保留订阅点便于将来局部更新 */
  });

  router.start();
}

main();
