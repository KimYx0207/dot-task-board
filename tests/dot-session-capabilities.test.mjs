import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDotSessionCapabilities,dotSessionToolNames} from '../src/adapters/dot-session-tools.mjs';

test('capability inspection names every missing dependency without invoking tools',()=>{
 const r=inspectDotSessionCapabilities();assert.equal(r.dependenciesPresent,false);assert.equal(r.missingTools.length,Object.keys(dotSessionToolNames).length);assert.deepEqual(r.missingHostFunctions,['reviewContinuation','reviewCompletion','newEventId']);assert.equal(r.executionAuthorized,false);assert.equal(r.executionStarted,false);
});
test('tool presence never claims authorization or execution, and missing withdrawal is explicit',()=>{
 const never=()=>{throw Error('must not invoke');};const nativeTools=Object.fromEntries(Object.values(dotSessionToolNames).map(key=>[key,never]));
 let r=inspectDotSessionCapabilities({nativeTools,reviewContinuation:never,reviewCompletion:never,newEventId:never});assert.equal(r.dependenciesPresent,true);assert.equal(r.executionAuthorized,false);
 delete nativeTools[dotSessionToolNames.getWithdrawal];r=inspectDotSessionCapabilities({nativeTools,reviewContinuation:never,reviewCompletion:never,newEventId:never});assert.equal(r.dependenciesPresent,false);assert.deepEqual(r.missingTools,[{role:'getWithdrawal',tool:dotSessionToolNames.getWithdrawal}]);
});
