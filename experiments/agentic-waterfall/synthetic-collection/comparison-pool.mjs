import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { normalizeContent } from '../../../output/agentic-waterfall/comparison-20261106-synthetic-10x20-all-methods-v4/source/site/lib/waterfall/dataset-format.mjs';

const hash = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');

export function readContentPool(path, allowedSources, { expanded = false } = {}) {
  assert(typeof path === 'string' && isAbsolute(path), 'contentPool must be an absolute frozen archive path');
  path = realpathSync(path);
  const sidecar = path.replace(/\.jsonl\.gz$/, '.manifest.json');
  const manifestPath = sidecar !== path && existsSync(sidecar) ? sidecar : join(dirname(path), 'manifest.json');
  const bytes = readFileSync(path), manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes), cards_sha256 = hash(bytes);
  assert.equal(manifest.cards_path, basename(path), 'frozen pool archive path mismatch');
  assert.equal(manifest.cards_sha256, cards_sha256, 'frozen pool archive hash mismatch');
  const rows = gunzipSync(bytes, { maxOutputLength: (expanded ? 128 : 32) * 1024 * 1024 }).toString('utf8').trimEnd().split('\n').map(JSON.parse);
  const limit = expanded ? 100_000 : 1000;
  assert(rows.length >= 21 && rows.length <= limit, `frozen pool must contain 21–${limit} normalized cards`);
  assert.equal(rows.length, manifest.cards_count, 'frozen pool count mismatch');
  assert(Array.isArray(manifest.selected_sources), 'frozen pool source roster missing');
  assert.deepEqual([...new Set(rows.map(row => row.source))].sort(), [...manifest.selected_sources].sort(), 'frozen pool source roster mismatch');
  const cards = rows.map(row => {
    assert(allowedSources.includes(row.source) && row.canonical_url?.startsWith('https://'), 'unavailable or nonpublic frozen source');
    assert(typeof row.source_item_id === 'string' && row.source_item_id && typeof row.title === 'string' && row.title.trim() &&
      typeof row.summary === 'string' && ['text', 'video'].includes(row.metadata?.modality), 'invalid frozen public card');
    const normalized = normalizeContent(row);
    assert.equal(row.content_id, normalized.content_id, 'frozen content identity mismatch');
    assert.equal(manifest.published_versions?.[row.content_version_id] ?? row.content_version_id, normalized.content_version_id, 'frozen content version mismatch');
    return {
      id: hash([row.source, row.source_item_id]).slice(0, 24), source_item_id: row.source_item_id,
      content_id: row.content_id, content_version_id: row.content_version_id, content_hash: row.content_version_id.slice(8),
      title: row.title, summary: row.summary, source: row.source, url: row.canonical_url,
      modality: row.metadata.modality, origin: 'frozen_pool',
      ...(row.metadata.duration === undefined ? {} : { duration: row.metadata.duration }),
      ...(row.metadata.published_at === undefined ? {} : { published_at: row.metadata.published_at }),
    };
  });
  for (const field of ['id', 'url', 'content_id', 'content_version_id']) {
    assert.equal(new Set(cards.map(card => card[field])).size, cards.length, 'duplicate frozen pool ' + field);
  }
  return { cards, lineage: {
    path, cards_sha256, manifest_path: manifestPath, manifest_sha256: hash(manifestBytes),
    cards_count: cards.length, selected_sources: manifest.selected_sources, selection_sha256: manifest.selection_sha256 ?? null,
    candidate_policy: 'same public-evidence lexical shortlist of 20 plus a held-out neutral contrast for i2Agent',
  } };
}


