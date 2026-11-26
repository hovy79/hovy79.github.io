/**
 * 判分与抽题策略。
 *
 * 从 app.js 里抽出来单独放，原因有两个：
 *   1. 判分规则是「业务正确性」的核心，必须能脱离 DOM 单独测试；
 *   2. 抽题/间隔重复策略会持续演进，混在事件处理里没法迭代。
 *
 * 判分原则（保持不放宽）：
 *   - 单选/多选：集合完全相等。多选题少选也判错——这是面试场景的正确口径，
 *     「选对一半」不等于答对。
 *   - 简答/计算/设计：不做关键词匹配伪造判分，交给用户自评。
 *     关键词匹配在中文技术问答上误判率极高，比不判分更有害。
 */

/**
 * @param {{type: string, answer: {choice: string[]}}} question
 * @param {string[]} selected
 * @returns {boolean}
 */
export function isAnswerCorrect(question, selected) {
  const correct = new Set(question?.answer?.choice ?? []);
  const picked = new Set(selected ?? []);
  if (picked.size === 0) return false;
  if (picked.size !== correct.size) return false;
  for (const key of picked) {
    if (!correct.has(key)) return false;
  }
  return true;
}

/**
 * 生成一个稳定的伪随机排列（用于「随机练习」时同一 seed 顺序一致，
 * 便于分享链接复现同一组题）。
 * 用 mulberry32 —— 32 位状态，够用且实现只有几行。
 */
export function createRng(seed = Date.now()) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 洗牌（Fisher-Yates），返回新数组，不改入参。
 */
export function shuffle(list, rng = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 组一套练习序列。
 *
 * 策略（按权重抽取，不是纯随机）：
 *   - 错题权重最高：已经做错的最该重做
 *   - 需复习次之
 *   - 未练习再次之
 *   - 已掌握权重最低（偶尔回顾，不占主时段）
 *   - 主观题（简答/计算/设计）按比例掺入，避免全是被选项框住的客观题
 *
 * @param {any[]} pool 候选题目（已按分区/筛选过滤）
 * @param {{
 *   masteryOf: (id: string) => string,
 *   size?: number,
 *   seed?: number,
 *   includeMastered?: boolean
 * }} opts
 * @returns {any[]}
 */
export function buildPracticeSet(pool, opts) {
  const { masteryOf, size = 20, seed = Date.now(), includeMastered = true } = opts;
  const rng = createRng(seed);

  const WEIGHT = { wrong: 8, review: 5, unseen: 3, mastered: 1 };

  const weighted = pool.map((q) => {
    const state = masteryOf(q.id) ?? 'unseen';
    let w = WEIGHT[state] ?? 3;
    // 主观题单题训练价值高但耗时长，略微降权，避免整套题都是大题
    if (state === 'unseen') {
      const type = q.type;
      if (type === 'design') w *= 1.4;
      else if (type === 'short' || type === 'calculation') w *= 1.1;
    }
    return { q, w, state };
  });

  const picked = [];
  const remaining = [...weighted];

  // 过滤掉已掌握（可选）
  for (let i = remaining.length - 1; i >= 0; i -= 1) {
    if (!includeMastered && remaining[i].state === 'mastered') remaining.splice(i, 1);
  }

  while (picked.length < size && remaining.length > 0) {
    const total = remaining.reduce((s, x) => s + x.w, 0);
    if (total <= 0) break;
    let r = rng() * total;
    let idx = 0;
    for (let i = 0; i < remaining.length; i += 1) {
      r -= remaining[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
      idx = i;
    }
    picked.push(remaining[idx].q);
    remaining.splice(idx, 1);
  }

  return picked;
}

/**
 * 计算「下一题」：在给定序列里找当前题的下一个。
 * 序列来自 URL（practice=seed），保证刷新后仍然一致。
 */
export function neighboursInSet(setIds, currentId) {
  const idx = setIds.indexOf(currentId);
  if (idx < 0) return { prev: null, next: null, index: -1, total: setIds.length };
  return {
    prev: idx > 0 ? setIds[idx - 1] : null,
    next: idx < setIds.length - 1 ? setIds[idx + 1] : null,
    index: idx,
    total: setIds.length
  };
}
