import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker.mjs';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createBoardServer} from '../server.mjs';
test('role image route preserves binary bytes and keeps read-only/cache protections',async()=>{
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,255,128,0]);
  const worker=createWorker({'/dot-agent-roles.png':png});
  const response=await worker.fetch(new Request('https://example.com/dot-agent-roles.png'));
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),png);
  assert.match(response.headers.get('cache-control'),/private.*no-store/);
  assert.equal((await worker.fetch(new Request('https://example.com/dot-agent-roles.png',{method:'POST'}))).status,405);
  assert.equal((await worker.fetch(new Request('https://example.com/unlisted-image.png'))).status,404);
  assert.equal((await(await worker.fetch(new Request('https://example.com/dot-agent-roles.png',{method:'HEAD'}))).arrayBuffer()).byteLength,0);
});
test('compiled Worker and standalone Node serve the exact generated PNG bytes',async t=>{
  const build=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});assert.equal(build.status,0,build.stderr);
  const expected=await readFile(new URL('../public/dot-agent-roles.png',import.meta.url));assert.deepEqual([...expected.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const worker=(await import('../dist/server/index.js?binary-check='+Date.now())).default;
  const response=await worker.fetch(new Request('https://example.com/dot-agent-roles.png'));
  assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
  const server=createBoardServer({env:{}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const served=await fetch(`http://127.0.0.1:${server.address().port}/dot-agent-roles.png`);assert.equal(served.status,200);assert.deepEqual(Buffer.from(await served.arrayBuffer()),expected);
});
