import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {canonicalPath,pathInside} from '../src/adapters/local-paths.mjs';

const root=canonicalPath(fileURLToPath(new URL('../',import.meta.url)));

// Stage the private Sites entry without changing the public Worker build.
// Runtime variables, credentials, snapshots and database rows are never inputs.
export async function stageSitesDeployment({hostingPath,outDir}){
  const output=canonicalPath(outDir),configuration=canonicalPath(hostingPath);
  if(pathInside(root,output)||pathInside(output,root)||pathInside(root,configuration))throw Error('Keep the private hosting configuration and staging directory outside the source checkout');
  const hosting=JSON.parse(await readFile(configuration,'utf8'));
  if(!hosting||Array.isArray(hosting)||Object.keys(hosting).some(key=>!['project_id','d1','capabilities'].includes(key))||!/^appgprj_[A-Za-z0-9_-]+$/.test(hosting.project_id??'')||hosting.d1!=='DB'||!Array.isArray(hosting.capabilities)||hosting.capabilities.length!==1||hosting.capabilities[0]!=='mcp')throw Error('Use only the new Site project_id, d1: DB and capabilities: [mcp]; runtime variables and credentials are not accepted');
  const journal=JSON.parse(await readFile(join(root,'drizzle/meta/_journal.json'),'utf8'));
  if(!Array.isArray(journal.entries)||journal.entries.some((entry,index)=>entry.idx!==index||!/^\d{4}_[a-zA-Z0-9_]+$/.test(entry.tag)))throw Error('Invalid checked-in migration journal');
  const files=[['dist/server/index.js',await readFile(join(root,'dist/sites/index.js'))],['dist/.openai/hosting.json',Buffer.from(JSON.stringify(hosting,null,2)+'\n')],['dist/.openai/drizzle/meta/_journal.json',await readFile(join(root,'drizzle/meta/_journal.json'))]];
  for(const entry of journal.entries){
    const snapshot=String(entry.idx).padStart(4,'0')+'_snapshot.json';
    for(const relative of [entry.tag+'.sql','meta/'+snapshot])files.push(['dist/.openai/drizzle/'+relative,await readFile(join(root,'drizzle',relative))]);
  }
  await mkdir(output,{mode:0o700}); // Refuse an existing destination; never replace another release.
  for(const [path,body] of files){const target=join(output,path);await mkdir(resolve(target,'..'),{recursive:true,mode:0o700});await writeFile(target,body,{mode:0o600,flag:'wx'});}
  return {staged:true,files:files.length,migrations:journal.entries.length,output,worker:'dist/server/index.js',sourceWorker:'dist/sites/index.js',deployed:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=process.argv.slice(2),options={};
  for(let index=0;index<args.length;index+=2){if(!['--hosting','--out'].includes(args[index])||!args[index+1])throw Error('Usage: npm run package:sites -- --hosting /private/hosting.json --out /new/staging-directory');options[args[index]]=args[index+1];}
  if(!options['--hosting']||!options['--out'])throw Error('Both --hosting and --out are required');
  const build=spawnSync(process.execPath,[join(root,'scripts/build.mjs'),'--sites'],{stdio:'inherit'});if(build.status!==0)process.exit(build.status||1);
  console.log(JSON.stringify(await stageSitesDeployment({hostingPath:options['--hosting'],outDir:options['--out']})));
}
