/**
 * The Contribute form, driven against a mock API that this test serves itself (so it can
 * return a 429, an HTML 502, and so on): the editor and both tabs, the flow switch, the
 * new-section fix, submit, every kind of failure, the hidden honeypot, keyboard use, the
 * link tooltip, night mode, and a phone.
 *
 * Run: node test/browser/test-contribute.mjs
 * Needs Chromium; prints SKIPPED without it.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipWithoutChromium, start, freePort } from './lib.mjs';

skipWithoutChromium('test-contribute.mjs');
const PORT = await freePort();
let last = null;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const ROOT=fileURLToPath(new URL('../../PUBLISH/', import.meta.url)).replace(/\/$/,'');
const srv=http.createServer((req,res)=>{const u=new URL(req.url,'http://x');
 if(u.pathname==='/api/sections'){res.setHeader('content-type','application/json');return res.end(JSON.stringify({ok:true,groups:[{pillar:"🎓 I'm Going to Study",sections:['Before You Apply','Paying for It']},{pillar:'💼 I\'m Going to Work',sections:['Finding Work']}]}));}
 if(u.pathname==='/api/submit'){let b='';req.on('data',d=>b+=d);req.on('end',()=>{last=JSON.parse(b);res.setHeader('content-type','application/json');
   if((last.content||'').includes('HTMLERR')){res.statusCode=502;res.setHeader('content-type','text/html');return res.end('<html><body><h1>502 Bad gateway</h1></body></html>');}
   if((last.content||'').includes('RATELIMIT')){res.statusCode=429;return res.end(JSON.stringify({ok:false,error:'That\'s a few submissions in a short time. Please try again in 30 minutes.'}));}
   res.statusCode=201;res.end(JSON.stringify({ok:true,prNumber:99,prUrl:'https://example.com/pr/99'}));});return;}
 let p=u.pathname;if(p.endsWith('/'))p+='index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.statusCode=404;return res.end();}
 res.setHeader('content-type',types[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));}).listen(PORT);
const { send, ev, key, ok, sec, errors, done, sleep } = await start({ preview: false });
const Q=k=>`Quill.find(document.querySelector('[data-editor=${k}] .editor-rich'))`;
await send('Page.addScriptToEvaluateOnNewDocument',{source:`try{localStorage.setItem('mv-theme','light')}catch(e){}`});
await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/contribute/`});await sleep(1800);
console.log('starting theme:',await ev(`document.documentElement.dataset.theme`));

sec('loads');
ok('no script errors on load',errors.length===0,JSON.stringify(errors));
ok('live sections come from the API and are grouped by pillar',await ev(`document.querySelectorAll('#section optgroup').length===2 && /live sections/.test(document.getElementById('sectionsNote').textContent)`));
ok('each pillar offers "+ New section"',await ev(`[...document.querySelectorAll('#section option')].filter(o=>o.value.startsWith('new::')).length===2`));
ok('default flow shows the NEW fields and hides the EDIT fields',await ev(`getComputedStyle(document.getElementById('newFields')).display!=='none' && getComputedStyle(document.getElementById('editFields')).display==='none'`));
ok('the selected card is the butter one (checked radio styles its sibling)',await ev(`getComputedStyle(document.querySelector('#flowNew + .choice-body')).backgroundColor==='rgb(247, 236, 190)'`));

sec('the honeypot stays invisible and unreachable');
const hp=JSON.parse(await ev(`(()=>{const w=document.getElementById('website');const r=w.getBoundingClientRect();const box=document.querySelector('.hp');return JSON.stringify({left:r.left,w:r.width,h:r.height,tab:w.tabIndex,hidden:box.getAttribute('aria-hidden'),visible:!!(w.offsetWidth&&w.offsetHeight&&r.left>0)})})()`));
ok('it sits far off-screen',hp.left<-1000,JSON.stringify(hp));
ok('it is not in the tab order and is hidden from screen readers',hp.tab===-1&&hp.hidden==='true');
ok('a person can never see or reach it',!hp.visible);
ok('the design\'s visible "Website" field is not on the page',await ev(`![...document.querySelectorAll('label')].some(l=>l.textContent.trim()==='Website' && l.closest('.hp')===null)`));

sec('flow switch');
await ev(`document.getElementById('flowEdit').click()`);await sleep(100);
ok('"Correct something" shows the EDIT fields and hides the NEW ones',await ev(`getComputedStyle(document.getElementById('editFields')).display!=='none' && getComputedStyle(document.getElementById('newFields')).display==='none'`));
ok('the card styling follows the radio',await ev(`getComputedStyle(document.querySelector('#flowEdit + .choice-body')).backgroundColor==='rgb(247, 236, 190)' && getComputedStyle(document.querySelector('#flowNew + .choice-body')).backgroundColor!=='rgb(247, 236, 190)'`));
await ev(`document.getElementById('flowNew').click()`);await sleep(100);

sec('the editor');
await ev(`${Q('content')}.focus()`);await send('Input.insertText',{text:'Learnerships'});
await ev(`(()=>{const q=${Q('content')};q.formatText(0,12,'link','https://example.org/learn','user');q.setSelection(q.getLength()-1,0)})()`);
await send('Input.insertText',{text:' - Free databases'});await sleep(150);
let md=await ev(`document.getElementById('content').value`);
ok('typing in the rich editor produces markdown',md==='[Learnerships](https://example.org/learn) - Free databases',JSON.stringify(md));
ok('the counter follows it',await ev(`document.querySelector('[data-editor=content]').nextElementSibling.textContent`)===`${md.length} / 4000`);
await ev(`document.querySelector('[data-editor=content] [data-mode=markdown]').click()`);
ok('Markdown tab shows the textarea and hides the rich editor',await ev(`!document.querySelector('[data-editor=content] [data-pane=markdown]').hidden && getComputedStyle(document.querySelector('[data-editor=content] [data-pane=richtext]')).display==='none'`));
ok('the active tab is the filled one',await ev(`getComputedStyle(document.querySelector('[data-editor=content] [data-mode=markdown]')).backgroundColor==='rgb(0, 68, 68)'`));
await ev(`document.querySelector('[data-editor=content] [data-mode=richtext]').click()`);await sleep(100);
ok('switching back keeps the content as a real link',await ev(`/<a [^>]*href="https:\\/\\/example.org\\/learn"/.test(${Q('content')}.root.innerHTML)`));
ok('the rich box has an accessible name',await ev(`${Q('content')}.root.getAttribute('aria-label')==='Your resource'`));

sec('the link tooltip (Quill) matches the theme');
await ev(`${Q('content')}.focus();${Q('content')}.setSelection(20,4)`);
await ev(`document.querySelector('[data-editor=content] .ql-link').click()`);await sleep(250);
const tip=JSON.parse(await ev(`(()=>{const t=document.querySelector('[data-editor=content] .ql-tooltip');const s=getComputedStyle(t);return JSON.stringify({shown:!t.classList.contains('ql-hidden'),bg:s.backgroundColor,shadow:s.boxShadow,radius:s.borderRadius})})()`));
ok('the tooltip opens',tip.shown,JSON.stringify(tip));
ok('it uses the card colour, rounded, and no shadow',tip.bg==='rgb(254, 251, 246)'&&tip.shadow==='none'&&parseInt(tip.radius)>=14,JSON.stringify(tip));
await ev(`${Q('content')}.setSelection(0,0);document.activeElement.blur()`);

sec('keyboard');
await ev(`document.getElementById('handle').focus()`);
await ev(`document.activeElement.blur(); window.scrollTo(0,0)`);
let reached=false;for(let i=0;i<14;i++){await key('Tab','Tab');if(await ev(`document.activeElement&&document.activeElement.id==='flowNew'`)){reached=true;break;}}
ok('Tab reaches the first radio',reached);
ok('a keyboard focus ring shows on the card',await ev(`getComputedStyle(document.querySelector('#flowNew + .choice-body')).outlineStyle==='solid'`));
await key('ArrowRight','ArrowRight');await sleep(100);
ok('arrow keys move the choice',await ev(`document.getElementById('flowEdit').checked`));
await ev(`document.getElementById('flowNew').click()`);

sec('new section (the bug fixed earlier), and submit');
await ev(`(()=>{const s=document.getElementById('section');s.value=[...s.options].find(o=>o.value.startsWith('new::')).value;s.dispatchEvent(new Event('change'));document.getElementById('newSectionName').value='Learnerships'})()`);
ok('the new-section name field appears',await ev(`getComputedStyle(document.getElementById('newSectionWrap')).display!=='none'`));
await ev(`document.getElementById('handle').value='Thandi M.';document.getElementById('contributeForm').requestSubmit()`);await sleep(700);
ok('sends plain "new" with the pillar and name',last&&last.section==='new'&&last.pillar.includes('Going to Study')&&last.newSectionName==='Learnerships',JSON.stringify(last));
ok('the content is the converted markdown, format says rich text',last.content.includes('[Learnerships](https://example.org/learn)')&&last.format==='richtext');
ok('the honeypot field is sent empty',last.website==='');
const st=JSON.parse(await ev(`(()=>{const b=document.getElementById('status');return JSON.stringify({hidden:b.classList.contains('hidden'),cls:b.className,text:b.textContent,bg:getComputedStyle(b).backgroundColor,link:!!b.querySelector('a[href="https://example.com/pr/99"]')})})()`));
ok('a success message shows with the PR link',!st.hidden&&/success/.test(st.cls)&&st.link&&/#99/.test(st.text),JSON.stringify(st));
ok('success is the sage pastel',st.bg==='rgb(200, 232, 205)',st.bg);
ok('the form and editor are cleared afterwards',await ev(`document.getElementById('content').value==='' && ${Q('content')}.getText().trim()==='' && document.getElementById('handle').value===''`));
ok('the button is usable again',await ev(`!document.getElementById('submitBtn').disabled && document.getElementById('submitBtn').textContent==='Send it in'`));

sec('errors');
await ev(`(()=>{const s=document.getElementById('section');s.value='Before You Apply';document.querySelector('[data-editor=content] [data-mode=markdown]').click();document.getElementById('content').value='RATELIMIT';document.getElementById('contributeForm').requestSubmit()})()`);await sleep(700);
const er=JSON.parse(await ev(`(()=>{const b=document.getElementById('status');return JSON.stringify({cls:b.className,text:b.textContent,bg:getComputedStyle(b).backgroundColor})})()`));
ok('a server error shows in the blush box with its message',/error/.test(er.cls)&&/few submissions/.test(er.text)&&er.bg==='rgb(255, 203, 206)',JSON.stringify(er));
await ev(`(()=>{document.getElementById('content').value='';document.getElementById('contributeForm').requestSubmit()})()`);await sleep(200);
ok('an empty submission is stopped with a gentle warning (butter)',await ev(`/warning/.test(document.getElementById('status').className) && getComputedStyle(document.getElementById('status')).backgroundColor==='rgb(247, 236, 190)'`));

sec('code samples at a desktop width with the column beside "How it works"');
await send('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false});await sleep(400);
ok('no sample is clipped',await ev(`[...document.querySelectorAll('.format-help > code')].every(c=>c.scrollWidth<=c.clientWidth+1)`));
ok('"How it works" really is beside the form here',await ev(`document.querySelector('.how-it-works').getBoundingClientRect().left>document.querySelector('.form').getBoundingClientRect().right`));

sec('failures that are not JSON');
await ev(`(()=>{document.getElementById('content').value='HTMLERR please';document.getElementById('contributeForm').requestSubmit()})()`);await sleep(700);
let fe=JSON.parse(await ev(`JSON.stringify({text:document.getElementById('status').textContent,cls:document.getElementById('status').className,kept:document.getElementById('content').value})`));
ok('an HTML error page gives a plain-English message, not "JSON.parse"',/did not answer properly/.test(fe.text)&&!/JSON/.test(fe.text)&&/error/.test(fe.cls),JSON.stringify(fe));
ok('and the visitor\'s text is still in the form',fe.kept==='HTMLERR please');
await ev(`window.__realFetch=window.fetch;window.fetch=function(u,o){return /submit/.test(u)?Promise.reject(new TypeError('NetworkError when attempting to fetch resource.')):window.__realFetch(u,o)};document.getElementById('contributeForm').requestSubmit()`);await sleep(500);
fe=JSON.parse(await ev(`JSON.stringify({text:document.getElementById('status').textContent,kept:document.getElementById('content').value})`));
ok('a dropped connection (Firefox wording) says to check the connection',/Could not reach the server/.test(fe.text)&&!/NetworkError/.test(fe.text),JSON.stringify(fe));
ok('...and again keeps their text',fe.kept==='HTMLERR please');
await ev(`window.fetch=window.__realFetch`);

sec('night mode');
await ev(`document.querySelector('.theme-toggle').click()`);await sleep(200);
ok('fields, cards and tabs switch to the night colours',await ev(`getComputedStyle(document.getElementById('handle')).backgroundColor==='rgb(14, 44, 44)' && getComputedStyle(document.querySelector('.how-it-works')).backgroundColor==='rgb(14, 44, 44)'`));
await ev(`document.querySelector('[data-editor=content] [data-mode=richtext]').click()`);await sleep(150);
ok('the editor is a night field too (toolbar and writing area)',await ev(`getComputedStyle(document.querySelector('[data-editor=content] .ql-container')).backgroundColor==='rgb(14, 44, 44)' && getComputedStyle(document.querySelector('[data-editor=content] .ql-editor')).color==='rgb(241, 234, 220)'`));
ok('native controls follow (dark colour scheme)',await ev(`getComputedStyle(document.documentElement).colorScheme==='dark'`));

sec('phone width (375px)');
await send('Emulation.setDeviceMetricsOverride',{width:375,height:800,deviceScaleFactor:1,mobile:true});await sleep(500);
const ph=JSON.parse(await ev(`JSON.stringify({sw:document.documentElement.scrollWidth,iw:window.innerWidth,cards:[...document.querySelectorAll('.choice-body')].map(e=>Math.round(e.getBoundingClientRect().width)),editor:Math.round(document.querySelector('[data-editor=content] .ql-container').getBoundingClientRect().width)})`));
ok('no sideways scrolling',ph.sw<=ph.iw,JSON.stringify(ph));
ok('the two choices stack to full width',ph.cards.every(w=>w>=300),JSON.stringify(ph.cards));
const hts=await ev(`JSON.stringify([...document.querySelectorAll('.choice-body')].map(e=>Math.round(e.getBoundingClientRect().height)))`);
ok('...and are as tall as their text, not stretched',JSON.parse(hts).every(h=>h<=130),hts);
ok('the code samples wrap instead of clipping on a phone',await ev(`[...document.querySelectorAll('.format-help > code')].every(c=>c.scrollWidth<=c.clientWidth+1)`));

sec('whole run');
ok('no script errors at any point',errors.length===0,JSON.stringify(errors));

// stop the mock API too
srv.close();
await done();
