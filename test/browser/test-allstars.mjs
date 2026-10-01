/**
 * The All Stars page with faked GitHub and ALL-STARS.md data: bots filtered, hostile names, a failing avatar, empty and error states, night mode and a phone.
 *
 * Run: node test/browser/test-allstars.mjs
 * Needs Chromium; prints SKIPPED without it. Starts its own preview server.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { skipWithoutChromium, start } from './lib.mjs';

skipWithoutChromium('test-allstars.mjs');
const { send, ev, key, ok, sec, errors, done, sleep, base } = await start({ preview: true });
let lastScript=null;
const load=async({gh,stars,theme='light'})=>{
  if(lastScript) await send('Page.removeScriptToEvaluateOnNewDocument',{identifier:lastScript});
  const r=await send('Page.addScriptToEvaluateOnNewDocument',{source:`(function(){try{localStorage.setItem('mv-theme','${theme}')}catch(e){}
   var real=window.fetch; var GH=${JSON.stringify(gh)}, ST=${JSON.stringify(stars)};
   window.fetch=function(u,o){ u=String(u);
     if(u.includes('api.github.com')){ if(GH===null) return Promise.reject(new TypeError('NetworkError')); if(GH==='403') return Promise.resolve(new Response('{"message":"rate limited"}',{status:403})); return Promise.resolve(new Response(JSON.stringify(GH),{status:200})); }
     if(u.includes('ALL-STARS.md')){ if(ST===null) return Promise.reject(new TypeError('NetworkError')); return Promise.resolve(new Response(ST,{status:200})); }
     return real(u,o); };})();`});
  lastScript=r.result.identifier;
  await send('Page.navigate',{url:base+'/allstars/'});await sleep(1600);};


const people=[
 {login:'ada',type:'User',html_url:'https://github.com/ada',avatar_url:'http://127.0.0.1:1/ada.png?v=4',contributions:12},
 {login:'grace',type:'User',html_url:'https://github.com/grace',avatar_url:'http://127.0.0.1:1/grace.png?v=4',contributions:1},
 {login:'dependabot[bot]',type:'Bot',html_url:'https://github.com/apps/dependabot',avatar_url:'http://127.0.0.1:1/b.png?v=4',contributions:40},
 {login:'"><img src=x onerror=window.__pwned=1>',type:'User',html_url:'https://github.com/evil',avatar_url:'http://127.0.0.1:1/e.png?v=4',contributions:2},
 {login:'a-very-very-very-long-github-username-that-should-wrap-nicely-and-not-overflow-the-card',type:'User',html_url:'https://github.com/long',avatar_url:'http://127.0.0.1:1/l.png?v=4',contributions:3},
];
const STARS=`# All Stars\n\n## GitHub Contributors\n\nauto\n\n## Community Contributors\n\n- **Thandi M.** | Research | Soweto\n- **<b>Bold</b> Name** | Outreach | \n- **Zola** | Translation | Durban\n\n## Other\n`;

await load({gh:people,stars:STARS});
sec('GitHub contributors');
ok('no script errors',errors.length===0,JSON.stringify(errors));
ok('the bot is not listed',await ev(`![...document.querySelectorAll('#github-contributors .star-name')].some(n=>/dependabot/.test(n.textContent))`));
ok('the four people are',await ev(`document.querySelectorAll('#github-contributors .star-card').length===4`));
ok('each card is a link to the profile, opening in a new tab safely',await ev(`[...document.querySelectorAll('#github-contributors a.star-card')].every(a=>/^https:\\/\\/github\\.com\\//.test(a.href)&&a.target==='_blank'&&/noopener/.test(a.rel))`));
ok('"1 contribution" is singular, others plural',await ev(`(()=>{const t=[...document.querySelectorAll('#github-contributors .star-role')].map(e=>e.textContent);return t.includes('1 contribution')&&t.includes('12 contributions')})()`));
ok('a hostile username is shown as text, injecting nothing',await ev(`!window.__pwned && !document.querySelector('#github-contributors img[src="x"]') && [...document.querySelectorAll('.star-name')].some(n=>n.textContent.includes('<img src=x'))`));
ok('a very long username wraps inside its card',await ev(`[...document.querySelectorAll('#github-contributors .star-card')].every(c=>c.scrollWidth<=c.clientWidth+1)`));
ok('a photo that fails to load is removed, leaving the diamond tile',await ev(`document.querySelectorAll('#github-contributors .tile img').length===0 && getComputedStyle(document.querySelector('#github-contributors .tile')).backgroundColor!=='rgba(0, 0, 0, 0)'`));
const tiles=await ev(`JSON.stringify([...document.querySelectorAll('.tile')].map(t=>t.getAttribute('style')))`);
ok('tile colours are pastels from the palette',JSON.parse(tiles).every(s=>/--a:var\(--(peach|blush|sage|butter|lilac)\)/.test(s)),tiles);
ok('...different people get different tiles',new Set(JSON.parse(tiles)).size>1);
await load({gh:people,stars:STARS});
ok('...and a person always gets the same one on reload',await ev(`JSON.stringify([...document.querySelectorAll('.tile')].map(t=>t.getAttribute('style')))`)===tiles);

sec('community contributors');
ok('three people from ALL-STARS.md',await ev(`document.querySelectorAll('#community-contributors .star-card').length===3`));
ok('name, role and location are shown',await ev(`(()=>{const c=document.querySelector('#community-contributors .star-card');return /Thandi/.test(c.querySelector('.star-name').textContent)&&c.querySelector('.star-role').textContent==='Research'&&c.querySelector('.star-where').textContent==='Soweto'})()`));
ok('a person with no location simply has no location line',await ev(`(()=>{const c=[...document.querySelectorAll('#community-contributors .star-card')][1];return !c.querySelector('.star-where')})()`));
ok('HTML in a name is text, not markup',await ev(`!document.querySelector('#community-contributors b') && /<b>Bold/.test(document.querySelectorAll('#community-contributors .star-name')[1].textContent)`));
ok('community cards are not links (no profile to go to)',await ev(`!document.querySelector('#community-contributors a.star-card')`));
ok('the parser stops at the next ## heading',await ev(`![...document.querySelectorAll('#community-contributors .star-name')].some(n=>/Other/.test(n.textContent))`));

sec('empty and failing');
await load({gh:[people[2]],stars:`# x\n\n## Community Contributors\n\n`});
ok('only a bot, so GitHub list says "be the first"',await ev(`/be the first/.test(document.getElementById('github-contributors').textContent)`));
ok('no community entries gives the friendly note with both links',await ev(`(()=>{const e=document.getElementById('community-contributors');return /No community contributors/.test(e.textContent)&&!!e.querySelector('a[href*="instagram"]')&&!!e.querySelector('a[href*="linkedin"]')})()`));
await load({gh:'403',stars:STARS});
ok('GitHub rate limit: error shows with a way out',await ev(`!document.getElementById('github-error').classList.contains('hidden') && /graphs\\/contributors/.test(document.querySelector('#github-error a').href) && document.getElementById('github-loading').classList.contains('hidden')`));
ok('...and the community list still loads (the two are independent)',await ev(`document.querySelectorAll('#community-contributors .star-card').length===3`));
await load({gh:people,stars:null});
ok('ALL-STARS.md unreachable: error shows, and GitHub list still loads',await ev(`!document.getElementById('community-error').classList.contains('hidden') && document.querySelectorAll('#github-contributors .star-card').length===4`));

sec('night and phone');
await load({gh:people,stars:STARS,theme:'dark'});
ok('cards and text take the night colours',await ev(`getComputedStyle(document.querySelector('.star-card')).backgroundColor==='rgb(14, 44, 44)' && getComputedStyle(document.querySelector('.star-role')).color==='rgb(169, 188, 187)'`));
await send('Emulation.setDeviceMetricsOverride',{width:375,height:800,deviceScaleFactor:1,mobile:true});await sleep(500);
const ph=JSON.parse(await ev(`JSON.stringify({sw:document.documentElement.scrollWidth,iw:window.innerWidth,cols:getComputedStyle(document.querySelector('.star-grid')).gridTemplateColumns.split(' ').length})`));
ok('no sideways scrolling on a phone',ph.sw<=ph.iw,JSON.stringify(ph));
ok('cards stack in one column',ph.cols===1,JSON.stringify(ph));
ok('still no script errors',errors.length===0,JSON.stringify(errors));

await done();
