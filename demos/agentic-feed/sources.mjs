import {loadSourceConfig as loadSharedSourceConfig} from '../agentic-feed-site/lib/waterfall/sources.mjs';
import {fileURLToPath} from 'node:url';
export * from '../agentic-feed-site/lib/waterfall/sources.mjs';
export const DEFAULT_SOURCE_CONFIG_PATH=fileURLToPath(new URL('../../HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json',import.meta.url));
export const loadSourceConfig=(path=process.env.XUANJI_CONFIG_FILE||process.env.MODEL_CONFIG_FILE||DEFAULT_SOURCE_CONFIG_PATH)=>loadSharedSourceConfig(path);
