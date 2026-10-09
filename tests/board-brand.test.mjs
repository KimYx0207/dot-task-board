import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createSitesPrivateEntry} from '../src/application/sites-entry.mjs';

const root=new URL('../',import.meta.url);
const names=['board-team.png','board-brand.css','brand-links.js'];
const env={DOT_BOARD_INGRESS:'sites-owner-private-v1',DOT_BOARD_OWNER_ID:'synthetic-owner',DOT_BOARD_AUDIENCE:'https://example.com'};
const owner={'oai-authenticated-user-id':'synthetic-owner'};

test('new brand and artwork resources preserve exact bytes and the existing private boundary',async()=>{
  const assets=Object.fromEntries(await Promise.all(names.map(async name=>['/'+name,await readFile(new URL('public/'+name,root))])));
  const worker=createSitesPrivateEntry(assets);
  for(const name of names){
    const url='https://example.com/'+name;
    assert.equal((await worker.fetch(new Request(url),env)).status,401,name);
    assert.equal((await worker.fetch(new Request(url,{headers:{'oai-authenticated-user-id':'someone-else'}}),env)).status,403,name);
    const response=await worker.fetch(new Request(url,{headers:owner}),env);
    assert.equal(response.status,200,name);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),assets['/'+name]);
    assert.match(response.headers.get('cache-control'),/private.*no-store/);
    assert.match(response.headers.get('content-type'),name.endsWith('.png')?/^image\/png/:name.endsWith('.css')?/^text\/css/:/^text\/javascript/);
    assert.equal((await worker.fetch(new Request(url,{headers:owner,method:'HEAD'}),env)).status,200);
    assert.equal((await worker.fetch(new Request(url,{headers:owner,method:'POST'}),env)).status,405);
  }
});

test('brand links use verified destinations and decorations are separate from task state',async()=>{
  const html=await readFile(new URL('public/index.html',root),'utf8');
  for(const href of ['https://aiking.dev','https://x.com/KimYx0207','https://github.com/KimYx0207'])assert.match(html,new RegExp('href="'+href+'" target="_blank" rel="noopener noreferrer" aria-label="[^"]+"'));
  assert.match(html,/<details class="wechat-entry" id="wechat-entry"><summary[^>]+aria-label="查看微信公众号：老金带你玩AI"/);
  assert.match(html,/id="wechat-name" value="老金带你玩AI" readonly/);
  assert(!html.includes('https://mp.weixin.qq.com/'));
  const start=html.indexOf('<div class="board-mascots"'),art=html.slice(start,html.indexOf('</div>',start)+6);
  assert.match(art,/aria-hidden="true"/);assert.equal([...art.matchAll(/alt=""/g)].length,1);
  assert(!/button|status|running|完成/.test(art));
});

async function setupClipboard(clipboard){
  const events={},entryEvents={},buttonEvents={};let focused=false,selected=false,summaryFocused=false;
  const entry={open:true,addEventListener:(type,fn)=>entryEvents[type]=fn,contains:node=>node===entry,querySelector:()=>({focus(){summaryFocused=true;}})};
  const name={value:'老金带你玩AI',focus(){focused=true;},select(){selected=true;}};
  const button={addEventListener:(type,fn)=>buttonEvents[type]=fn};const status={textContent:''};
  runInNewContext(await readFile(new URL('public/brand-links.js',root),'utf8'),{document:{getElementById:id=>({'wechat-entry':entry,'wechat-name':name,'copy-wechat':button,'wechat-copy-status':status})[id],addEventListener:(type,fn)=>events[type]=fn},navigator:{clipboard}});
  return {entry,status,copy:buttonEvents.click,escape:()=>entryEvents.keydown({key:'Escape'}),outside:()=>events.click({target:{}}),selected:()=>focused&&selected,summaryFocused:()=>summaryFocused};
}

test('WeChat copy, denied-clipboard fallback, Escape and outside click work without network',async()=>{
  let copied;const ok=await setupClipboard({writeText:async value=>{copied=value;}});await ok.copy();assert.equal(copied,'老金带你玩AI');assert.match(ok.status.textContent,/已复制/);
  ok.escape();assert.equal(ok.entry.open,false);assert(ok.summaryFocused());
  const denied=await setupClipboard({writeText:async()=>{throw Error('denied');}});await denied.copy();assert(denied.selected());assert.match(denied.status.textContent,/名称已选中/);denied.outside();assert.equal(denied.entry.open,false);
});

test('team artwork directly follows the top navigation brand and both project READMEs open with the same local asset',async()=>{
 const html=await readFile(new URL('public/index.html',root),'utf8');
 assert.match(html,/<span class="brand-name">任务看板<\/span><\/a><div class="board-mascots"/);
 assert(!html.slice(html.indexOf('<section class="page-heading"'),html.indexOf('<div id="request-anchor"')).includes('board-team.png'));
 for(const name of ['README.md','README.zh-CN.md']){const text=await readFile(new URL(name,root),'utf8');assert.match(text.slice(0,text.indexOf('# dot task board')),/<img src="public\/board-team.png"[^>]+width="360">/);}
 assert(html.indexOf('href="https://aiking.dev"')<html.indexOf('href="https://x.com/KimYx0207"'));
});
