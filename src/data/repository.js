/**
 * Repository：在 Provider 之上建立索引，提供查询与筛选。
 *
 * UI 只与 Repository 交互。Provider 换成 Markdown / RAG / 远端 API 时，
 * 只要它能返回符合 Schema 的对象数组，本文件无需修改。
 */

/** 关键词高亮用的标记符（视图层替换成 <mark>） */
const HL_START = '\u0001';
const HL_END = '\u0002';
export const HIGHLIGHT = { start: HL_START, end: HL_END };

/** 知识条目参与全文检索的字段：正文段落是关键，不能漏 */
const KNOWLEDGE_SEARCH_KEYS = ['title', 'summary'];
const KNOWLEDGE_SEARCH_BLOCKS = [
  ['principle', 'body'],
  ['boundaries', 'body'],
  ['examples', 'body']
];

const QUESTION_SEARCH_KEYS = ['stem', 'analysis'];
const QUESTION_SEARCH_BLOCKS = [['scoring_points', 'text'], ['pitfalls', 'text']];

/**
 * @param {import('./provider.js').Provider} provider
 */
export async function createRepository(provider) {
  const [taxonomy, sourcesDoc, partsDoc, knowledge, questions, companies, projects] = await Promise.all([
    provider.loadTaxonomy(),
    provider.loadSources(),
    provider.loadParts(),
    provider.loadKnowledge(),
    provider.loadQuestions(),
    // 公司档案是可选数据源：Provider 没实现就返回空数组，界面自动隐藏该模块
    typeof provider.loadCompanies === 'function' ? provider.loadCompanies() : Promise.resolve([]),
    typeof provider.loadProjects === 'function' ? provider.loadProjects() : Promise.resolve([])
  ]);

  /** @type {Map<string, any>} */
  const knowledgeById = new Map();
  /** @type {Map<string, any>} */
  const questionById = new Map();
  /** @type {Map<string, any>} */
  const sourceById = new Map();
  /** @type {Map<string, any>} */
  const partByNumber = new Map();

  /** @type {Map<string, any>} */
  const companyById = new Map();
  for (const c of companies ?? []) {
    if (!c?.id) continue;
    if (companyById.has(c.id)) throw new Error(`公司档案 id 重复: ${c.id}`);
    companyById.set(c.id, c);
  }

  /** @type {Map<string, any>} */
  const projectById = new Map();
  for (const p of projects ?? []) {
    if (!p?.id) continue;
    if (projectById.has(p.id)) throw new Error(`开源项目 id 重复: ${p.id}`);
    projectById.set(p.id, p);
  }

  for (const s of sourcesDoc.sources ?? []) sourceById.set(s.source_id, s);
  for (const p of partsDoc?.parts ?? []) {
    if (p?.part_number) partByNumber.set(String(p.part_number).toUpperCase(), p);
  }

  for (const item of knowledge) {
    if (knowledgeById.has(item.id)) {
      throw new Error(`知识条目 id 重复: ${item.id}`);
    }
    knowledgeById.set(item.id, normalizeKnowledge(item));
  }
  for (const q of questions) {
    if (questionById.has(q.id)) {
      throw new Error(`题目 id 重复: ${q.id}`);
    }
    questionById.set(q.id, normalizeQuestion(q));
  }

  // 题目 → 知识点 的反向索引，用于「该知识点被哪些题考察」
  /** @type {Map<string, string[]>} */
  const questionsByKnowledge = new Map();
  for (const q of questionById.values()) {
    for (const ref of q.knowledge_refs) {
      if (!questionsByKnowledge.has(ref)) questionsByKnowledge.set(ref, []);
      questionsByKnowledge.get(ref).push(q.id);
    }
  }

  const domainById = new Map(taxonomy.domains.map((d) => [d.id, d]));
  const categoryById = new Map();
  const domainOrder = new Map();
  const categoryOrder = new Map();
  taxonomy.domains.forEach((d, di) => {
    domainOrder.set(d.id, di);
    d.categories.forEach((c, ci) => {
      categoryById.set(`${d.id}:${c.id}`, c);
      categoryOrder.set(`${d.id}:${c.id}`, ci);
    });
  });

  /** 按词表顺序排列，而不是字母序——分类在界面上应保持教学设计者的顺序 */
  function byTaxonomy(a, b) {
    return (
      (domainOrder.get(a.domain) ?? 99) - (domainOrder.get(b.domain) ?? 99) ||
      (categoryOrder.get(`${a.domain}:${a.category}`) ?? 99) -
        (categoryOrder.get(`${b.domain}:${b.category}`) ?? 99) ||
      a.difficulty - b.difficulty ||
      String(a.id).localeCompare(String(b.id))
    );
  }

  function normalizeKnowledge(item) {
    return {
      ...item,
      tags: item.tags ?? [],
      principle: item.principle ?? [],
      boundaries: item.boundaries ?? [],
      examples: item.examples ?? [],
      related: item.related ?? [],
      searchText: buildSearchText(item, KNOWLEDGE_SEARCH_KEYS, KNOWLEDGE_SEARCH_BLOCKS)
    };
  }

  function normalizeQuestion(q) {
    return {
      ...q,
      options: q.options ?? [],
      scoring_points: q.scoring_points ?? [],
      pitfalls: q.pitfalls ?? [],
      knowledge_refs: q.knowledge_refs ?? [],
      answer: q.answer ?? { choice: [], reference: '' },
      searchText: buildSearchText(q, QUESTION_SEARCH_KEYS, QUESTION_SEARCH_BLOCKS)
    };
  }

  /**
   * 建立检索文本。
   *
   * 旧版只索引 title / summary / tags，导致搜「伏秒平衡」搜不到讲伏秒平衡的
   * 知识条目——正文才是内容主体。现在把 principle / boundaries / examples
   * 与题目解析、踩分点、误区一并纳入。
   *
   * @param {object} row
   * @param {string[]} scalarKeys 直接拼接的字符串字段
   * @param {Array<[string, string]>} blockKeys [{ 顶层字段, 该字段下每项的文本字段 }]
   */
  function buildSearchText(row, scalarKeys, blockKeys) {
    const parts = [];
    for (const k of scalarKeys) {
      if (typeof row[k] === 'string') parts.push(row[k]);
    }
    if (Array.isArray(row.tags)) parts.push(row.tags.join(' '));
    if (Array.isArray(row.options)) parts.push(row.options.map((o) => o.text).join(' '));
    if (Array.isArray(row.knowledge_refs)) {
      for (const kid of row.knowledge_refs) {
        const k = knowledgeById.get(kid);
        if (k) parts.push(k.title);
      }
    }
    for (const [field, textKey] of blockKeys) {
      const arr = row[field];
      if (!Array.isArray(arr)) continue;
      for (const block of arr) {
        if (typeof block === 'string') parts.push(block);
        else if (block && typeof block === 'object') {
          if (typeof block.heading === 'string') parts.push(block.heading);
          if (typeof block.title === 'string') parts.push(block.title);
          if (typeof block.body === 'string') parts.push(block.body);
          if (typeof block[textKey] === 'string') parts.push(block[textKey]);
        }
      }
    }
    return parts.join(' ').toLowerCase();
  }

  function sourceOf(row) {
    const id = row?.source?.source_id;
    return id ? sourceById.get(id) ?? null : null;
  }

  return {
    providerId: provider.id,
    providerDescription: provider.describe(),
    taxonomy,

    domains() {
      return taxonomy.domains;
    },

    domain(id) {
      return domainById.get(id) ?? null;
    },

    categoriesOf(domainId) {
      return domainById.get(domainId)?.categories ?? [];
    },

    categoryLabel(domainId, categoryId) {
      return categoryById.get(`${domainId}:${categoryId}`)?.label ?? categoryId;
    },

    difficultyLabel(value) {
      return (
        taxonomy.difficulty_levels.find((d) => d.value === Number(value))?.label ??
        `L${value}`
      );
    },

    questionTypeLabel(id) {
      return taxonomy.question_types.find((t) => t.id === id)?.label ?? id;
    },

    isAutoGradable(type) {
      return Boolean(
        taxonomy.question_types.find((t) => t.id === type)?.auto_gradable
      );
    },

    masteryStates() {
      return taxonomy.mastery_states;
    },

    verifiedStatusMeta(id) {
      return taxonomy.verified_statuses.find((s) => s.id === id) ?? null;
    },

    sourceOf,

    knowledgeItem(id) {
      return knowledgeById.get(id) ?? null;
    },

    questionItem(id) {
      return questionById.get(id) ?? null;
    },

    /**
     * @param {{domain?: string, category?: string, difficulty?: number|string,
     *          query?: string, tag?: string}} [filter]
     */
    listKnowledge(filter = {}) {
      return filterRows([...knowledgeById.values()], filter).sort(byTaxonomy);
    },

    /**
     * @param {{domain?: string, category?: string, difficulty?: number|string,
     *          query?: string, type?: string}} [filter]
     */
    listQuestions(filter = {}) {
      return filterRows([...questionById.values()], filter).sort(byTaxonomy);
    },

    questionsForKnowledge(knowledgeId) {
      const ids = questionsByKnowledge.get(knowledgeId) ?? [];
      return ids.map((id) => questionById.get(id)).filter(Boolean);
    },

    /** 器件登记：只返回已登记的型号信息，未登记返回 null */
    partOf(partNumber) {
      return partByNumber.get(String(partNumber ?? '').toUpperCase()) ?? null;
    },

    allParts() {
      return [...partByNumber.values()];
    },

    /**
     * 在文本中标记命中的关键词，供视图层转成 <mark>。
     * 返回带 HL_START/HL_END 标记的字符串（已转义由视图层负责）。
     * 关键词为空时原样返回。
     */
    markHits(text, query) {
      const raw = String(text ?? '');
      const q = String(query ?? '').trim();
      if (!q) return raw;
      const lower = raw.toLowerCase();
      const needle = q.toLowerCase();
      let out = '';
      let from = 0;
      let idx = lower.indexOf(needle, from);
      if (idx < 0) return raw;
      while (idx >= 0) {
        out += raw.slice(from, idx) + HL_START + raw.slice(idx, idx + needle.length) + HL_END;
        from = idx + needle.length;
        idx = lower.indexOf(needle, from);
      }
      out += raw.slice(from);
      return out;
    },

    /** 同一分类下、除自己以外的知识点（详情页底部「相关内容」） */
    relatedKnowledge(item, limit = 4) {
      if (!item) return [];
      const explicit = (item.related ?? [])
        .map((id) => knowledgeById.get(id))
        .filter(Boolean);
      if (explicit.length >= limit) return explicit.slice(0, limit);
      const seen = new Set(explicit.map((k) => k.id));
      seen.add(item.id);
      const sameCategory = [...knowledgeById.values()].filter(
        (k) => k.domain === item.domain && k.category === item.category && !seen.has(k.id)
      );
      return [...explicit, ...sameCategory].slice(0, limit);
    },

    /** 统计每个分区/分类下的条目数，用于导航角标 */
    counts() {
      const out = { knowledge: {}, questions: {} };
      for (const d of taxonomy.domains) {
        out.knowledge[d.id] = { total: 0, byCategory: {} };
        out.questions[d.id] = { total: 0, byCategory: {} };
        for (const c of d.categories) {
          out.knowledge[d.id].byCategory[c.id] = 0;
          out.questions[d.id].byCategory[c.id] = 0;
        }
      }
      for (const k of knowledgeById.values()) {
        const bucket = out.knowledge[k.domain];
        if (!bucket) continue;
        bucket.total += 1;
        bucket.byCategory[k.category] = (bucket.byCategory[k.category] ?? 0) + 1;
      }
      for (const q of questionById.values()) {
        const bucket = out.questions[q.domain];
        if (!bucket) continue;
        bucket.total += 1;
        bucket.byCategory[q.category] = (bucket.byCategory[q.category] ?? 0) + 1;
      }
      return out;
    },

    /** 公司档案：按「主力目标 → 冲刺 → 保底 → 待打探 → 不推荐」排序 */
    listCompanies() {
      const ORDER = { 主力目标: 0, 冲刺: 1, 保底选项: 2, 待打探: 3, 不推荐: 4 };
      return [...companyById.values()].sort(
        (a, b) => (ORDER[a.tier] ?? 9) - (ORDER[b.tier] ?? 9) || String(a.id).localeCompare(String(b.id))
      );
    },

    company(id) {
      return companyById.get(id) ?? null;
    },

    /** 某知识点被哪些公司列为考察点（知识点详情页可反向展示） */
    companiesForKnowledge(knowledgeId) {
      return [...companyById.values()].filter((c) =>
        (c.knowledge_refs ?? []).includes(knowledgeId)
      );
    },

    /** 开源项目库（按难度升序，方便从易到难挑） */
    listProjects() {
      return [...projectById.values()].sort(
        (a, b) => (a.difficulty ?? 9) - (b.difficulty ?? 9) || String(a.id).localeCompare(String(b.id))
      );
    },

    project(id) {
      return projectById.get(id) ?? null;
    },

    /** 某个公司推荐的项目（company.project_id 指向这里） */
    projectForCompany(company) {
      const pid = company?.project_id;
      return pid ? projectById.get(pid) ?? null : null;
    },

    /** 供校验脚本/调试使用：暴露全部原始条目 */
    all() {
      return {
        knowledge: [...knowledgeById.values()],
        questions: [...questionById.values()],
        sources: [...sourceById.values()],
        parts: [...partByNumber.values()],
        companies: [...companyById.values()],
        projects: [...projectById.values()]
      };
    }
  };
}

function filterRows(rows, filter) {
  const { domain, category, difficulty, query, tag, type } = filter;
  let out = rows;
  if (domain) out = out.filter((r) => r.domain === domain);
  if (category) out = out.filter((r) => r.category === category);
  if (type) out = out.filter((r) => r.type === type);
  if (difficulty !== undefined && difficulty !== null && difficulty !== '') {
    const d = Number(difficulty);
    out = out.filter((r) => r.difficulty === d);
  }
  if (tag) out = out.filter((r) => (r.tags ?? []).includes(tag));
  if (query) {
    const q = String(query).trim().toLowerCase();
    if (q) out = out.filter((r) => r.searchText.includes(q));
  }
  return out;
}
