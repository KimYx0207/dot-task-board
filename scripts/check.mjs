import {readdir,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
async function walk(dir){const out=[];for(const entry of await readdir(dir,{withFileTypes:true})){if(['.git','dist','node_modules','.sites-runtime'].includes(entry.name))continue;const path=dir+'/'+entry.name;if(entry.isSymbolicLink())throw Error('Source must not include symlinks');if(entry.isDirectory())out.push(...await walk(path));else out.push(path);}return out;}
const files=await walk(root);
const forbidden=process.env.DOT_BOARD_EXCLUSION_TERMS_FILE ? JSON.parse(await readFile(process.env.DOT_BOARD_EXCLUSION_TERMS_FILE,'utf8')) : [];
for(const file of files){
  if(/\.(mjs|js)$/.test(file)){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);}
  const source=await readFile(file,'utf8');
  if(forbidden.some(term=>source.includes(term)))throw Error('Private runtime fact found in source: '+file);
  if(/\bsk-[A-Za-z0-9_-]{30,}|\bghp_[A-Za-z0-9]{30,}/.test(source))throw Error('Credential-shaped data found in source');
}
console.log(`Checked ${files.length} source files: syntax and private-data exclusion passed`);
