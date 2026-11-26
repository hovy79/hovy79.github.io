/**
 * 数据层装配入口。
 *
 * 这里是唯一「知道用哪种 Provider」的地方。切换数据源只改这个文件。
 *
 * 当前默认：加密 Provider（内容包需要口令解锁）。
 * 如需本地开发时免口令，把 DATA_MODE 改成 'plain'。
 */

import { createEncryptedProvider, NeedPasswordError, BadPasswordError } from './encrypted-provider.js';
import { createJsonProvider } from './json-provider.js';
import { createRepository } from './repository.js';

/**
 * 'encrypted' → 读 data/content.enc.json，需口令
 * 'plain'     → 读 data/*.json，无口令（仅本地开发用，构建产物不会包含这些文件）
 */
const DATA_MODE = 'encrypted';

/**
 * @param {{baseUrl?: string, password?: string}} [options]
 */
export function createProvider(options = {}) {
  if (DATA_MODE === 'plain') {
    return createJsonProvider({ baseUrl: options.baseUrl });
  }
  return createEncryptedProvider({
    baseUrl: options.baseUrl,
    password: options.password
  });
}

/**
 * 装配数据。
 *
 * 加密模式下，没有口令会抛 NeedPasswordError——调用方（app.js）负责
 * 弹出输入界面，拿到口令后带上 password 再调一次。
 *
 * @param {{baseUrl?: string, password?: string, provider?: any}} [options]
 */
export async function bootstrapData(options = {}) {
  const provider = options.provider ?? createProvider({
    baseUrl: options.baseUrl,
    password: options.password
  });
  const repository = await createRepository(provider);
  return { provider, repository };
}

export { NeedPasswordError, BadPasswordError };
