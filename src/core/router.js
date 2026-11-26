/**
 * Hash 路由。
 *
 * 路由形态：
 *   #/kb                        知识库列表
 *   #/kb/:id                    知识条目详情
 *   #/drill                     刷题列表
 *   #/drill/:id                 单题作答
 *   #/review                    薄弱点 / 错题中心
 *   #/company                   目标公司列表（求职向）
 *   #/company/:id               单个公司的岗位要求 + 推荐项目 + 面试问答
 *   #/projects                  开源项目库（可复刻的真实仓库）
 *   #/projects/:id              单个项目的资料与复刻步骤
 *   #/about                     数据来源与可信度说明
 *
 * 查询参数统一解析为 filters，避免每个视图各自解析字符串。
 *
 * 抽题序列用 `practice=<seed>&n=<size>` 表达：seed 决定抽到的题集，
 * 因此「随机练习」的链接可分享、刷新不变、前进后退也一致——
 * 纯随机状态放在内存里做不到这几点。
 */

const FILTER_KEYS = [
  'domain',
  'category',
  'difficulty',
  'query',
  'type',
  'focus',
  'practice',
  'n',
  'set',
  'page'
];

const ROUTES = [
  { name: 'kb-list', pattern: /^\/kb\/?$/ },
  { name: 'kb-detail', pattern: /^\/kb\/([^/]+)\/?$/ },
  { name: 'drill-list', pattern: /^\/drill\/?$/ },
  { name: 'drill-detail', pattern: /^\/drill\/([^/]+)\/?$/ },
  { name: 'review', pattern: /^\/review\/?$/ },
  { name: 'company-list', pattern: /^\/company\/?$/ },
  { name: 'company-detail', pattern: /^\/company\/([^/]+)\/?$/ },
  { name: 'projects-list', pattern: /^\/projects\/?$/ },
  { name: 'projects-detail', pattern: /^\/projects\/([^/]+)\/?$/ },
  { name: 'about', pattern: /^\/about\/?$/ }
];

export const DEFAULT_ROUTE = '#/kb';

export function parseHash(hash = globalThis.location?.hash ?? '') {
  const raw = hash.replace(/^#/, '') || '/kb';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.startsWith('/') ? pathPart : `/${pathPart}`;

  const params = new URLSearchParams(queryPart);
  const filters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }

  for (const route of ROUTES) {
    const match = route.pattern.exec(path);
    if (match) {
      return {
        name: route.name,
        id: match[1] ? decodeURIComponent(match[1]) : null,
        filters,
        path: raw
      };
    }
  }
  return { name: 'not-found', id: null, filters, path: raw };
}

export function buildHash(name, { id, filters } = {}) {
  const base = {
    'kb-list': '#/kb',
    'kb-detail': `#/kb/${encodeURIComponent(id ?? '')}`,
    'drill-list': '#/drill',
    'drill-detail': `#/drill/${encodeURIComponent(id ?? '')}`,
    review: '#/review',
    'company-list': '#/company',
    'company-detail': `#/company/${encodeURIComponent(id ?? '')}`,
    'projects-list': '#/projects',
    'projects-detail': `#/projects/${encodeURIComponent(id ?? '')}`,
    about: '#/about',
    'not-found': '#/kb'
  }[name] ?? '#/kb';

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

export function createRouter(onChange) {
  const handler = () => onChange(parseHash(globalThis.location.hash));

  globalThis.addEventListener('hashchange', handler);

  return {
    current() {
      return parseHash(globalThis.location.hash);
    },
    navigate(name, options) {
      const next = buildHash(name, options);
      if (globalThis.location.hash === next) {
        handler();
      } else {
        globalThis.location.hash = next;
      }
    },
    replace(name, options) {
      const next = buildHash(name, options);
      globalThis.history.replaceState(null, '', next);
      handler();
    },
    /** 仅更新查询参数，保留当前路径 */
    setFilters(filters) {
      const current = parseHash(globalThis.location.hash);
      const base = buildHash(current.name, { id: current.id, filters });
      if (globalThis.location.hash === base) {
        handler();
      } else {
        globalThis.location.hash = base;
      }
    },
    start() {
      if (!globalThis.location.hash) {
        globalThis.location.hash = DEFAULT_ROUTE;
      }
      handler();
    },
    dispose() {
      globalThis.removeEventListener('hashchange', handler);
    }
  };
}
