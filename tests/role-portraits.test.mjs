import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePortraitRole,createRolePortrait} from '../public/collaboration-graph.js';
test('verified role categories use fixed foundation artwork and disclose missing personal settings',()=>{
  for(const [kind,key] of Object.entries({coordinator:'coordinator',owner:'pirate',worker:'clerk',reviewer:'inspector',researcher:'researcher'})){
    const value=resolvePortraitRole({id:'synthetic-agent',kind});assert.equal(value.key,key);assert.equal(value.mode,'role_default');assert.match(value.note,/个人专属设定未建档/);
  }
});
test('unknown roles use stable identity rather than project, order, name or refresh state',()=>{
  const a={id:'example-unclassified',kind:'unknown',name:'Example',projectNames:['A']};const b={...a,name:'Renamed',projectNames:['B','A'],activity:{state:'completed'}};
  assert.deepEqual(resolvePortraitRole(a),resolvePortraitRole(b));assert.equal(resolvePortraitRole(a).mode,'stable_generated');
  assert(new Set(Array.from({length:30},(_,i)=>resolvePortraitRole({id:'example-'+i,kind:'unknown'}).key)).size>1);
  assert.equal(resolvePortraitRole({kind:'unknown'}).mode,'unassigned');assert.equal(resolvePortraitRole({kind:'unknown'}).key,null);
});
test('all portrait placements resolve the same asset coordinates for the same identity',()=>{
  const doc={createElement:()=>({style:{},dataset:{},classList:{add(){}},setAttribute(){}})};const agent={id:'example-shared',kind:'unknown'};
  const project=createRolePortrait(doc,agent,'project'),details=createRolePortrait(doc,{...agent},'details');
  assert.deepEqual(project.style,details.style);assert.equal(project.dataset.portraitRole,details.dataset.portraitRole);assert.equal(project.style.backgroundImage,'url(/dot-agent-roles.png)');
});
