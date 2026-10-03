/**
 * The Home page with faked README.md and OPPORTUNITIES.md: deadline pills, expired and unreadable-date entries hidden, a missing opportunities file, and night mode.
 *
 * Run: node test/browser/test-home.mjs
 * Needs Chromium; prints SKIPPED without it. Starts its own preview server.
 */
import { skipWithoutChromium, start } from './lib.mjs';

skipWithoutChromium('test-home.mjs');
const { send, ev, ok, sec, errors, done, sleep, base } = await start({ preview: true });

const day = (n) => new Date(Date.now() + 2 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const README = `# T\n\n## 🎓 I'm Going to Study\n\n### Paying for It\n\n-   [NSFAS](https://my.nsfas.org.za/) — Financial aid.\n`;
const OPPS = `# O\n\n## 🎓 I'm Going to Study\n\n### Paying for It\n\n` +
  `-   [Soon](https://a.org) — Closes in five days. {closes: ${day(5)}}\n` +
  `-   [Later](https://b.org) — Closes in sixty days. {closes: ${day(60)}}\n` +
  `-   [Today](https://c.org) — Closes today. {closes: ${day(0)}}\n` +
  `-   [Gone](https://d.org) — Closed yesterday. {closes: ${day(-1)}}\n` +
  `-   [Broken](https://e.org) — Bad date. {closes: 31/11/2026}\n` +
  `-   [Undated](https://f.org) — No deadline. {tags: evergreen}\n`;

let last = null;
const load = async ({ opps, theme = 'light' }) => {
  if (last) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: last });
  const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(function(){try{localStorage.setItem('mv-theme','${theme}')}catch(e){}
    var real=window.fetch, R=${JSON.stringify(README)}, O=${JSON.stringify(opps)};
    window.fetch=function(u,o){ u=String(u);
      if(u.includes('/__content/README.md')) return Promise.resolve(new Response(R,{status:200}));
      if(u.includes('/__content/OPPORTUNITIES.md')) return O===null ? Promise.resolve(new Response('nope',{status:404})) : Promise.resolve(new Response(O,{status:200}));
      return real(u,o); };})();` });
  last = r.result.identifier;
  await send('Page.navigate', { url: base + '/' });
  await sleep(1500);
};
const names = () => ev(`[...document.querySelectorAll('#study-content .res-name')].map(n=>n.textContent.trim())`);

await load({ opps: OPPS });
sec('Opportunities merged into the pillar');
ok('no script errors', errors.length === 0, JSON.stringify(errors));
const n = await names();
ok('evergreen entry first, then the open ones, in file order', JSON.stringify(n) === JSON.stringify(['NSFAS', 'Soon', 'Later', 'Today', 'Undated']), JSON.stringify(n));
ok('expired entry is not shown', !n.includes('Gone'));
ok('entry with an unreadable date is not shown', !n.includes('Broken'));
const pills = await ev(`[...document.querySelectorAll('#study-content .res-row')].map(r=>[r.querySelector('.res-name').textContent.trim(), (r.querySelector('.res-deadline')||{}).textContent||null, !!r.querySelector('.res-deadline.soon')])`);
const pill = (name) => pills.find((p) => p[0] === name);
ok('evergreen and undated entries have no pill', pill('NSFAS')[1] === null && pill('Undated')[1] === null, JSON.stringify(pills));
ok('a date within two weeks gets the "soon" pill', /^Closes \d+ \w{3} \d{4}$/.test(pill('Soon')[1]) && pill('Soon')[2] === true, JSON.stringify(pill('Soon')));
ok('a distant date gets the plain pill', /^Closes \d+ \w{3} \d{4}$/.test(pill('Later')[1]) && pill('Later')[2] === false, JSON.stringify(pill('Later')));
ok('the closing day says "Closes today" and is still visible', pill('Today')[1] === 'Closes today' && pill('Today')[2] === true, JSON.stringify(pill('Today')));

sec('Pill readable in both themes');
const contrast = `(()=>{const p=document.querySelector('#study-content .res-deadline');const c=getComputedStyle(p);const lum=s=>{const m=s.match(/\\d+/g).map(Number).slice(0,3).map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});return .2126*m[0]+.7152*m[1]+.0722*m[2]};const a=lum(c.color),b=lum(c.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)})()`;
ok('light: text on the pill is at least 4.5:1', (await ev(contrast)) >= 4.5);
await load({ opps: OPPS, theme: 'dark' });
ok('dark: text on the pill is at least 4.5:1', (await ev(contrast)) >= 4.5);

sec('Opportunities file missing');
await load({ opps: null });
ok('the README still renders', JSON.stringify(await names()) === JSON.stringify(['NSFAS']), JSON.stringify(await names()));
ok('no script errors', errors.length === 0, JSON.stringify(errors));

await done();
