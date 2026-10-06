import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const files=['config/agents.mjs','config/board.mjs','src/domain/agents.mjs','src/domain/snapshot.mjs','src/application/board-service.mjs','src/adapters/snapshot.mjs','src/presentation/http.mjs','worker.mjs'];
// The small zero-dependency Worker uses the exact same checked modules as Node.
// This intentionally narrow packer accepts only our one-line static imports.
const modules=await Promise.all(files.map(async path=>{
  const code=await readFile(new URL(path,root),'utf8');
  return `// ${path}\n${code.replace(/^import .+;\s*$/gm,'').replace(/\bexport (?=(?:const|class|function|async function)\b)/g,'')}`;
}));
const assets={};
for(const name of ['index.html','styles.css','app.js']) assets['/'+name]=await readFile(new URL('public/'+name,root),'utf8');
const output=modules.join('\n\n')+'\n\nexport default createWorker('+JSON.stringify(assets)+');\n';
await mkdir(new URL('dist/server/',root),{recursive:true});
await writeFile(new URL('dist/server/index.js',root),output);
console.log(`Built standalone Worker: ${Buffer.byteLength(output)} bytes; no runtime task data included`);
