import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFile,stat,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,relative,sep} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const pairs=['README','CONTRIBUTING','SECURITY','CHANGELOG','THIRD_PARTY','docs/architecture','docs/data-contract','docs/deployment'];
const read=p=>readFile(resolve(root,p),'utf8');

test('documentation has separate complete English and Chinese entry points',async()=>{
  for(const path of pairs){
    const name=path.split('/').at(-1);
    const en=await read(path+'.md'),zh=await read(path+'.zh-CN.md');
    assert(en.includes(`[简体中文](${name}.zh-CN.md)`),path);
    assert(zh.includes(`[English](${name}.md)`),path);
    assert(!/\p{Script=Han}/u.test(en.replace(/^.*\[简体中文\].*$/gm,'').replaceAll('老金带你玩AI','')),`${path}: English prose must not contain Chinese paragraphs`);
    assert.match(zh,/\p{Script=Han}/u);
  }
});

test('READMEs lead with outcomes and quick start before technical detail',async()=>{
  for(const [path,start,quick,details] of [
    ['README.md','## Start here','### Try it in 3 steps','<summary>'],
    ['README.zh-CN.md','## 从这里开始','### 3 步上手','<summary>']
  ]){
    const text=await read(path);
    assert(text.indexOf(start)>0);
    assert(text.indexOf(quick)>text.indexOf(start));
    assert(text.indexOf(details)>text.indexOf(quick));
    for(const command of ['npm run demo','DOT_BOARD_SNAPSHOT_PATH','npm run check:public','npm test'])assert(text.includes(command));
  }
});

test('Chinese README links to matching-language guides',async()=>{
  const text=await read('README.zh-CN.md');
  for(const name of pairs.filter(p=>p!=='README'))assert(text.includes(`](${name}.zh-CN.md)`),name);
});

async function markdownFiles(dir){
  const found=[];
  for(const e of await readdir(dir,{withFileTypes:true})){
    if(['.git','dist','node_modules','coverage'].includes(e.name))continue;
    const path=resolve(dir,e.name);
    if(e.isDirectory())found.push(...await markdownFiles(path));
    else if(e.isFile()&&e.name.endsWith('.md'))found.push(path);
  }
  return found;
}
function anchors(text){
  return new Set(text.split('\n').filter(l=>/^#{1,6} /.test(l)).map(l=>l.replace(/^#{1,6}\s+/,'').toLowerCase().replace(/<[^>]*>/g,'').replace(/[^\p{L}\p{N}_\s-]/gu,'').replace(/ /g,'-')));
}
test('all documentation local links and heading anchors resolve',async()=>{
  for(const path of await markdownFiles(root)){
    const text=await readFile(path,'utf8');
    for(const match of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)){
      const target=match[1];if(/^[a-z]+:/i.test(target)||target.startsWith('//'))continue;
      const [pathname,fragment]=target.split('#');
      const absolute=pathname?resolve(dirname(path),decodeURIComponent(pathname)):path;
      const rel=relative(root,absolute);assert(!rel.startsWith(`..${sep}`)&&rel!=='..',`${path}: outside-repo link ${target}`);
      assert((await stat(absolute)).isFile(),`${path}: missing ${target}`);
      if(fragment&&absolute.endsWith('.md'))assert(anchors(await readFile(absolute,'utf8')).has(decodeURIComponent(fragment)),`${path}: missing heading ${target}`);
    }
  }
});


test('both README contact sections retain the verified public channels',async()=>{
  for(const path of ['README.md','README.zh-CN.md']){
    const text=await read(path);
    for(const value of ['docs/images/contact-qr.png','老金带你玩AI','https://github.com/KimYx0207','https://x.com/KimYx0207','https://www.aiking.dev/','https://my.feishu.cn/wiki/OhQ8wqntFihcI1kWVDlcNdpznFf'])assert(text.includes(value),`${path}: missing contact ${value}`);
    assert(text.includes('SECURITY'),`${path}: security reporting remains separate`);
    assert(!/mailto:/.test(text),`${path}: do not invent a contact email`);
  }
});

test('public author contact artwork matches the verified original bytes',async()=>{
  const data=await readFile(resolve(root,'docs/images/contact-qr.png'));
  assert.equal(createHash('sha256').update(data).digest('hex'),'68f910168cbe5a6095dfba73648abb06f8f6ad6231c97b8cf0d68e77a07c1f67');
});
