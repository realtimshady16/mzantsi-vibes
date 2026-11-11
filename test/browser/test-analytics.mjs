/**
 * The three Umami events: which pillar was opened, what was searched for, and
 * whether anyone left for a provider. Pageviews alone cannot answer any of those
 * — the site is one URL — so this stubs window.umami before the page loads and
 * checks what our code sends it.
 *
 * Also checks the failure that matters: no umami object at all (blocked, offline,
 * or a slow script) must leave the page working, not throw.
 *
 * Run: node test/browser/test-analytics.mjs
 * Needs Chromium; prints SKIPPED without it. Starts its own preview server.
 */
import { skipWithoutChromium, start } from './lib.mjs';

skipWithoutChromium('test-analytics.mjs');
const { send, ev, ok, sec, errors, done, sleep, waitFor, base } = await start({ preview: true });

const day = (n) => new Date(Date.now() + 2 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const README = `# T\n\n## 🎓 I'm Going to Study\n\n### Paying for It\n\n`
  + `-   [NSFAS](https://my.nsfas.org.za/) — Financial aid.\n`
  + `-   [Siyavula](https://www.siyavula.com/) — Free study material.\n`;
const OPPS = `# O\n\n## 🎓 I'm Going to Study\n\n### Paying for It\n\n`
  + `-   [Soon](https://www.zabursaries.co.za/soon/) — Closes in five days. {closes: ${day(5)}}\n`;

/* A stub, so the real Umami script (blocked here) cannot interfere and the events
   are observable. `withUmami: false` leaves the page with none, like a blocked
   script. Each load removes the previous injection, or the earlier one would
   still be running and the "no umami" case would quietly keep its stub. */
let last = null;
const load = async ({ withUmami = true, theme = 'light' } = {}) => {
  if (last) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: last });
  const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){
    window.__events=[];
    ${withUmami ? `window.umami={track:function(n,d){window.__events.push([n,d])}};` : ''}
    try{localStorage.setItem('mv-theme','${theme}')}catch(e){}
    var real=window.fetch, R=${JSON.stringify(README)}, O=${JSON.stringify(OPPS)};
    window.fetch=function(u,o){ u=String(u);
      if(u.includes('/__content/README.md')) return Promise.resolve(new Response(R,{status:200}));
      if(u.includes('/__content/OPPORTUNITIES.md')) return Promise.resolve(new Response(O,{status:200}));
      return real(u,o); };})();` });
  last = r.result.identifier;
  await send('Page.navigate', { url: base + '/' });
  await waitFor(`document.getElementById('loading-state')?.classList.contains('hidden')`);
};

const events = () => ev(`window.__events`);
const eventsNamed = (name) => ev(`window.__events.filter(e=>e[0]===${JSON.stringify(name)})`);

/* -------------------------------------------------------------- */
await load();
sec('the page rendered with a stubbed umami');
ok('no script errors', errors.length === 0, JSON.stringify(errors));
ok('a pageview happens on its own, so we do not send one', JSON.stringify(await events()) === '[]', JSON.stringify(await events()));

sec('opening a pillar');
await ev(`document.querySelector('.path-card[data-section="work"]').click()`);
await sleep(200);
const sectionEvents = await eventsNamed('section');
ok('clicking a path card sends one section event', sectionEvents.length === 1, JSON.stringify(sectionEvents));
ok('and says which pillar', sectionEvents[0]?.[1]?.pillar === 'work', JSON.stringify(sectionEvents[0]));

sec('searching');
await ev(`(()=>{const i=document.getElementById('search-input');i.value='n';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await sleep(1300);
ok('a single character is not a search', (await eventsNamed('search')).length === 0, JSON.stringify(await eventsNamed('search')));
await ev(`(()=>{const i=document.getElementById('search-input');i.value='bursary';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await waitFor(`window.__events.some(e=>e[0]==='search')`);
const searches = await eventsNamed('search');
ok('a settled query is sent once, not once per keystroke', searches.length === 1, JSON.stringify(searches));
ok('with the query text', searches[0]?.[1]?.query === 'bursary', JSON.stringify(searches[0]));
ok('and the number of results, so a failed search is visible', typeof searches[0]?.[1]?.hits === 'number', JSON.stringify(searches[0]));

sec('a long query is truncated');
await ev(`(()=>{const i=document.getElementById('search-input');i.value='${'x'.repeat(120)}';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await sleep(1300);
const long = (await eventsNamed('search')).pop();
ok('a 120-character query is cut at 60', long?.[1]?.query?.length === 60, String(long?.[1]?.query?.length));

sec('clicking through to a provider');
await ev(`(()=>{const a=document.querySelector('a.res-row');a.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))})()`);
await sleep(200);
const outbound = await eventsNamed('outbound');
ok('a result click sends an outbound event', outbound.length === 1, JSON.stringify(outbound));
ok('with the host, not the full URL', outbound[0]?.[1]?.host === 'my.nsfas.org.za' || outbound[0]?.[1]?.host === 'zabursaries.co.za', JSON.stringify(outbound[0]));
ok('and enough to identify the entry', typeof outbound[0]?.[1]?.name === 'string' && outbound[0][1].name.length > 0, JSON.stringify(outbound[0]));

sec('with no umami at all (blocked or offline)');
await load({ withUmami: false });
ok('the page still renders', (await ev(`document.querySelectorAll('.res-row').length`)) > 0);
await ev(`document.querySelector('.path-card[data-section="work"]').click()`);
await sleep(150);
ok('and clicking still works', await ev(`!document.getElementById('section-work').classList.contains('hidden')`));
ok('and no error is raised', errors.length === 0, JSON.stringify(errors));

done();