export function readDualContentPools({ directory, manifest_sha256, counts, filenames }, allowedSources) {
  assert(typeof directory === 'string' && isAbsolute(directory), 'dual-pool directory must be absolute');
  const manifestPath = join(directory, 'manifest.json'), bytes = readFileSync(manifestPath);
  assert.equal(hash(bytes), manifest_sha256, 'dual-pool manifest hash mismatch');
  const manifest = JSON.parse(bytes);
  const pools = Object.fromEntries(['C0', 'Cext'].map(side => {
    const name = filenames?.[side] ?? side + '.jsonl.gz';
    assert.equal(basename(name), name, 'dual-pool filename must stay in its directory');
    const pool = readContentPool(join(directory, name), allowedSources, { expanded: true });
    assert.equal(pool.lineage.cards_sha256, manifest.files[name], 'dual-pool archive hash mismatch');
    assert.equal(pool.cards.length, counts[side], 'dual-pool bound count mismatch');
    return [side, pool];
  }));
  for (const field of ['id', 'url', 'content_id', 'content_version_id']) {
    const small = new Set(pools.C0.cards.map(card => card[field]));
    assert(pools.Cext.cards.every(card => !small.has(card[field])), 'duplicate across dual pools: ' + field);
  }
  return pools;
}

function terms(value) {
  const words = String(value ?? '').normalize('NFKC').toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9]{2,}/gu) ?? [];
  return new Set(words.flatMap(word => {
    if (!/\p{Script=Han}/u.test(word)) return [word];
    const chars = Array.from(word);
    return chars.slice(0, -1).map((char, index) => char + chars[index + 1]);
  }));
}

