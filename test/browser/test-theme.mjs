/**
 * The light/night toggle: follows the device, remembers the choice, no flash, survives blocked storage.
 *
 * Run: node test/browser/test-theme.mjs
 * Needs Chromium; prints SKIPPED without it. Starts its own preview server.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { skipWithoutChromium, start } from './lib.mjs';

skipWithoutChromium('test-theme.mjs');
const { send, ev, key, ok, sec, errors, done, sleep, base } = await start({ preview: true });
await send('Page.enable'); await send('Runtime.enable');
const state=()=>ev(`JSON.stringify({theme:document.documentElement.dataset.theme,label:document.querySelector('.theme-toggle').textContent,pressed:document.querySelector('.theme-toggle').getAttribute('aria-pressed'),saved:(()=>{try{return localStorage.getItem('mv-theme')}catch(e){return 'blocked'}})(),bg:getComputedStyle(document.body).backgroundColor,meta:document.querySelector('meta[name=theme-color]').content})`).then(JSON.parse);

console.log('\n== first visit, device prefers DARK, nothing saved');
await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
await send('Page.navigate',{url:base+'/'}); await sleep(1500);
let s=await state(); console.log('  ',JSON.stringify(s));
ok('follows the device: night',s.theme==='dark'&&s.bg==='rgb(5, 28, 30)');
ok('button offers the other mode',s.label==='Light mode'&&s.pressed==='true');
ok('nothing is saved until the visitor chooses',s.saved===null);
ok('the phone address bar colour matches',s.meta==='#051c1e');

console.log('\n== they press the toggle');
await ev(`document.querySelector('.theme-toggle').click()`); await sleep(200);
s=await state(); console.log('  ',JSON.stringify(s));
ok('flips to light',s.theme==='light'&&s.bg==='rgb(250, 245, 234)'&&s.label==='Night mode'&&s.pressed==='false');
ok('and saves the choice',s.saved==='light');
ok('address bar colour follows',s.meta==='#faf5ea');

console.log('\n== reload: their choice beats the device setting');
await send('Page.navigate',{url:base+'/'}); await sleep(1500);
s=await state(); console.log('  ',JSON.stringify(s));
ok('still light even though the device says dark',s.theme==='light'&&s.saved==='light');

console.log('\n== no flash: the theme is set before the page paints');
const early=await ev(`(async()=>{const r=await fetch('/');const h=await r.text();const i=h.indexOf('/theme.js');const j=h.indexOf('/theme.css');return JSON.stringify({scriptBeforeCss:i>0&&i<j})})()`);
ok('theme.js loads before the stylesheet',JSON.parse(early).scriptBeforeCss);

console.log('\n== storage blocked (private window): still works');
await send('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})`});
await send('Page.navigate',{url:base+'/'}); await sleep(1500);
s=await state().catch(e=>({err:String(e)})); console.log('  ',JSON.stringify(s));
ok('page renders and follows the device',s.theme==='dark');
await ev(`document.querySelector('.theme-toggle').click()`); await sleep(200);
s=await state(); ok('toggle still works with storage blocked',s.theme==='light');

await done();
