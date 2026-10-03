/**
 * The Home page search box with a faked index: results replace the cards, filters,
 * clearing, expired entries, hostile text, an unavailable index, night mode, a phone.
 *
 * Run: node test/browser/test-search.mjs
 * Needs Chromium; prints SKIPPED without it. Starts its own preview server.
 */
import { skipWithoutChromium, start } from './lib.mjs';
import { buildIndex } from '../../src/content-index.js';

skipWithoutChromium('test-search.mjs');
const { send, ev, key, ok, sec, errors, done, sleep, base } = await start({ preview: true });

const day = (n) => new Date(Date.now() + 2 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const README = `# T\n\n## 🎓 I'm Going to Study\n\n### Paying for It\n\n-   [NSFAS](https://my.nsfas.org.za/) — Financial aid for students.\n\n## 💼 I'm Going to Work\n\n### Jobs\n\n-   [Learnerships](https://l.org) — Free learnership databases. {tags: learnership}\n-   [<img src=x onerror=window.__pwned=1>](https://evil.org) — "><script>window.__pwned=1</script> bursary trap.\n`;
const OPPS = `# O\n\n## 🎓 I'm Going to Study\n\n### Paying for It\n\n-   [Funza Lushaka](https://f.org) — Teaching bursary. {closes: ${day(5)}; tags: bursary, deadline}\n-   [Sasol Bursary](https://s.org) — Engineering bursary. {closes: ${day(60)}; tags: bursary, engineering}\n`;
const INDEX = { ok: true, ...buildIndex({ readme: README, opportunities: OPPS }) };

let last = null;
const load = async ({ index = INDEX, theme = 'light', width }) => {
  if (last) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: last });
  const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){try{localStorage.setItem('mv-theme','${theme}')}catch(e){}
    var real=window.fetch, R=${JSON.stringify(README)}, O=${JSON.stringify(OPPS)}, I=${JSON.stringify(index)};
    window.fetch=function(u,o){ u=String(u);
      if(u.includes('/__content/README.md')) return Promise.resolve(new Response(R,{status:200}));
      if(u.includes('/__content/OPPORTUNITIES.md')) return Promise.resolve(new Response(O,{status:200}));
      if(u.includes('/api/index.json')) return I===null ? Promise.resolve(new Response('{}',{status:502})) : Promise.resolve(new Response(JSON.stringify(I),{status:200}));
      return real(u,o); };})();` });
  last = r.result.identifier;
  if (width) await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: base + '/' });
  await sleep(1600);
};
const type = async (text) => { await ev(`(()=>{const i=document.getElementById('search-input');i.focus();i.value=${JSON.stringify(text)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(350); };
const names = () => ev(`[...document.querySelectorAll('#search-results .res-name')].map(n=>n.textContent.trim())`);
const mainHidden = () => ev(`document.querySelector('.main-content').classList.contains('hidden')`);
const click = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).click()`);

await load({});
sec('Search box');
ok('no script errors on load', errors.length === 0, JSON.stringify(errors));
ok('the box shows once the index loads', await ev(`!document.getElementById('search').classList.contains('hidden')`));
ok('the input has a visible label', await ev(`document.querySelector('label[for="search-input"]').textContent.trim().length>0`));
ok('four pillar chips and the tags from the index', await ev(`document.querySelectorAll('#search-chips [data-pillar]').length===4 && [...document.querySelectorAll('#search-chips [data-tag]')].map(b=>b.dataset.tag).sort().join()==='bursary,deadline,engineering,learnership'`));
ok('cards are showing before a search', !(await mainHidden()));

sec('Typing');
await type('bursary');
ok('results replace the cards', (await mainHidden()) && (await names()).length >= 2);
const n = await names();
ok('a name match outranks a tag match', n[0] === 'Sasol Bursary', JSON.stringify(n));
await type('deadline');
ok('equal matches: the soonest deadline is first', (await names())[0] === 'Funza Lushaka', JSON.stringify(await names()));
await type('bursary');
ok('status says how many', await ev(`/\\d+ results?/.test(document.getElementById('search-status').textContent)`));
ok('each result says where it lives', await ev(`document.querySelector('#search-results .res-crumb').textContent.includes('›')`));
ok('a deadline pill shows on a result', await ev(`!!document.querySelector('#search-results .res-deadline')`));
ok('hostile names and descriptions are inert text', (await ev(`window.__pwned`)) === undefined && await ev(`!document.querySelector('#search-results img, #search-results script')`));
ok('the clear button appears', await ev(`!document.getElementById('search-clear').classList.contains('hidden')`));
await type('zzzzqq');
ok('no match shows the empty message', (await ev(`!!document.querySelector('#search-results .res-empty')`)) && (await names()).length === 0);

sec('Deadline disclaimer in results');
const sn = `(()=>{const n=document.getElementById('search-deadline-note');return {shown:getComputedStyle(n).display!=='none',text:n.textContent}})()`;
await type('funza');
const withPill = await ev(sn);
ok('results that carry a deadline show the disclaimer', withPill.shown && /check the official page/i.test(withPill.text), JSON.stringify(withPill));
await type('nsfas');
ok('results with no deadline do not', (await ev(sn)).shown === false);
await type('bursary');

sec('Clearing');
await key('Escape', 'Escape');
await sleep(300);
ok('Escape clears the box and brings the cards back', (await ev(`document.getElementById('search-input').value===''`)) && !(await mainHidden()) && (await names()).length === 0);
await type('nsfas'); await click('#search-clear'); await sleep(200);
ok('the clear button does too', !(await mainHidden()));
ok('clearing removes the disclaimer from the search area', (await ev(sn)).shown === false);

sec('Filters');
await click('[data-pillar="work"]'); await sleep(200);
ok('a pillar chip alone lists that pillar, and is marked pressed', (await names()).every((x) => ['Learnerships', '<img src=x onerror=window.__pwned=1>'].includes(x)) && await ev(`document.querySelector('[data-pillar="work"]').getAttribute('aria-pressed')==='true'`), JSON.stringify(await names()));
await click('[data-pillar="work"]'); await sleep(200);
ok('pressing it again clears the filter', !(await mainHidden()));
await click('[data-tag="engineering"]'); await sleep(200);
eqNames(await names(), ['Sasol Bursary'], 'a tag chip filters');
await click('[data-tag="deadline"]'); await sleep(200);
eqNames(await names(), [], 'two tags must both match');
await click('[data-tag="deadline"]'); await click('[data-tag="engineering"]'); await sleep(200);
await type('funza'); await click('[data-tag="bursary"]'); await sleep(200);
eqNames(await names(), ['Funza Lushaka'], 'a query and a tag combine');
await click('#search-clear'); await sleep(200);
function eqNames(got, want, name) { ok(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got)); }

sec('Path cards');
await type('bursary');
await click('.path-card[data-section="work"]'); await sleep(200);
ok('picking a path clears the search and shows that path', !(await mainHidden()) && await ev(`document.getElementById('search-input').value===''`) && await ev(`!document.getElementById('section-work').classList.contains('hidden')`));

sec('Night mode and a phone');
await load({ theme: 'dark', width: 390 });
await type('bursary');
ok('results render in night mode', (await names()).length >= 2);
ok('no horizontal scroll at 390px', await ev(`document.documentElement.scrollWidth<=document.documentElement.clientWidth`), await ev(`document.documentElement.scrollWidth+' vs '+document.documentElement.clientWidth`));
const pressed = await (async () => { await click('[data-tag="bursary"]'); await sleep(200); return ev(`(()=>{const c=getComputedStyle(document.querySelector('[data-tag="bursary"]'));const lum=s=>{const m=s.match(/\\d+/g).map(Number).slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*m[0]+.7152*m[1]+.0722*m[2]};const a=lum(c.color),b=lum(c.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()`); })();
ok('a pressed chip is at least 4.5:1 in night mode', pressed >= 4.5, String(pressed));

sec('Index unavailable');
await load({ index: null, width: 1100 });
ok('the search box stays hidden', await ev(`document.getElementById('search').classList.contains('hidden')`));
ok('the page itself still works', await ev(`document.querySelectorAll('#study-content .res-row').length>0`));
ok('no script errors', errors.length === 0, JSON.stringify(errors));

await done();
