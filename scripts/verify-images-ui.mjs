import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../packages/core/package.json',import.meta.url));
const {chromium}=require('playwright');
const origin=process.argv[2]||'http://127.0.0.1:3106';
await mkdir('output/playwright',{recursive:true});
const image=await readFile('output/acceptance-016/sample.png');
const browser=await chromium.launch();
try{for(const mobile of [false,true]){
 const ctx=await browser.newContext({viewport:mobile?{width:393,height:852}:{width:1440,height:1100},isMobile:mobile,hasTouch:mobile});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Upload flow uses the real endpoint and an isolated database. No worker executes these tasks.
 await page.goto(origin);await page.getByRole('tab',{name:'图片',exact:true}).click();
 await page.getByLabel('设计图片',{exact:true}).setInputFiles([{name:'first.png',mimeType:'image/png',buffer:image},{name:'second.png',mimeType:'image/png',buffer:image}]);
 await page.getByRole('button',{name:'上移图片 2',exact:true}).click();
 assert.match(await page.locator('.upload-previews li').first().innerText(),/second.png/);
 await page.getByRole('button',{name:'删除图片 2',exact:true}).click();
 await page.getByLabel('设计名称（可选）').fill('图片上传验收');
 await page.getByLabel('背景说明（可选）').fill('同一 App 的测试图片');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`output/playwright/upload-${mobile?'mobile':'desktop'}-016.png`,fullPage:true});
 await page.getByRole('button',{name:'分析并生成',exact:true}).click();
 await page.waitForURL(/\/designs\//);await page.getByRole('heading',{name:'图片上传验收',exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'访问原网站'}).count(),0);
 const id=page.url().split('/').at(-1);
 const data=await (await page.request.get(origin+'/api/designs/'+id)).json();assert.equal(data.source_kind,'images');assert.equal(data.tasks[0].status,'QUEUED');
 await page.request.delete(origin+'/api/designs/'+id,{headers:{Origin:origin}});
 // A controlled completed image version tests viewer navigation and missing-DNA recovery UI.
 const fixture={id:'fixture',source_kind:'images',canonical_url:null,title:'多图设计',tags:[],notes:'',default_version_id:'v',versions:[{id:'v',snapshot_id:'s',score:80,quality:'SCORED',created_at:new Date().toISOString(),analysis:{name:'Reusable style',summary:'Warm and clear.'},metadata:{language:'en'},presentation_state:{status:'MISSING',message:'中文介绍未返回，可单独补生成。'}}],tasks:[{id:'t',version_id:'v',kind:'IMAGE_IMPORT',status:'READY',stage:'COMPLETE',created_at:new Date().toISOString(),events:[]}],assets:[]};
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;
  if(p==='/api/designs/fixture')return route.fulfill({json:fixture});
  if(p.endsWith('/presentation')){fixture.versions[0].presentation_state={status:'QUEUED'};return route.fulfill({json:{runId:'repair',status:'QUEUED'}});}
  if(p.endsWith('evidence.json'))return route.fulfill({json:{kind:'images',viewports:[],images:[1,2].map(n=>({id:'image-'+n,name:'Screen '+n,preview:'images/preview-'+n+'.webp',path:'images/original-'+n+'.png'}))}});
  if(p.endsWith('.webp')||p.endsWith('.png'))return route.fulfill({body:image,contentType:'image/png'});
  if(p.endsWith('.md'))return route.fulfill({body:'## Overview\n\nWarm surfaces and dark green accents create a calm reading hierarchy.',contentType:'text/plain'});
  return route.fulfill({status:404,json:{error:'Not generated'}});
 });
 await page.goto(origin+'/designs/fixture');await page.getByRole('tab',{name:'图片 2',exact:true}).click();
 assert.match(await page.locator('.screenshot > img').getAttribute('src'),/preview-2/);
 assert.equal(await page.getByText('文档已生成。以下为内容检查建议，不影响任务完成。',{exact:true}).count(),0);
 await page.getByRole('button',{name:'补生成中文介绍',exact:true}).click();
 await page.getByRole('button',{name:'正在生成中文介绍…',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:`output/playwright/images-${mobile?'mobile':'desktop'}-016.png`,fullPage:true});
 assert.deepEqual(errors,[]);await ctx.close();
}}finally{await browser.close();}
console.log('Desktop/mobile real upload, reorder/remove, image-source navigation, DNA-only recovery and no review banner passed.');
