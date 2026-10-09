import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
const files=['src/presentation/task-requirements-http.mjs','src/presentation/task-requirements-mcp.mjs','public/task-display.js','config/agents.mjs','config/board.mjs','src/domain/intake.mjs','src/domain/agents.mjs','src/domain/snapshot.mjs','src/domain/task-status-overlay.mjs','src/domain/mcp-events.mjs','src/domain/execution-evidence.mjs','src/domain/dispatch-queue.mjs','src/domain/dispatch-guards.mjs','src/application/board-service.mjs','src/adapters/snapshot.mjs','src/adapters/project-registry.mjs','src/adapters/d1-intake.mjs','src/adapters/d1-mcp-events.mjs','src/adapters/d1-dispatch-queue.mjs','src/application/intake-service.mjs','src/application/mcp-events-service.mjs','src/application/project-accounting.mjs','src/application/dispatch-service.mjs','src/application/dispatch-projection.mjs','src/presentation/intake-http.mjs','src/presentation/observations-http.mjs','src/presentation/observations-mcp.mjs','src/presentation/task-controls-mcp.mjs','src/presentation/dispatch-http.mjs','src/presentation/dispatch-mcp.mjs','src/presentation/manual-check-mcp.mjs','src/presentation/intake-mcp.mjs','src/presentation/http.mjs','src/presentation/manual-status-http.mjs','worker.mjs'];
const candidate=process.argv.includes('--candidate'),sites=process.argv.includes('--sites');
if(sites)files.push('src/domain/task-requirements.mjs','src/adapters/d1-task-requirements.mjs','src/application/task-requirements-service.mjs','src/application/sites-task-requirements.mjs','src/adapters/sites-visibility.mjs','src/domain/manual-task-status.mjs','src/adapters/d1-manual-task-status.mjs','src/application/manual-task-status-service.mjs','src/application/sites-manual-task-status.mjs','src/application/sites-manual-check.mjs','src/adapters/event-bridge-auth.mjs','src/adapters/sites-event-bridge.mjs','src/adapters/d1-board-observation-outbox.mjs','src/adapters/observation-bindings.mjs','src/adapters/d1-board-observations.mjs','src/domain/board-observation.mjs','src/application/board-observation-service.mjs','src/application/sites-observations.mjs','src/application/sites-task-controls.mjs','src/application/sites-setup-identity.mjs','src/application/sites-entry.mjs');
if(candidate)files.push('src/adapters/platform-transport.mjs','src/adapters/deployment-adapters.mjs','src/application/candidate-entry.mjs');
// The small zero-dependency Worker uses the exact same checked modules as Node.
// This intentionally narrow packer accepts only our one-line static imports.
const includedModules=new Set(files.map(path=>new URL(path,root).href));
const modules=await Promise.all(files.map(async path=>{
  const code=await readFile(new URL(path,root),'utf8');
  // Reject missing dependency entries instead of emitting latent undefined names.
  for(const match of code.matchAll(/^import .+ from ['\"]([^'\"]+)['\"];\s*$/gm)){
    if(!match[1].startsWith('.')||!includedModules.has(new URL(match[1],new URL(path,root)).href))throw Error('Worker dependency is not included: '+path+' -> '+match[1]);
  }
  if(/^import\s/m.test(code.replace(/^import .+ from ['\"][^'\"]+['\"];\s*$/gm,'')))throw Error('Unsupported Worker import syntax: '+path);
  return `// ${path}\n${code.replace(/^import .+;\s*$/gm,'').replace(/\bexport (?=(?:const|class|function|async function)\b)/g,'')}`;
}));
const assets={};
for(const name of ['index.html','styles.css','app.js','collaboration-graph.js','collaboration-graph.css','project-overview.js','project-overview.css','queue-controls.js','queue-controls.css','project-clarity.js','task-display.js','project-clarity.css','board-brand.css','brand-links.js']) assets['/'+name]=await readFile(new URL('public/'+name,root),'utf8');
const binaryAssets={};
for(const name of ['dot-agent-roles.png','board-team.png']) binaryAssets['/'+name]=(await readFile(new URL('public/'+name,root))).toString('base64');
const output=modules.join('\n\n')+'\n\nexport default '+(candidate?'createCandidateEntry({assets:':sites?'createSitesPrivateEntry(':'createWorker(')+'{...'+JSON.stringify(assets)+',...Object.fromEntries(Object.entries('+JSON.stringify(binaryAssets)+').map(([path,value])=>[path,Uint8Array.from(atob(value),char=>char.charCodeAt(0))]))}'+(candidate?'}':'')+');\n';
const outputDirectory=candidate?'candidate':sites?'sites':'server';
await mkdir(new URL(`dist/${outputDirectory}/`,root),{recursive:true});
const target=new URL(`dist/${outputDirectory}/index.js`,root),temporary=new URL(`dist/${outputDirectory}/.index-${process.pid}-${Date.now()}.js`,root);
try {await writeFile(temporary,output);await rename(temporary,target);}finally{await rm(temporary,{force:true});}
console.log(`Built standalone Worker: ${Buffer.byteLength(output)} bytes; no runtime task data included`);
