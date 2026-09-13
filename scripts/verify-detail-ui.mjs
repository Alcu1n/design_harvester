// Read-only regression check against a detail URL with long DNA and a generated DESIGN.md.
// node scripts/verify-detail-ui.mjs http://127.0.0.1:3101/designs/<id>
// Mobile share is simulated; this is not native iOS/Android acceptance.
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const require = createRequire(new URL("../packages/core/package.json", import.meta.url));
const { chromium } = require("playwright");
const url = process.argv[2];
if (!url) throw new Error("Provide a detail page URL with generated documents and long DNA");
await mkdir("output/playwright", { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
  await page.goto(url);
  await page.locator('.inspector-scroll[data-more="true"]').waitFor();
  await page.getByRole('button', {name:'下载', exact:true}).waitFor();
  await (async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const original = page.url();
  const geometry = await page.evaluate(() => {
    const shot = document.querySelector('.screenshot').getBoundingClientRect();
    const dna = document.querySelector('.inspector-scroll');
    const rect = dna.getBoundingClientRect();
    return { screenshot: {top: shot.top, bottom: shot.bottom, height: shot.height}, dna: {top: rect.top, bottom: rect.bottom, height: rect.height}, more: dna.dataset.more, scrollHeight: dna.scrollHeight };
  });
  check(geometry.screenshot.height === geometry.dna.height && geometry.screenshot.top === geometry.dna.top, 'Screenshot and DNA must align exactly');
  check(geometry.more === 'true', 'Long DNA must fade');
  await page.screenshot({path:'output/playwright/detail-desktop-013.png'});
  await page.getByRole('region', {name:'Design DNA，设计分析'}).evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(() => document.querySelector('.inspector-scroll').dataset.more === 'false');
  check(await page.getByText('版本质量', {exact: true}).isVisible(), 'Quality must remain reachable');
  const zoom = await page.evaluate(() => {
    const key = new KeyboardEvent('keydown', {key: '+', ctrlKey: true, bubbles: true, cancelable: true});
    document.dispatchEvent(key);
    const wheel = new WheelEvent('wheel', {ctrlKey:true, deltaY:-100, bubbles:true, cancelable:true});
    document.dispatchEvent(wheel);
    const scroll = new WheelEvent('wheel', {deltaY:100, bubbles:true, cancelable:true});
    document.dispatchEvent(scroll);
    return { key:key.defaultPrevented, wheel:wheel.defaultPrevented, scroll:scroll.defaultPrevented, viewport:document.querySelector('meta[name=viewport]').content };
  });
  check(zoom.key && zoom.wheel && !zoom.scroll && zoom.viewport.includes('user-scalable=no'), 'Zoom blocked, ordinary scrolling allowed');
  const download = page.waitForEvent('download');
  await page.getByRole('button', {name:'下载', exact:true}).click();
  check((await download).suggestedFilename() === 'DESIGN.md', 'Markdown download keeps filename');
  check(page.url() === original, 'Download must preserve detail page');
  await page.route('**/export?*', route => route.fulfill({status:500,contentType:'application/json',body:'{"error":"test"}'}));
  await page.getByRole('button', {name:'下载完整方案',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'下载失败'}).waitFor();
  check(page.url() === original, 'Failed download preserves page');
  await page.unroute('**/export?*');
  await page.setViewportSize({width:393,height:852});
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'userAgent', {configurable:true,value:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'});
    navigator.canShare = data => !!data.files?.length;
    navigator.share = async data => { window.__shared = {name:data.files[0].name,size:data.files[0].size}; };
    window.scrollTo(0,0);
  });
  await page.screenshot({path:'output/playwright/detail-mobile-013.png'});
  const mobile = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, position:getComputedStyle(document.querySelector('.inspector-scroll')).position,mask:getComputedStyle(document.querySelector('.inspector-scroll')).maskImage }));
  check(!mobile.overflow && mobile.position === 'static' && mobile.mask === 'none', 'Mobile DNA expands without horizontal overflow');
  await page.getByRole('button', {name:'下载完整方案',exact:true}).click();
  await page.getByRole('button',{name:'保存文件',exact:true}).waitFor({timeout:60000});
  await page.screenshot({path:'output/playwright/download-mobile-013.png'});
  await page.evaluate(() => {
    navigator.share = async () => { throw new DOMException('Canceled', 'AbortError'); };
  });
  await page.getByRole('button',{name:'保存文件',exact:true}).click();
  check(await page.getByRole('button',{name:'保存文件',exact:true}).isVisible(), 'Cancel preserves prepared file for retry');
  await page.evaluate(() => {
    navigator.share = async data => { window.__shared = {name:data.files[0].name,size:data.files[0].size}; };
  });
  await page.getByRole('button',{name:'保存文件',exact:true}).click();
  const shared = await page.evaluate(() => window.__shared);
  check(shared.name.endsWith('.zip') && shared.size > 0, 'Mobile shares actual ZIP bytes');
  check(page.url() === original, 'Mobile does not navigate');
  console.log(JSON.stringify({geometry,zoom,mobile,shared},null,2));
}
)(page);
} finally {
  await browser.close();
}
