/**
 * The Tasks page, driven with the repo's real TASKS.md as its data: filters, ordering, empty and error states, a hostile title, night mode and a phone.
 *
 * Run: node test/browser/test-tasks.mjs
 * Needs Chromium; prints SKIPPED without it. Starts its own preview server.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { skipWithoutChromium, start } from './lib.mjs';

skipWithoutChromium('test-tasks.mjs');
const { send, ev, key, ok, sec, errors, done, sleep, base } = await start({ preview: true });
const TASKS = fs.readFileSync(fileURLToPath(new URL('../../TASKS.md', import.meta.url)), 'utf8');
let lastScript=null;
const load=async(tasksText,{reject=false}={})=>{
  if(lastScript) await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:lastScript});
  const r=await send('Page.addScriptToEvaluateOnNewDocument',{source:`(function(){try{localStorage.setItem('mv-theme','light')}catch(e){}
   var real=window.fetch; window.fetch=function(u,o){ if(String(u).includes('TASKS.md')){ ${reject?`return Promise.reject(new TypeError('NetworkError'))`:`return Promise.resolve(new Response(${JSON.stringify(tasksText)},{status:200}))`} } return real(u,o); };})();`});
  lastScript=r.result.identifier;
  await send('Page.navigate',{url:base+'/tasks/'});await sleep(1500);};


// A hostile task title, to prove nothing is injected.
const EVIL = TASKS + `\n\n### #099 <img src=x onerror="window.__pwned=1"> Evil\n**Status:** 🔴 Needs doing\n**Difficulty:** Easy\n**Type:** Content\n**Section:** x\n\nBody <script>window.__pwned=1</script>\n`;
await load(EVIL);

sec('loads and lists');
const total=await ev(`document.querySelectorAll('.task-card').length`);
ok('every task in TASKS.md is shown',total>=21,String(total));
ok('no script errors',errors.length===0,JSON.stringify(errors));
ok('a hostile title injects nothing (no element, no script ran)',await ev(`!window.__pwned && !document.querySelector('.task-list img, .task-list script')`));
ok('the hostile text is shown as plain text instead',await ev(`document.querySelector('.task-list').textContent.includes('<img src=x')`));
const cnt=await ev(`document.getElementById('task-count').textContent`);
const open=await ev(`document.querySelectorAll('.task-card[data-status="needs-doing"]').length`);
ok('the count line matches the cards',cnt===`${open} open task${open!==1?'s':''} · ${total} total`,cnt);
const order=await ev(`JSON.stringify([...document.querySelectorAll('.task-card')].map(c=>c.dataset.status))`);
const rank={'needs-doing':0,'in-progress':1,'done':2};const o=JSON.parse(order).map(s=>rank[s]);
ok('open work comes first, then in progress, then done',o.every((v,i)=>i===0||v>=o[i-1]));
ok('there is no status heading any more: each card carries its own',await ev(`!document.querySelector('.status-heading') && [...document.querySelectorAll('.task-card')].every(c=>c.querySelector('.task-status .dot'))`));
ok('the status dot uses the design colours',await ev(`getComputedStyle(document.querySelector('.task-card[data-status="needs-doing"] .dot')).backgroundColor==='rgb(230, 147, 153)'`));
ok('the task number is kept next to the status',await ev(`/#\\d+/.test(document.querySelector('.task-status').textContent)`));
ok('type chips use the design pastels (content = sage)',await ev(`getComputedStyle(document.querySelector('.chip-content')).backgroundColor==='rgb(200, 232, 205)'`));
ok('difficulty is an outlined chip',await ev(`getComputedStyle(document.querySelector('.chip-diff')).borderTopStyle==='solid' && parseFloat(getComputedStyle(document.querySelector('.chip-diff')).borderTopWidth)>=1`));
ok('done tasks are quieter',await ev(`!document.querySelector('.task-card.task-done') || parseFloat(getComputedStyle(document.querySelector('.task-card.task-done')).opacity)<1`));

sec('filters');
const pill=(f,v)=>`document.querySelector('.filter-pill[data-filter="${f}"][data-value="${v}"]')`;
await ev(`${pill('status','done')}.click()`);await sleep(100);
const doneN=await ev(`document.querySelectorAll('.task-card').length`);
ok('Status: Done shows only done tasks',await ev(`[...document.querySelectorAll('.task-card')].every(c=>c.dataset.status==='done')`)&&doneN>0,String(doneN));
ok('...and the count says "Showing n of total"',(await ev(`document.getElementById('task-count').textContent`))===`Showing ${doneN} of ${total} tasks`);
ok('the chosen pill is filled and reported as pressed',await ev(`${pill('status','done')}.getAttribute('aria-pressed')==='true' && ${pill('status','all')}.getAttribute('aria-pressed')==='false' && getComputedStyle(${pill('status','done')}).backgroundColor==='rgb(0, 68, 68)'`));
await ev(`${pill('status','all')}.click();${pill('difficulty','easy')}.click();${pill('type','content')}.click()`);await sleep(100);
ok('filters combine (Easy AND Content)',await ev(`[...document.querySelectorAll('.task-card')].every(c=>c.dataset.difficulty==='easy' && c.dataset.type.split(' ').includes('content'))`));
// find a combination that matches nothing
const empty=JSON.parse(await ev(`(()=>{const sts=['needs-doing','in-progress','done'],dfs=['easy','medium','hard'],tys=['content','translation','code','design'];const all=[...document.querySelectorAll('.task-card')];return JSON.stringify((()=>{for(const s of sts)for(const d of dfs)for(const y of tys){}return null})())})()`));
await ev(`document.querySelectorAll('.filter-pill').forEach(p=>{if(p.dataset.value==='all')p.click()})`);
let combo=null;
for (const s of ['done','in-progress','needs-doing']) for (const d of ['hard','medium','easy']) for (const y of ['design','translation','code','content']) {
  if (combo) break;
  await ev(`${pill('status',s)}.click();${pill('difficulty',d)}.click();${pill('type',y)}.click()`);
  if (await ev(`document.querySelectorAll('.task-card').length===0`)) combo=[s,d,y];
}
ok('a combination with no tasks exists to test the empty state',!!combo,JSON.stringify(combo));
ok('the empty state is friendly and offers a way out',await ev(`/No tasks match/.test(document.getElementById('tasks-container').textContent) && !!document.querySelector('.link-btn')`));
await ev(`document.querySelector('.link-btn').click()`);await sleep(100);
ok('"Clear filters" brings everything back and resets every pill',await ev(`document.querySelectorAll('.task-card').length===${total} && [...document.querySelectorAll('.filter-pill')].every(p=>(p.dataset.value==='all')===(p.getAttribute('aria-pressed')==='true'))`));

sec('night mode');
await ev(`document.querySelector('.theme-toggle').click()`);await sleep(200);
ok('cards and pills take the night colours',await ev(`getComputedStyle(document.querySelector('.task-card')).backgroundColor==='rgb(14, 44, 44)' && getComputedStyle(${pill('status','all')}).backgroundColor==='rgb(247, 236, 190)'`));
ok('the type chips keep dark text on their pastel',await ev(`getComputedStyle(document.querySelector('.chip-content')).color==='rgb(14, 38, 38)'`));

sec('phone width (375px)');
await send('Emulation.setDeviceMetricsOverride',{width:375,height:800,deviceScaleFactor:1,mobile:true});await sleep(500);
const ph=JSON.parse(await ev(`JSON.stringify({sw:document.documentElement.scrollWidth,iw:window.innerWidth,rows:[...document.querySelectorAll('.filter-row')].map(r=>getComputedStyle(r).gridTemplateColumns.split(' ').length)})`));
ok('no sideways scrolling',ph.sw<=ph.iw,JSON.stringify(ph));
ok('the filter labels sit above their chips',ph.rows.every(n=>n===1),JSON.stringify(ph.rows));

sec('when the tasks cannot be loaded');
await send('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false});
await load('',{reject:true});
ok('a clear message shows, and the spinner is gone',await ev(`!document.getElementById('error-state').classList.contains('hidden') && document.getElementById('loading-state').classList.contains('hidden')`));
ok('the "View them on GitHub instead" link is still there',await ev(`/GitHub instead/.test(document.querySelector('.github-link').textContent) && /TASKS\\.md/.test(document.querySelector('.github-link').href)`));

await done();
