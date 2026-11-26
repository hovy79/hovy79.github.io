/**
 * 进度存储：掌握状态、答题记录、筛选偏好。
 *
 * 单一职责：读写 localStorage，并做版本迁移保护。UI 不直接碰 localStorage。
 *
 * 版本策略：
 *   v1 → 当前结构。读取时若发现 version 不匹配，迁移而不是丢弃——
 *   用户做了几百道题，清空是最差的处理方式。
 */

const STORAGE_KEY = 'eh-interview-drill/progress/v1';
const CURRENT_VERSION = 2;

const DEFAULT_STATE = {
  version: CURRENT_VERSION,
  /** @type {Record<string, {state: string, updatedAt: string, note?: string}>} */
  mastery: {},
  /**
   * @type {Record<string, {
   *   choice: string[], correct: boolean|null, answeredAt: string, reveal: boolean,
   *   attempts?: number, lastWrongAt?: string
   * }>}
   */
  answers: {},
  /** @type {{domain?: string, category?: string, difficulty?: string, query?: string}} */
  filters: {}
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function safeParse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 迁移旧版本状态。
 * v1 没有 attempts / lastWrongAt，补默认值即可，不丢数据。
 */
function migrate(loaded) {
  const base = clone(DEFAULT_STATE);
  if (!loaded) return base;

  const version = Number(loaded.version ?? 1);
  const mastery = loaded.mastery && typeof loaded.mastery === 'object' ? loaded.mastery : {};
  const rawAnswers =
    loaded.answers && typeof loaded.answers === 'object' ? loaded.answers : {};
  const filters = loaded.filters && typeof loaded.filters === 'object' ? loaded.filters : {};

  const answers = {};
  for (const [id, a] of Object.entries(rawAnswers)) {
    if (!a || typeof a !== 'object') continue;
    answers[id] = {
      choice: Array.isArray(a.choice) ? a.choice : [],
      correct: typeof a.correct === 'boolean' ? a.correct : null,
      reveal: Boolean(a.reveal),
      answeredAt: typeof a.answeredAt === 'string' ? a.answeredAt : new Date().toISOString(),
      attempts: Number.isFinite(a.attempts) ? a.attempts : 0,
      lastWrongAt: typeof a.lastWrongAt === 'string' ? a.lastWrongAt : undefined
    };
  }

  return {
    ...base,
    version: CURRENT_VERSION,
    mastery,
    answers,
    filters
  };
}

export function createProgressStore(storage = globalThis.localStorage) {
  let state = clone(DEFAULT_STATE);
  let available = true;

  try {
    const loaded = safeParse(storage?.getItem(STORAGE_KEY));
    if (loaded) state = migrate(loaded);
  } catch {
    available = false;
  }

  function persist() {
    if (!available) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 配额满或隐私模式：降级为「本次会话有效」，不打断用户
      available = false;
    }
  }

  const listeners = new Set();
  function emit() {
    for (const fn of listeners) fn(state);
  }

  return {
    get available() {
      return available;
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    getMastery(id) {
      return state.mastery[id]?.state ?? 'unseen';
    },

    setMastery(id, masteryState) {
      if (!id) return;
      if (masteryState === 'unseen') {
        delete state.mastery[id];
      } else {
        state.mastery[id] = {
          state: masteryState,
          updatedAt: new Date().toISOString()
        };
      }
      persist();
      emit();
    },

    getAnswer(id) {
      return state.answers[id] ?? null;
    },

    setAnswer(id, patch) {
      const prev = state.answers[id] ?? {};
      const next = {
        choice: [],
        correct: null,
        reveal: false,
        attempts: 0,
        ...prev,
        ...patch,
        answeredAt: new Date().toISOString()
      };
      // 记录「答错过」这件事，即使后来答对也保留，便于按错误率排序复习顺序
      if (patch?.correct === false) next.lastWrongAt = next.answeredAt;
      state.answers[id] = next;
      persist();
      emit();
    },

    /** 每次提交作答时累加尝试次数，用于「这题我做了几次才对」 */
    recordAttempt(id, { correct, choice }) {
      const prev = state.answers[id] ?? { attempts: 0 };
      this.setAnswer(id, {
        choice: choice ?? prev.choice ?? [],
        correct,
        reveal: true,
        attempts: (prev.attempts ?? 0) + 1
      });
    },

    clearAnswer(id) {
      delete state.answers[id];
      persist();
      emit();
    },

    getFilters(module) {
      return { ...(state.filters[module] ?? {}) };
    },

    setFilters(module, filters) {
      // 合并而非覆盖：调用方通常只想更新其中一个维度
      state.filters[module] = { ...(state.filters[module] ?? {}), ...filters };
      persist();
    },

    /**
     * 统计。
     *
     * 关键修正：旧版统计全库，但薄弱点页按分区展示，导致「嵌入式薄弱点」
     * 页顶部的数字里混进了硬件的数据。现在支持传入 id 白名单，
     * 只统计当前分区内的条目。
     *
     * @param {{ids?: Set<string>}} [scope]
     */
    stats(scope = {}) {
      const inScope = (id) => !scope.ids || scope.ids.has(id);

      const counts = { mastered: 0, review: 0, wrong: 0, unseen: 0 };
      for (const [id, entry] of Object.entries(state.mastery)) {
        if (!inScope(id)) continue;
        if (counts[entry.state] !== undefined) counts[entry.state] += 1;
      }

      let answeredTotal = 0;
      let answeredCorrect = 0;
      let wrongEver = 0;
      for (const [id, a] of Object.entries(state.answers)) {
        if (!inScope(id)) continue;
        if (a.lastWrongAt) wrongEver += 1;
        if (a.correct === null || a.correct === undefined) continue;
        answeredTotal += 1;
        if (a.correct === true) answeredCorrect += 1;
      }

      return {
        mastery: counts,
        answeredTotal,
        answeredCorrect,
        wrongEver,
        accuracy: answeredTotal ? answeredCorrect / answeredTotal : null
      };
    },

    /** 导出为可读 JSON，便于换设备或备份 */
    exportAll() {
      return {
        ...clone(state),
        exported_at: new Date().toISOString(),
        app: 'embedded-hw-interview-drill'
      };
    },

    /**
     * 导入。
     *
     * @param {object} payload
     * @param {{merge?: boolean}} [options] merge=true 时与现有进度合并（同 id 取较新）
     * @returns {{imported: number, skipped: number}}
     */
    importAll(payload, options = {}) {
      const { merge = true } = options;
      const incoming = migrate(payload);
      let imported = 0;
      let skipped = 0;

      if (!merge) {
        state = incoming;
        imported =
          Object.keys(incoming.mastery).length + Object.keys(incoming.answers).length;
      } else {
        for (const [id, entry] of Object.entries(incoming.mastery)) {
          const cur = state.mastery[id];
          if (!cur || new Date(entry.updatedAt) >= new Date(cur.updatedAt ?? 0)) {
            state.mastery[id] = entry;
            imported += 1;
          } else {
            skipped += 1;
          }
        }
        for (const [id, a] of Object.entries(incoming.answers)) {
          const cur = state.answers[id];
          if (!cur || new Date(a.answeredAt) >= new Date(cur.answeredAt ?? 0)) {
            state.answers[id] = a;
            imported += 1;
          } else {
            skipped += 1;
          }
        }
      }

      persist();
      emit();
      return { imported, skipped };
    },

    reset() {
      state = clone(DEFAULT_STATE);
      persist();
      emit();
    }
  };
}