export function candidatesForCheckpoint(pool, { provided_profile, evidence }) {
  const seen = new Set(evidence.map(row => row.content_id).filter(Boolean));
  const cards = pool.cards.filter(card => ![card.id, card.content_id, 'ref-' + card.content_id.slice(8, 32)].some(id => seen.has(id)));
  const weights = new Map();
  const add = (text, weight) => { for (const term of terms(text)) weights.set(term, Math.max(weights.get(term) ?? 0, weight)); };
  add([provided_profile.profile, ...provided_profile.interests, ...provided_profile.entries.map(row => row.value)].join(' '), 1);
  for (const row of evidence.filter(row => row.type === 'open' || row.type === 'feedback' && ['like', 'save', 'comment'].includes(row.value)).slice(-20)) {
    add(row.title, 2);
    if (row.value === 'comment') add(row.text, 2);
  }
  evidence.filter(row => row.type === 'command').slice(-3).reverse().forEach((row, index) => add(row.text, 6 - index * 2));
  const query = [...weights.keys()];
  const indexed = cards.map(card => ({ card, title: terms(card.title), snippet: terms(card.summary) }));
  const idf = new Map(query.map(term => [term, Math.log1p(cards.length /
    (1 + indexed.filter(row => row.title.has(term) || row.snippet.has(term)).length))]));
  const ranked = indexed.map(({ card, title, snippet }) => ({
    id: card.id, score: query.reduce((sum, term) => sum + weights.get(term) * idf.get(term) *
      (title.has(term) ? 2 : snippet.has(term) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { cards, candidate_ids: ranked.slice(0, 20).map(row => row.id), contrast_id: ranked[20]?.id ?? null };
}

function lexicalIndex(cards) {
  const postings = new Map();
  for (const [index, card] of cards.entries()) {
    const title = terms(card.title), snippet = terms(card.summary);
    for (const term of title) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push(2 * index + 1);
    }
    for (const term of snippet) if (!title.has(term)) {
      if (!postings.has(term)) postings.set(term, []);
      postings.get(term).push(2 * index);
    }
  }
  return weights => {
    const scores = new Float64Array(cards.length);
    for (const [term, weight] of weights) {
      const matches = postings.get(term);
      if (!matches) continue;
      const value = weight * Math.log1p(cards.length / (1 + matches.length));
      for (const position of matches) scores[position >>> 1] += value * ((position & 1) + 1);
    }
    return scores;
  };
}

function seenBy(evidence) {
  const identities = new Set(evidence.map(row => row.content_id).filter(Boolean));
  return card => [card.id, card.content_id, 'ref-' + card.content_id.slice(8, 32)].some(id => identities.has(id));
}

const genericTerms = new Set(['一下', '想看', '看看', '有没', '没有', '给我', '能不', '介绍', '相关', '内容', '分享', '攻略', '教程', '怎么', '可以', '还有', '有没有', '适合', '最好']);

function publicStarterQuery(providedProfile, evidence) {
  const commands = evidence.filter(row => row.type === 'command');
  const latest = commands.at(-1);
  const nowPositive = [], priorPositive = [], dwell = [];
  for (const row of evidence) {
    const recent = !latest || row.available_at >= latest.available_at;
    if (row.type === 'open' || row.type === 'feedback' && ['like', 'save', 'comment'].includes(row.value)) {
      (recent ? nowPositive : priorPositive).push(row.title + (row.value === 'comment' ? ' ' + row.text : ''));
    } else if (recent && row.type === 'exposure' && row.visible_ms >= 3000) dwell.push(row.title);
  }
  const weights = new Map();
  const add = (text, weight) => {
    const words = [...terms(text)].filter(term => !genericTerms.has(term));
    for (const term of words) weights.set(term, (weights.get(term) ?? 0) + weight / Math.sqrt(words.length));
  };
  const profile = [providedProfile.profile, ...providedProfile.interests, ...providedProfile.entries.map(row => row.value)].join(' ');
  add(profile, latest ? .16 : .65);
  commands.slice(-3).reverse().forEach((row, i) => add(row.text, [2.5, 1.25, .50][i]));
  nowPositive.slice(-9).reverse().forEach((title, i) => add(title, (latest ? .32 : .65) * .86 ** i));
  priorPositive.slice(-5).reverse().forEach((title, i) => add(title, .15 * .80 ** i));
  dwell.slice(-10).reverse().forEach((title, i) => add(title, (latest ? .10 : .22) * .88 ** i));
  const text = latest?.text ?? '';
  const exclusive = text.match(/(?:只|先)(?:找|发|给|看|要)[^，。！？]{0,48}?(图文|视频|文章|文字)/u)?.[1]
    ?? text.match(/(图文|视频|文章|文字)就行/u)?.[1];
  const allowsBoth = /(?:图文|文章|视频)(?:也可以|都可以|都行|也行)|图文和视频|视频和图文/u.test(text);
  const modality = exclusive && !allowsBoth ? exclusive === '视频' ? 'video' : 'text' : null;
  return { weights, modality };
}

const photo = /相[机機]|微[单單]|單反|单反|摄影|攝影|Sony|Canon|Nikon|Fujifilm|autofocus|快[门門]/i;
const motion = /运[动動]|運動|孩子.{0,6}跑|跑起来|跑起來|足球|篮球|籃球|球员|球員|追焦|抓拍|AF-C|伺服|sport|moving subject/i;
const focus = /[对對]焦|追焦|跟焦|连拍|連拍|快[门門]|tracking|shutter|AF-C/i;
const tutorial = /[教示]学|教學|教程|指南|设置|設定|設置|模式|实拍|實拍|演示|技巧|参数|參數|配置|用法|tips|settings|tutorial|guide|how/i;
const places = /浙江|杭州|绍兴|紹興|湖州|嘉兴|嘉興|宁波|寧波|台州|臺州|临海|臨海|衢州|诸暨|諸暨|海宁|海寧|余姚|慈溪|桐庐|桐廬|桐乡|桐鄉|德清|金华|金華|义乌|義烏|南浔|南潯|乌镇|烏鎮|安昌|柯桥|柯橋|乌篷|烏篷|盐官|鹽官|建德|安吉/i;
const transit = /公共交通|公交|地[铁鐵]|高[铁鐵]|城际|城際|换乘|換乘|车站|車站|火[车車]|下[车車]|出站|railway|metro/i;
const day = /[一1]日[游遊]|当天|當天|当日|當日|一天(?:来回|來回|往返)|半日|day trip|same.day/i;
const overnight = /(?:[两兩二三四234]\s*(?:[日天]|晚)|第二天|第三天|过夜|過夜|自[驾駕]|overnight)/i;
const route = /路线|路線|线路|線路|行程|攻略|[游遊]记|[游遊]覽|实拍|實拍|车站|車站|换乘|換乘|出站|下车|下車/i;
const excel = /Excel|Power\s*Query|PowerQuery|VSTACK|工作表|工作簿/i;
const cleaning = /合[并併]|去重|重[复複]|汇总|彙總|追加|串接|合[并併]同|append|consolidat|duplicate/i;
const formulas = /XLOOKUP|VLOOKUP|SUMIF|COUNTIF|按条件|按條件|按分类|按分類|按类别|按類別|条件[求计計統统]|條件[求计計統统]|查找.{0,5}记录|查找.{0,5}記錄|分类合[计計]|分類合[计計]/i;
const python = /Python|\.py\b/i;
const install = /安[装裝]|[下下載]载|下載|环境|環境|PATH|运行|運行|執行|执行|解释器|直[接接]跑|跑起[来來]|腳本|脚本|setup|install|first script|command line/i;
const windows = /Windows|Win(?:10|11)|资源管理器|資源管理員|工作台|办公|辦公|file manager/i;
const files = /文件[夹夾]|文件|档案|檔案|資源管理員|资源管理器|重命名|命名|[归歸][档檔]|查找|卸[载載]|解压|解壓|[优優]化|快捷[键鍵]|效率|file manager|rename/i;
const book = /[阅閱][读讀]|[读讀][书書]|[读讀]后感|讀後感|书单|書單|书评|書評|[书書]荒|[看读讀]书|看書|book\s*(?:review|recommend|list|reco)|read(?:ing|s)\b/i;
const film = /纪录片|紀錄片|电影|電影|[观觀]影|片[单單]|documentary|film|movie|official trailer|系列紀錄|film trailer/i;
const run = /[慢跑]跑|跑步|慢跑|晨跑|配速|running|jogging/i;
const beginner = /新手|初[学學]|[零无無]基[础礎]|第一次|[入初]门|入門|走跑|[热熱]身|配速|呼吸|beginner|start running/i;
const huawei = /[华華][为為]|Huawei/i;
const phoneCamera = /手[机機]|相[机機]|拍照|[摄攝]影|[摄攝]像|[录錄]影|录像|錄像|摄像|拍[摄攝]/i;
const smartphone = /手[机機]|iPhone|Pixel\s*\d|华为|華為|小米|红米|紅米|OPPO|vivo|Galaxy|一加|荣耀|榮耀|smartphone/i;
const imageTest = /拍照|拍[摄攝]|影像|[实實]拍|[摄攝]像|camera|photo/i;
const handsOn = /[测測][评評試试]|实测|實測|[对對]比|对照|對照|[对對][决決]|横评|橫評|体验|體驗|样张|樣張|comparison|review|tested|\bvs\b/i;
const buying = /选购|選購|怎么[选選]|怎麼[选選]|推荐|推薦|[预預]算|第一台|哪款|哪台|[买買].{0,8}相[机機]|which camera|buying guide/i;
const taskTopics = [
  { id: 'motion-photo', hint: s => focus.test(s) && (motion.test(s) || photo.test(s)), card: (t,s) =>
    photo.test(t+' '+s) && motion.test(t+' '+s) && focus.test(t) && !/手机|手機|[无無]人[机機]|運動相機|运动相机|星空|[开開]箱/.test(t) },
  { id: 'rail-day-trip', hint: s => transit.test(s) && day.test(s), card: (t,s) =>
    places.test(t+' '+s) && transit.test(t+' '+s) && day.test(t+' '+s) && route.test(t+' '+s) && !overnight.test(t) },
  { id: 'zhejiang-route', hint: s => places.test(s) && route.test(s), card: (t,s) =>
    places.test(t+' '+s) && route.test(t+' '+s) && !/水[乐樂]园|室内水上|亲子乐园|親子樂園|[商寫写]字楼/.test(t) },
  { id: 'excel-workflow', hint: s => excel.test(s) && cleaning.test(s), card: (t,s) =>
    excel.test(t+' '+s) && cleaning.test(t) && !/Python|Pandas|RPA|Power BI|VBA|数据竞赛|大模型/i.test(t) },
  { id: 'excel-formulas', hint: s => excel.test(s) && formulas.test(s), card: (t,s) =>
    excel.test(t+' '+s) && formulas.test(t) && !/Python|Pandas|VBA|SQL|大模型/i.test(t) },
  { id: 'python-setup', hint: s => python.test(s) && install.test(s), card: (t,s) =>
    python.test(t) && install.test(t+' '+s) && !/Kaggle|Colab|PyInstaller|编译成|編譯成|手机运行|部署|刷题|自动化办公|Excel|Claude Code/i.test(t) },
  { id: 'office-files', hint: s => windows.test(s) && files.test(s) && !/Claude|Python|AI编程|Neovim/i.test(s), card: (t,s) =>
    windows.test(t+' '+s) && files.test(t) && !/Python|大模型|編程|编程|Excel|Power Query|VBA|游戏|數據科學/i.test(t) },
  { id: 'reading', hint: s => book.test(s), card: t => book.test(t) && !/AI读书|AI 读书|Obsidian|MCP|N8N|读书笔记工作流/i.test(t) },
  { id: 'films', hint: s => film.test(s), card: t => film.test(t) },
  { id: 'beginner-running', hint: s => run.test(s) && beginner.test(s), card: t => run.test(t) && beginner.test(t) },
  { id: 'camera-buying', hint: s => photo.test(s) && buying.test(s), card: t =>
    photo.test(t) && buying.test(t) && !/运动\s*相机|運動\s*相機|无人机|無人機|监控|監控|摄像头|攝像頭/i.test(t) },
  { id: 'phone-image-review', hint: s => smartphone.test(s) && imageTest.test(s) && handsOn.test(s), card: (t,s) =>
    smartphone.test(t) && imageTest.test(t) && handsOn.test(t+' '+s) && !/眼底|视网膜|視網膜|retina|glaucoma/i.test(t) },
  { id: 'huawei-camera', hint: s => huawei.test(s) && phoneCamera.test(s), card: (t,s) =>
    huawei.test(t) && phoneCamera.test(t) && tutorial.test(t+' '+s) && !/iPhone|Samsung|三星|小米|OPPO|荣耀|榮耀/i.test(t) },
];

function visibleTopics(evidence) {
  const commands = evidence.filter(row => row.type === 'command');
  const exposures = evidence.filter(row => row.type === 'exposure').slice(-30).reverse();
  const positive = new Set(evidence.filter(row => row.type === 'open' || row.type === 'feedback' && ['like', 'save'].includes(row.value))
    .map(row => row.content_id));
  const score = rule => {
    const words = commands.slice(-4).reverse().reduce((n,row,i)=>n+(rule.hint(row.text)? 13 * .56 ** i : 0),0);
    const views = exposures.reduce((n,row,i) => n + (rule.hint(row.title)
      ? (Math.max(0, Math.min(7, (row.visible_ms ?? 1000) / 1000) - 1) + Number(positive.has(row.content_id))) * .93 ** i : 0), 0);
    return { rule, score: words + views, explicit: words > 0 };
  };
  const ranked = taskTopics.map(score).filter(row => row.score >= .75)
    .sort((a,b)=>b.score-a.score || a.rule.id.localeCompare(b.rule.id));
  return ranked.filter(row => row.score >= (ranked[0]?.score ?? 0)*.21).slice(0,2);
}

const expansionPrefix = /^\s*\[expansion\](?:\s+|$)/i;

export function createDualCandidatePolicy({ C0, Cext }, { independentRecall = false } = {}) {
  const base = C0.cards.map(card => ({ ...card, catalog_pool: 'C0' }));
  const extension = Cext.cards.map(card => ({ ...card, catalog_pool: 'Cext' }));
  const scoreBase = lexicalIndex(base);
  const bySource = Map.groupBy(extension, card => card.source);
  const baseBySource = independentRecall ? Map.groupBy(base, card => card.source) : null;
  const baseById = new Map(base.map(card => [card.id, card]));
  const sourceIndexes = new Map();
  const expansionById = new Map(extension.map(card => [card.id, card]));
  const topicIds = new Map(taskTopics.map(rule => [rule.id, new Set(base.filter(card => rule.card(card.title,card.summary)).map(card => card.id))]));
  const describe = [...bySource].map(([id, cards]) => ({
    id, label: id, configured: true, allowed: true, modes: ['search', 'explore'],
    modalities: [...new Set(cards.map(card => card.modality))].sort(), transport: 'frozen_dual_catalog',
  })).sort((a, b) => a.id.localeCompare(b.id));

  function forCheckpoint({ provided_profile, evidence }) {
    const seen = seenBy(evidence);
    const { weights, modality } = publicStarterQuery(provided_profile, evidence);
    const scores = scoreBase(weights);
    const ranked = base.map((card, index) => ({ card, score: scores[index] * (card.modality === modality ? 1.30 : 1) }))
      .filter(({ card }) => !seen(card))
      .sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id));
    const starter = new Map();
    for (const [index, {rule,explicit}] of visibleTopics(evidence).entries()) {
      const ids = topicIds.get(rule.id), cap = index === 0 ? 8 : 6;
      const sameTopic = ranked.filter(({card}) => ids.has(card.id) && !starter.has(card.id));
      const formatted = modality && explicit ? sameTopic.filter(({card})=>card.modality===modality) : [];
      const alternatives = [...new Map([...formatted,...sameTopic].map(({card})=>[card.id,card])).values()];
      for (const card of alternatives.slice(0,cap)) starter.set(card.id,card);
    }
    for (const {card} of ranked) {
      if (starter.size >= 20) break;
      starter.set(card.id,card);
    }
    const cards = ranked.filter(({card})=>starter.has(card.id)).map(({card})=>card);
    assert.equal(cards.length, 20, 'fewer than twenty unseen starter cards');
    const contrast = ranked.find(({card})=>!starter.has(card.id))?.card;
    assert(contrast, 'missing unseen contrast card');
    return { cards, candidate_ids: cards.map(card => card.id), contrast, contrast_id: contrast.id, seen,
      pool_sha256: C0.lineage.cards_sha256, extension_sha256: Cext.lineage.cards_sha256 };
  }

  function acquire(action, { limit, page = 1 }, seen, baseOpened = false) {
    const { source, query, mode, modality } = action;
    const expanding = independentRecall && expansionPrefix.test(query);
    const useBase = independentRecall && !expanding;
    const side = useBase ? 'C0' : 'Cext';
    const receipt = { source, mode, query, page, transport: 'frozen_dual_catalog',
      pool_sha256: (useBase ? C0 : Cext).lineage.cards_sha256, ...(independentRecall ? { catalog_pool: side } : {}) };
    assert(bySource.has(source) && ['search', 'explore'].includes(mode) && ['text', 'video'].includes(modality));
    assert(Number.isInteger(limit) && limit > 0 && Number.isInteger(page) && page > 0);
    if (expanding && !baseOpened) return { ...receipt, status: 'failed', items: [], error: 'search the base catalog before requesting expansion' };
    const cards = useBase ? (baseBySource.get(source) ?? []) : bySource.get(source);
    const weights = new Map([...terms(expanding ? query.replace(expansionPrefix, '') : query)].map(term => [term, 1]));
    const indexKey = side + ':' + source;
    if (weights.size && !sourceIndexes.has(indexKey)) sourceIndexes.set(indexKey, lexicalIndex(cards));
    const scores = weights.size ? sourceIndexes.get(indexKey)(weights) : null;
    const ranked = cards.map((card, index) => ({ card, score: scores?.[index] ?? 0 }))
      .filter(({ card, score }) => card.modality === modality && !seen(card) && (mode === 'explore' || score > 0))
      .sort((a, b) => b.score - a.score || (mode === 'explore'
        ? String(b.card.published_at ?? '').localeCompare(String(a.card.published_at ?? '')) : 0) || a.card.id.localeCompare(b.card.id));
    const items = ranked.slice((page - 1) * limit, page * limit).map(row => row.card);
    return { ...receipt, status: items.length ? 'ok' : 'empty', items };
  }

  return { catalog: describe, forCheckpoint, acquire, expansionById, baseById, independentRecall,
    requestsExpansion: query => independentRecall && expansionPrefix.test(query),
    eligibleBase: seen => base.filter(card => !seen(card)) };
}
