import test from 'node:test';
import assert from 'node:assert/strict';
import {boardObservationInputSchema} from '../src/presentation/observations-mcp.mjs';
import {normalizeBoardObservation} from '../src/domain/board-observation.mjs';
const schema=boardObservationInputSchema.properties.changes.properties.evidence.items.properties.url;
// Some connector validators require a full match rather than JSON Schema's search.
const fullMatch=value=>new RegExp('^(?:'+schema.pattern+')$').test(value);
const input=url=>({taskId:'test-task',eventId:'test-event',expectedVersion:0,source:{threadId:'test-thread',environment:null,turnId:'test-turn',itemId:'test-item',observedAt:'2026-10-08T01:00:00Z'},changes:{observation:'Synthetic evidence',evidence:[{label:'Result',url}]}});
const normalize=url=>normalizeBoardObservation(input(url),Date.parse('2026-10-08T02:00:00Z'));
test('HTTPS evidence schema consumes the entire URL for full-match connector validators',()=>{
  assert.equal(new RegExp('^(?:^https://)$').test('https://example.com/repository/pull/5'),false);
  for(const url of ['https://example.com/repository/pull/5','https://example.com/','https://example.com:8443/report?q=checked#result']){assert(fullMatch(url),url);assert.equal(normalize(url).changes.evidence[0].url,url);}
});
test('HTTPS evidence schema rejects schemes, empty host, whitespace and userinfo',()=>{
  for(const url of ['http://example.com/','ftp://example.com/','javascript:alert(1)','https://','https:///report','https://?q=x','https://#result','https://user@example.com/','https://example.com/a b',' https://example.com/']){assert.equal(fullMatch(url),false,url);assert.throws(()=>normalize(url),{code:'invalid_observation_evidence'});}
});
test('server retains stricter URL safety even when schema matches',()=>{
  for(const url of ['https://localhost/','https://127.0.0.1/','https://10.0.0.1/','https://example.com/?token=private','https://example.com:99999/']){assert(fullMatch(url),url);assert.throws(()=>normalize(url),{code:'invalid_observation_evidence'});}
});
