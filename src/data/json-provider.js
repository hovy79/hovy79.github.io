/**
 * JsonProvider：从静态 JSON 文件加载数据。
 *
 * 部署要点（这是本文件最容易被部署环境坑到的两处）：
 *
 * 1. 数据基准锚定在「模块自身所在位置」而不是「当前文档 URL」。
 *    若以文档 URL 为基准，站点部署在无尾斜杠的子路径（如
 *    https://example.com/apps/tool）时，浏览器会把 data/x.json 解析成
 *    /apps/data/x.json 而非 /apps/tool/data/x.json，导致 404。
 *    用 import.meta.url 向上退两级（src/data/ → 站点根）即与部署路径无关。
 *
 * 2. 因此本 Provider 对以下部署形态都不敏感：
 *      根路径        https://example.com/
 *      子目录        https://example.com/apps/tool/
 *      子目录无斜杠  https://example.com/apps/tool   （服务器通常 301 到带斜杠形式）
 *      CDN 子域      https://cdn.example.com/static/v1/
 *
 * 覆盖顺序：显式 options.baseUrl > <meta name="eh-data-base"> > 模块自动推导。
 */

import { assertProvider } from './provider.js';

/**
 * 默认路径。
 *
 * knowledge / questions 为 null 表示「由 data/manifest.json 决定」——
 * 新增内容文件只需要改 manifest，不用改代码，也不会漏改校验器的清单。
 */
const DEFAULT_PATHS = {
  taxonomy: 'data/taxonomy.json',
  sources: 'data/sources.json',
  parts: 'data/parts.json',
  manifest: 'data/manifest.json',
  knowledge: null,
  questions: null,
  companies: null,
  projects: null,
  reputation: null
};

/** manifest 加载失败时的兜底（保证老站点仍能跑） */
const FALLBACK_FILES = {
  knowledge: ['data/knowledge/hardware.json', 'data/knowledge/embedded.json'],
  questions: ['data/questions/hardware.json', 'data/questions/embedded.json'],
  companies: [],
  projects: ['data/projects.json'],
  reputation: ['data/reputation.json']
};

/**
 * 从模块 URL 推导站点根。
 *
 * 不能用 `new URL('../../', moduleUrl)`：URL 解析会先规范化，把 `..` 吃到域名根，
 * 在子目录部署时结果会错误地退回到域名根。因此显式按路径段截断。
 *
 * json-provider.js 位于 <站点根>/src/data/json-provider.js，需要去掉 3 段
 * （文件名 + data + src）才回到站点根。
 *
 * @param {string} moduleHref
 * @returns {string} 始终以 / 结尾
 */
function deriveSiteRoot(moduleHref) {
  const url = new URL(moduleHref);
  const segments = url.pathname.split('/').filter(Boolean); // 去掉空段
  // 去掉 json-provider.js、data、src
  const rootSegments = segments.slice(0, Math.max(0, segments.length - 3));
  url.pathname = `/${rootSegments.join('/')}${rootSegments.length ? '/' : ''}`;
  url.search = '';
  url.hash = '';
  return url.href;
}

/** json-provider.js 位于 <站点根>/src/data/，因此向上三级即站点根 */
const SITE_ROOT = deriveSiteRoot(import.meta.url);

/**
 * 解析数据基准 URL（语义为**站点根**，数据文件路径由 paths 追加）。
 * 始终返回以 / 结尾的绝对 URL，可直接用于 new URL(p, base)。
 *
 * 覆盖顺序：显式 options.baseUrl > <meta name="eh-data-base"> > 模块自动推导。
 * 注意：meta 的值应指向站点根，而不是 data/ 目录本身。
 * @returns {string}
 */
