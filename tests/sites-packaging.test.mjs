import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {stageSitesDeployment} from '../scripts/package-sites.mjs';

async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'synthetic-sites-package-'));t.after(()=>rm(directory,{recursive:true,force:true}));const hostingPath=join(directory,'hosting.json');await writeFile(hostingPath,JSON.stringify({project_id:'appgprj_synthetic_site',d1:'DB',capabilities:['mcp']}));return {directory,hostingPath,outDir:join(directory,'stage')};}
test('Sites staging includes the private bundle and complete immutable schema chain without public-build replacement',async t=>{
 const c=await fixture(t),before=await readFile(new URL('../dist/server/index.js',import.meta.url)),result=await stageSitesDeployment(c);
 assert.equal(result.files,19);assert.equal(result.migrations,8);assert.equal(result.deployed,false);
 assert.deepEqual(await readFile(join(c.outDir,'dist/server/index.js')),await readFile(new URL('../dist/sites/index.js',import.meta.url)));
 assert.deepEqual(await readFile(new URL('../dist/server/index.js',import.meta.url)),before);
 const journal=JSON.parse(await readFile(new URL('../drizzle/meta/_journal.json',import.meta.url)));for(const e of journal.entries){for(const path of [e.tag+'.sql','meta/'+String(e.idx).padStart(4,'0')+'_snapshot.json'])assert.deepEqual(await readFile(join(c.outDir,'dist/.openai/drizzle',path)),await readFile(new URL('../drizzle/'+path,import.meta.url)));}
 assert.deepEqual((await readdir(join(c.outDir,'dist'))).sort(),['.openai','server']);
 await assert.rejects(stageSitesDeployment(c),/EEXIST/);
});
test('Sites staging rejects runtime variables, credentials and missing installation identity',async t=>{
 const c=await fixture(t);for(const hosting of [{d1:'DB',capabilities:['mcp']},{project_id:'appgprj_synthetic_site',d1:'DB',capabilities:['mcp'],token:'synthetic-not-a-credential'},{project_id:'appgprj_synthetic_site',d1:'DB',capabilities:['mcp'],DOT_BOARD_SNAPSHOT:{source:{mode:'synthetic'}}}]){await writeFile(c.hostingPath,JSON.stringify(hosting));await assert.rejects(stageSitesDeployment(c),/runtime variables and credentials are not accepted/);}
});
test('Sites staging refuses source-checkout destinations and source-hosted private configuration',async t=>{
 const c=await fixture(t);await assert.rejects(stageSitesDeployment({...c,outDir:new URL('../dist/private-stage',import.meta.url).pathname}),/outside the source checkout/);await assert.rejects(stageSitesDeployment({...c,hostingPath:new URL('../config/hosting.sites.example.json',import.meta.url).pathname}),/outside the source checkout/);
});
