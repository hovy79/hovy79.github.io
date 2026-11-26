/**
 * 极简行内标记渲染。
 *
 * 只支持 `code`、**bold**、*italic*，其余一律转义。
 * 刻意不支持链接与 HTML：数据来自外部源时，避免注入风险。
 */

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch]);
}

export function renderInline(text) {
  let out = escapeHtml(text);
  // 先处理 code，避免其中的 * 被当作强调
  const codes = [];
  out = out.replace(/`([^`]+)`/g, (_, inner) => {
    codes.push(inner);
    return `\u0000CODE${codes.length - 1}\u0000`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
  return out;
}

/**
 * 渲染并高亮命中的关键词。
 *
 * 为什么不用「先拼 HTML 再正则替换」：那样在已转义的文本里替换，
 * 关键词若跨过实体边界（如 &amp;）会破坏 HTML。
 * 这里先在**原文**上切分，再逐段转义拼接，边界始终是安全的。
 *
 * @param {string} text 原始文本
 * @param {string} query 关键词（大小写不敏感）
 * @returns {string} 安全的 HTML
 */
export function renderInlineMarked(text, query) {
  const raw = String(text ?? '');
  const q = String(query ?? '').trim();
  if (!q) return renderInline(raw);

  const lower = raw.toLowerCase();
  const needle = q.toLowerCase();
  const parts = [];
  let from = 0;
  let idx = lower.indexOf(needle, from);

  while (idx >= 0) {
    if (idx > from) parts.push(renderInline(raw.slice(from, idx)));
    parts.push(`<mark class="hit">${renderInline(raw.slice(idx, idx + needle.length))}</mark>`);
    from = idx + needle.length;
    idx = lower.indexOf(needle, from);
  }
  if (from < raw.length) parts.push(renderInline(raw.slice(from)));
  return parts.join('');
}

/** 渲染一组段落为 <p>，空数组返回空字符串 */
export function renderParagraphs(list, className = '') {
  if (!Array.isArray(list) || list.length === 0) return '';
  const cls = className ? ` class="${className}"` : '';
  return `<div${cls}>${list.map((t) => `<p>${renderInline(t)}</p>`).join('')}</div>`;
}
