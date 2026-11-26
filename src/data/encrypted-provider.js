/**
 * 加密版 Provider：从加密内容包加载数据。
 *
 * 与 JsonProvider 的区别只在「数据从哪来」——它同样实现 Provider 契约，
 * Repository 与所有视图完全不需要改动。这是数据层解耦的直接收益。
 *
 * 工作流程：
 *   1. 请求 data/content.enc.json（只有密文，没有明文）
 *   2. 需要口令时抛出 NeedPasswordError，由 app.js 捕获并弹出输入框
 *   3. 口令正确 → 解密 → 得到 { taxonomy, sources, parts, knowledge, questions, companies }
 *   4. 逐项返回给 Repository
 *
 * 解密结果缓存在 provider 实例上，同一会话内只解密一次。
 */

import { assertProvider } from './provider.js';
import { decryptPayload } from '../core/crypto.js';

/** 需要口令时抛出，app.js 据此显示输入界面 */
export class NeedPasswordError extends Error {
  constructor(message = '需要访问口令') {
    super(message);
    this.name = 'NeedPasswordError';
    this.code = 'NEED_PASSWORD';
  }
}

/** 口令错误 */
export class BadPasswordError extends Error {
  constructor(message = '口令不正确') {
    super(message);
    this.name = 'BadPasswordError';
    this.code = 'BAD_PASSWORD';
  }
}

function deriveSiteRoot(moduleHref) {
  const url = new URL(moduleHref);
  const segments = url.pathname.split('/').filter(Boolean);
  const rootSegments = segments.slice(0, Math.max(0, segments.length - 3));
  url.pathname = `/${rootSegments.join('/')}${rootSegments.length ? '/' : ''}`;
  url.search = '';
  url.hash = '';
  return url.href;
}

const SITE_ROOT = deriveSiteRoot(import.meta.url);

const DEFAULT_PATHS = {
  envelope: 'data/content.enc.json'
};

function resolveBase(explicit) {
  if (explicit) return new URL(explicit, SITE_ROOT).href.replace(/\/*$/, '/');
  const meta = globalThis.document?.querySelector?.('meta[name="eh-data-base"]');
  const fromMeta = meta?.getAttribute('content')?.trim();
  if (fromMeta) return new URL(fromMeta, SITE_ROOT).href.replace(/\/*$/, '/');
  return SITE_ROOT;
}

/**
 * @param {{ baseUrl?: string, paths?: Partial<typeof DEFAULT_PATHS>, password?: string }} [options]
 */
export function createEncryptedProvider(options = {}) {
  const baseUrl = resolveBase(options.baseUrl);
  const paths = { ...DEFAULT_PATHS, ...(options.paths ?? {}) };

  let password = options.password ?? null;
  /** @type {object|null} 解密后的内容 */
  let content = null;
  let envelopePromise = null;

  async function loadEnvelope() {
    if (!envelopePromise) {
      const url = new URL(paths.envelope, baseUrl).href;
      envelopePromise = (async () => {
        let res;
        try {
          res = await fetch(url, { cache: 'no-cache' });
        } catch (cause) {
          throw new Error(
            `无法请求内容包 ${url}（${cause?.message ?? cause}）。` +
              '请确认通过 HTTP(S) 访问，且 data/content.enc.json 已随站点部署。'
          );
        }
        if (!res.ok) {
          throw new Error(`内容包加载失败 ${url}：HTTP ${res.status}`);
        }
        return res.json();
      })();
    }
    return envelopePromise;
  }

  /** 确保内容已解密；没有口令就抛 NeedPasswordError */
  async function ensureContent() {
    if (content) return content;

    const envelope = await loadEnvelope();

    if (!password) {
      throw new NeedPasswordError();
    }

    try {
      content = await decryptPayload(envelope, password);
    } catch (e) {
      if (/口令不正确/.test(String(e?.message))) {
        throw new BadPasswordError();
      }
      throw e;
    }

    // 校验解出来的结构，避免加密时漏了字段，到界面才炸
    for (const key of ['taxonomy', 'sources', 'knowledge', 'questions']) {
      if (!content[key]) {
        throw new Error(`内容包缺少字段 "${key}"，请重新构建`);
      }
    }
    return content;
  }

  const provider = {
    id: 'json-encrypted',
    baseUrl,
    describe() {
      return '加密内容包（AES-GCM + PBKDF2，需口令解密）';
    },

    /** 设置/更新口令；返回是否成功解密 */
    async unlock(pwd) {
      password = pwd;
      content = null;
      try {
        await ensureContent();
        return true;
      } catch (e) {
        if (e?.code === 'BAD_PASSWORD') return false;
        throw e;
      }
    },

    /** 是否已有可用内容（用于启动时判断要不要弹口令框） */
    async isUnlocked() {
      try {
        await ensureContent();
        return true;
      } catch (e) {
        if (e?.code === 'NEED_PASSWORD' || e?.code === 'BAD_PASSWORD') return false;
        throw e;
      }
    },

    /** 口令是否已被浏览器记住（不代表正确） */
    hasStoredPassword() {
      return Boolean(password);
    },

    async loadTaxonomy() {
      return (await ensureContent()).taxonomy;
    },
    async loadSources() {
      return (await ensureContent()).sources;
    },
    async loadParts() {
      return (await ensureContent()).parts ?? { schema_version: '1.0.0', parts: [] };
    },
    async loadKnowledge() {
      return (await ensureContent()).knowledge;
    },
    async loadQuestions() {
      return (await ensureContent()).questions;
    },
    async loadCompanies() {
      return (await ensureContent()).companies ?? [];
    },
    async loadProjects() {
      return (await ensureContent()).projects ?? [];
    },
    async loadReputation() {
      return (await ensureContent()).reputation ?? [];
    }
  };

  return assertProvider(provider);
}
