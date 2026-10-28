import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { siBilibili, siYoutube, siX, siYcombinator, siReddit, siZhihu, siApplepodcasts, siTwitch, siGithub, siSteam, siWikipedia } from 'simple-icons';

const names = { feed:'house', profile:'user', sources:'stack', trace:'clock-counter-clockwise', brain:'brain', tool:'wrench', eye:'eye', robot:'robot', memory:'notebook', spark:'plus', send:'paper-plane-tilt', like:'heart', dislike:'prohibit', save:'bookmark-simple', comment:'chat-circle', external:'arrow-square-out', play:'play', arrow:'arrow-right', down:'arrow-down', northeast:'arrow-up-right', news:'newspaper', close:'x' };
const ui = Object.fromEntries(Object.entries(names).map(([key,name]) => {
  const path = fileURLToPath(import.meta.resolve(`@phosphor-icons/core/regular/${name}.svg`));
  return [key, readFileSync(path, 'utf8').replace('<svg ', '<svg class="ph-icon" aria-hidden="true" ')];
}));
const sources = { bilibili:siBilibili, youtube:siYoutube, x:siX, hackernews:siYcombinator, reddit:siReddit, zhihu:siZhihu, applepodcasts:siApplepodcasts, twitch:siTwitch, github:siGithub, steam:siSteam, wikipedia:siWikipedia };
const brands = Object.fromEntries(Object.entries(sources).map(([key,icon]) => [key, { svg:icon.svg.replace('<svg ', '<svg class="brand-icon" aria-hidden="true" '), color:`#${icon.hex}` }]));
export const iconModule = `export const ui = ${JSON.stringify(ui)};\nexport const brands = ${JSON.stringify(brands)};\n`;
