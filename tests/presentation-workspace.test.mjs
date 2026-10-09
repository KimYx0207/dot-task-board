import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateProjects, renderProjectOverview} from '../public/project-overview.js';

// Presentation contracts exercise real selection and disclosure behavior without a browser.
class Node {
  constructor(tag,ownerDocument){this.tagName=tag.toUpperCase();this.ownerDocument=ownerDocument;this.children=[];this.dataset={};this.attributes={};this.style={};this.events=new Map();this.className='';this.ownText='';this.classList={add:(v)=>{this.className+=' '+v;},contains:v=>this.className.split(/\s+/).includes(v)};}
  set textContent(v){this.ownText=String(v);this.children=[];}
  get textContent(){return this.ownText+this.children.map(n=>n.textContent).join('');}
  set innerHTML(_){throw Error('Unsafe HTML insertion');}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children=[];this.ownText='';this.append(...children);}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  addEventListener(k,fn){const listeners=this.events.get(k)||[];listeners.push(fn);this.events.set(k,listeners);}
  fire(k){for(const fn of this.events.get(k)||[])fn({target:this});}
  click(){this.fire('click');}
}
const walk=n=>[n,...n.children.flatMap(walk)];
const nodes=(root,cls)=>walk(root).filter(n=>n.classList.contains(cls));
function setup(){const doc={createElement:tag=>new Node(tag,doc)};return doc.createElement('section');}
const now=Date.parse('2026-10-07T12:00:00Z');
const input=()=>({projects:['Project A'],tasks:[{id:'stable-a',taskNumber:12,title:'Task A',project:'Project A',state:'blocked',blocker:'Awaiting approval',assignedAgentIds:['builder','reviewer'],observedAt:'2026-10-07T11:59:00Z',evidence:[{url:'https://example.com/evidence'}]}],agents:[{id:'builder',name:'Builder',kind:'worker',projectNames:['Project A'],taskIds:['stable-a'],activity:{state:'waiting',observedAt:'2026-10-07T11:59:00Z'}},{id:'reviewer',name:'Reviewer',kind:'reviewer',projectNames:['Project A'],taskIds:['stable-a'],activity:{state:'unknown'}}]});

test('one project path keeps both assigned Agent identities and stable task number',()=>{
 const root=setup(),model=aggregateProjects(input(),{now});
 renderProjectOverview(root,model,{onTask(){},onAgent(){},onProject(){}});
 assert.equal(nodes(root,'po-zone').length,1);assert.equal(nodes(root,'po-task-row').length,1);
 assert.match(nodes(root,'po-task-title')[0].textContent,/#12/);
 assert.deepEqual(nodes(root,'po-task-agents')[0].children.map(n=>nodes(n,'po-agent-copy')[0].children[0].textContent),['Builder','Reviewer']);
 assert.equal(nodes(root,'po-task')[0].tagName,'BUTTON');
 assert(nodes(root,'po-agent').every(n=>n.tagName==='BUTTON'));
 assert(root.textContent.includes('状态为观察快照，非实时'));
 assert(root.textContent.includes('任务完成记录不等于业务验收'));
});

test('task and Agent actions keep source IDs, not list order',()=>{
 const root=setup(),selected=[];renderProjectOverview(root,aggregateProjects(input(),{now}),{onTask:id=>selected.push(['task',id]),onAgent:id=>selected.push(['agent',id]),onProject:id=>selected.push(['project',id])});
 nodes(root,'po-task')[0].click();for(const node of nodes(root,'po-agent'))node.click();nodes(root,'po-zone-title')[0].click();
 assert.deepEqual(selected,[['task','stable-a'],['agent','builder'],['agent','reviewer'],['project','Project A']]);
});

test('task-only and Agent-only content filters retain their own objects',()=>{
 const model=aggregateProjects(input(),{now}),root=setup();
 renderProjectOverview(root,model,{contentType:'tasks'});assert.equal(nodes(root,'po-task-row').length,1);assert.equal(nodes(root,'po-agent').length,0);
 renderProjectOverview(root,model,{contentType:'agents'});assert.equal(nodes(root,'po-task-row').length,0);assert.equal(nodes(root,'po-agent').length,2);
});

test('evidence count is a keyboard-usable route to the associated details',()=>{
 const root=setup(),selected=[];renderProjectOverview(root,aggregateProjects(input(),{now}),{onTask:id=>selected.push(id)});
 const evidence=nodes(root,'po-task-evidence')[0];assert(evidence);assert.equal(evidence.tagName,'BUTTON');evidence.click();assert.deepEqual(selected,['stable-a']);
});

test('empty status filter does not present first-use project onboarding',()=>{
 const root=setup(),model=aggregateProjects(input(),{now,taskState:'completed'});assert.equal(model.projects.length,0);renderProjectOverview(root,model,{});
 assert.doesNotMatch(nodes(root,'po-empty')[0].textContent,/项目从这里开始/);assert.match(nodes(root,'po-empty')[0].textContent,/匹配|筛选/);
});

test('disclosure summary focus has stable identity across rerenders',()=>{
 const root=setup(),model=aggregateProjects(input(),{now});renderProjectOverview(root,model,{});
 for(const cls of ['po-help','po-deliveries']){const panel=nodes(root,cls)[0],summary=panel.children.find(n=>n.tagName==='SUMMARY');assert(summary.dataset.focusKey,cls+' focus key missing');panel.open=true;panel.fire('toggle');}
 renderProjectOverview(root,model,{});for(const cls of ['po-help','po-deliveries'])assert.equal(nodes(root,cls)[0].open,true);
});
