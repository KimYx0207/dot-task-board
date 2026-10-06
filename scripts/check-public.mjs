import {readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,sep} from 'node:path';

const root=resolve(process.argv[2]||fileURLToPath(new URL('../',import.meta.url)));
const allowedFolders=new Set(['src','public','config','tests','fixtures','examples','scripts','docs','.github']);
const allowedFiles=new Set(['README.md','LICENSE','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','THIRD_PARTY.md','package.json','server.mjs','worker.mjs','.env.example','.gitignore','.gitattributes']);
const skipped=new Set(['.git','node_modules','dist','coverage']);
let checked=0;
async function walk(directory){
  for(const item of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,item.name),parts=relative(root,path).split(sep);
    if(parts.length===1&&skipped.has(item.name))continue;
    if(item.isSymbolicLink())throw Error('Publication tree contains a symlink');
    if(parts.length===1&&!allowedFolders.has(item.name)&&!allowedFiles.has(item.name))throw Error(`Unexpected publication entry: ${item.name}`);
    if(item.isDirectory()){
      if(['private','runtime','.openai','.sites-runtime','__pycache__'].includes(item.name))throw Error('Private or generated directory in publication tree');
      await walk(path);continue;
    }
    if(!item.isFile())throw Error('Non-regular publication entry');
    if((item.name.startsWith('.env')&&item.name!=='.env.example')||/\.(?:zip|gz|log|pyc|sqlite|db)$/.test(item.name))throw Error('Runtime or generated file in publication tree');
    const body=await readFile(path,'utf8');
    if(/\b(?:sk-|ghp_)[A-Za-z0-9_-]{30,}|\bappgprj_[a-f0-9]{20,}|\blibfile_[a-f0-9]{20,}|\bSentinel_[a-f0-9]{20,}/.test(body))throw Error('Private identity or credential-shaped data found');
    if(/https:\/\/[^\s"<>]+\.chatgpt\.site/.test(body))throw Error('Private deployment URL in publication tree');
    if((parts[0]==='examples'||parts[0]==='fixtures')&&item.name.endsWith('.json')){
      const value=JSON.parse(body);if(value.source?.mode!=='synthetic')throw Error('Examples must be explicitly synthetic');
    }
    checked++;
  }
}
await walk(root);
console.log(`Public source boundary passed: ${checked} allowlisted files`);
