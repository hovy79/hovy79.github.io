/**
 * Provider 契约（数据访问接口）
 *
 * 这一层刻意不依赖任何具体存储形式。当前实现是 JSON 静态文件（JsonProvider），
 * 未来接入本地 Markdown 目录、芯片资料 RAG 或远端 API 时，只要实现同样的方法，
 * 上层 Repository / UI 无需改动。
 *
 * 契约：
 *   provider.id                 -> string            实现标识，用于诊断
 *   provider.describe()         -> string            人类可读的数据源描述
 *   provider.loadTaxonomy()     -> Promise<Taxonomy>
 *   provider.loadSources()      -> Promise<SourcesDoc>
 *   provider.loadKnowledge()    -> Promise<KnowledgeItem[]>   合并两个分区
 *   provider.loadQuestions()    -> Promise<Question[]>        合并两个分区
 *   provider.loadParts()        -> Promise<PartsDoc>          （可选）
 *   provider.loadCompanies()    -> Promise<Company[]>         （可选）
 *   provider.loadProjects()     -> Promise<OssProject[]>      （可选）
 *
 * loadParts 是后加的：器件登记表用于把「型号 → 数据手册」这一步变成可追溯的。
 * 标为可选是为了不破坏已有的 Provider 实现——未实现时 Repository 会退化为
 * 「无器件登记」，界面隐藏型号来源链接，而不是整体崩掉。
 *
 * 返回值必须符合 docs/DATA-SCHEMA.md 中的定义。Provider 不做筛选、不做排序、
 * 不做任何业务判断——那是 Repository 的职责。
 */

/** @typedef {Object} Provider */
export const PROVIDER_CONTRACT = Object.freeze({
  /** 必需方法：缺任何一个都在装配阶段直接报错 */
  methods: [
    'describe',
    'loadTaxonomy',
    'loadSources',
    'loadKnowledge',
    'loadQuestions'
  ],
  /** 可选方法：未实现时上层需要降级处理 */
  optionalMethods: ['loadParts', 'loadCompanies', 'loadProjects']
});

/**
 * 断言某个对象实现了 Provider 契约。在装配阶段调用，尽早暴露实现缺失。
 * @param {unknown} candidate
 * @returns {Provider}
 */
export function assertProvider(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Provider 必须是一个对象');
  }
  const missing = PROVIDER_CONTRACT.methods.filter(
    (name) => typeof /** @type {any} */ (candidate)[name] !== 'function'
  );
  if (missing.length > 0) {
    throw new Error(`Provider 缺少方法: ${missing.join(', ')}`);
  }
  return /** @type {Provider} */ (candidate);
}
