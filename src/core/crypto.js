/**
 * 浏览器端内容解密。
 *
 * 站点部署的是**加密内容包**，不含任何明文题库。打开时需要输入口令，
 * 口令经 PBKDF2 派生出 AES-GCM 密钥，在本地解密后渲染。
 *
 * 安全边界（必须讲清楚，不要让人误以为这是"账号系统"）：
 *   - 防护的是「随手打开网站就能看全部内容」，以及搜索引擎/爬虫抓取。
 *   - 不是真正的访问控制：口令一旦被转发，对方一样能看。
 *   - 不要在口令保护下放入你无法承受泄露的信息。
 *
 * 为什么不放服务端：本项目的核心约束是「纯静态、零后端、零成本」。
 * 真要做账号级访问控制，必须上后端或第三方鉴权网关。
 */

const KDF_ITERATIONS = 310_000; // OWASP 2023 对 PBKDF2-SHA256 的建议下限
const KEY_LENGTH = 256;
const SALT_BYTES = 16;
const IV_BYTES = 12;

/** base64 → Uint8Array */
function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uint8Array → base64 */
function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** 口令 → 派生密钥 */
async function deriveKey(password, salt, iterations) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['decrypt']
  );
}

/**
 * 解密内容包。
 *
 * @param {object} envelope 部署时生成的密文包
 * @param {string} password 用户输入的口令
 * @returns {Promise<object>} 解密后的内容对象
 * @throws {Error} 口令错误或密文损坏
 */
export async function decryptPayload(envelope, password) {
  if (!envelope || envelope.v !== 1) {
    throw new Error('内容包格式不支持（版本不匹配）');
  }
  if (!globalThis.crypto?.subtle) {
    throw new Error(
      '当前环境不支持 WebCrypto。请通过 HTTPS 或 localhost 访问本站（file:// 与部分内嵌浏览器不具备该能力）。'
    );
  }

  const salt = b64ToBytes(envelope.kdf.salt);
  const iv = b64ToBytes(envelope.cipher.iv);
  const ciphertext = b64ToBytes(envelope.data);

  let key;
  try {
    key = await deriveKey(password, salt, envelope.kdf.iterations);
  } catch {
    throw new Error('密钥派生失败');
  }

  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  } catch {
    // AES-GCM 认证失败：口令错，或密文被改过
    throw new Error('口令不正确');
  }

  const text = new TextDecoder().decode(plain);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('解密成功但内容解析失败，数据可能已损坏');
  }
}

/** 供构建脚本复用的常量（加密时必须与这里一致） */
export const CRYPTO_PARAMS = { KDF_ITERATIONS, SALT_BYTES, IV_BYTES, KEY_LENGTH };

/** 仅用于测试/工具：把字节转 base64 */
export { bytesToB64, b64ToBytes };