export function resolveDataBaseUrl(explicit) {
  if (explicit) {
    return new URL(explicit, SITE_ROOT).href.replace(/\/*$/, '/');
  }

  const meta = globalThis.document?.querySelector?.('meta[name="eh-data-base"]');
  const fromMeta = meta?.getAttribute('content')?.trim();
  if (fromMeta) {
    return new URL(fromMeta, SITE_ROOT).href.replace(/\/*$/, '/');
  }

  return SITE_ROOT;
}

/**
 * @param {{ baseUrl?: string, paths?: Partial<typeof DEFAULT_PATHS> }} [options]
 */
export function createJsonProvider(options = {}) {
  const baseUrl = resolveDataBaseUrl(options.baseUrl);
  const paths = { ...DEFAULT_PATHS, ...(options.paths ?? {}) };
  const cache = new Map();

  const resolve = (p) => new URL(p, baseUrl).href;

  async function fetchJson(path) {
    if (cache.has(path)) return cache.get(path);
    const url = resolve(path);
    let res;
    try {
      res = await fetch(url, { cache: 'no-cache' });
    } catch (cause) {
      // 网络层失败：file:// 协议、离线、CORS 被拒都会落到这里
      throw new Error(
        `无法请求 ${url}（${cause?.message ?? cause}）。` +
          `请通过 HTTP(S) 访问本站点：file:// 协议下浏览器会拦截 ES 模块与 JSON 请求。`
      );
    }
    if (!res.ok) {
      throw new Error(`加载失败 ${url}：HTTP ${res.status} ${res.statusText ?? ''}`.trim());
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new Error(
        `JSON 解析失败 ${url}：${err.message}。` +
          `若服务器返回了 HTML（如自定义 404 页），通常说明该文件未随站点一起部署。`
      );
    }
    cache.set(path, data);
    return data;
  }

  async function fetchMerged(list, key) {
    const docs = await Promise.all(list.map((p) => fetchJson(p)));
    const merged = [];
    for (const doc of docs) {
      const rows = doc?.[key];
      if (!Array.isArray(rows)) {
        throw new Error(`数据文件缺少数组字段 "${key}"`);
      }
      merged.push(...rows);
    }
    return merged;
  }

  /**
   * 内容文件清单。
   *
   * 优先读 data/manifest.json；读取失败（例如老站点没有这个文件）时退回
   * 内置的最小清单，保证站点仍能启动而不是白屏。
   *
   * 缓存 promise 而不是结果：并发调用 loadKnowledge()/loadQuestions()
   * 时只会请求一次 manifest。
   */
  let manifestPromise = null;
  function loadManifest() {
    if (!manifestPromise) {
      manifestPromise = (async () => {
        try {
          const doc = await fetchJson(paths.manifest);
          return {
            knowledge: Array.isArray(doc?.knowledge) ? doc.knowledge : FALLBACK_FILES.knowledge,
            questions: Array.isArray(doc?.questions) ? doc.questions : FALLBACK_FILES.questions,
            companies: Array.isArray(doc?.companies) ? doc.companies : FALLBACK_FILES.companies,
            projects: Array.isArray(doc?.projects) ? doc.projects : FALLBACK_FILES.projects,
            reputation: Array.isArray(doc?.reputation) ? doc.reputation : FALLBACK_FILES.reputation
          };
        } catch {
          return { ...FALLBACK_FILES };
        }
      })();
    }
    return manifestPromise;
  }

  /** 实际加载过的文件数，加载后由 describe() 报告真实值 */
  let loadedCounts = null;

  const provider = {
    id: 'json-static',
    baseUrl,
    describe() {
      // 加载前只知道清单文件本身；加载后报告真实文件数，
      // 避免页脚出现「2+ 个知识文件」这种容易误读的占位数字。
      if (loadedCounts) {
        const parts = [`${loadedCounts.knowledge} 个知识文件`, `${loadedCounts.questions} 个题库文件`];
        if (loadedCounts.companies) parts.push(`${loadedCounts.companies} 个公司档案文件`);
        return `静态 JSON 数据源（${parts.join('、')}，清单见 data/manifest.json）`;
      }
      return '静态 JSON 数据源（清单见 data/manifest.json）';
    },
    loadTaxonomy() {
      return fetchJson(paths.taxonomy);
    },
    loadSources() {
      return fetchJson(paths.sources);
    },
    /**
     * 器件登记是可选数据：文件不存在时返回空表而不是抛错，
     * 这样老站点（未升级数据）也能继续跑，只是不显示型号来源。
     */
    async loadParts() {
      try {
        return await fetchJson(paths.parts);
      } catch (e) {
        if (/HTTP 404/.test(String(e?.message ?? ''))) {
          return { schema_version: '1.0.0', parts: [] };
        }
        throw e;
      }
    },
    async loadKnowledge() {
      const files = paths.knowledge ?? (await loadManifest()).knowledge;
      loadedCounts = { ...(loadedCounts ?? { questions: 0 }), knowledge: files.length };
      return fetchMerged(files, 'items');
    },
    async loadQuestions() {
      const files = paths.questions ?? (await loadManifest()).questions;
      loadedCounts = { ...(loadedCounts ?? { knowledge: 0 }), questions: files.length };
      return fetchMerged(files, 'questions');
    },
    /**
     * 公司档案（可选数据）。文件不存在或清单为空时返回空数组，
     * 老站点没有这份数据也能正常跑，只是「目标公司」模块为空。
     */
    async loadCompanies() {
      const files = paths.companies ?? (await loadManifest()).companies;
      if (!files.length) return [];
      loadedCounts = { ...(loadedCounts ?? { knowledge: 0, questions: 0 }), companies: files.length };
      return fetchMerged(files, 'companies');
    },
    /** 公司口碑（可选） */
    async loadReputation() {
      const files = paths.reputation ?? (await loadManifest()).reputation;
      if (!files || !files.length) return [];
      return fetchMerged(files, 'reputation');
    },

    /** 开源项目库（可选） */
    async loadProjects() {
      const files = paths.projects ?? (await loadManifest()).projects;
      if (!files || !files.length) return [];
      return fetchMerged(files, 'projects');
    }
  };

  return assertProvider(provider);
}
