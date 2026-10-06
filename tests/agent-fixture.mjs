export function agentFixture() {
  const observedAt='2026-01-01T12:00:00Z';
  return {
    schemaVersion:'dot-board.snapshot/2',importedAt:observedAt,
    source:{label:'Synthetic agent relationship example',mode:'synthetic'},
    coverage:{scope:'Three synthetic observed nodes only'},
    tasks:[{id:'sample-one',title:'Synthetic read-model task',project:'Example project',state:'running',observedAt,ownerRole:'A role label is not an extra agent'}],
    agents:[
      {id:'example-root',name:'Example coordinator',type:'agent',kind:'coordinator',role:'Coordinator',parentAgentId:null,projectNames:[],taskIds:[],activity:{state:'running',summary:'Coordinate the example',observedAt},source:{kind:'host_observation',label:'Synthetic export',observedAt}},
      {id:'example-builder',name:'Example builder',type:'subagent',kind:'owner',role:'Implementation',parentAgentId:'example-root',projectNames:['Example project'],taskIds:['sample-one'],activity:{state:'running',summary:'Implementing the example',observedAt},source:{kind:'host_observation',label:'Synthetic export',observedAt}},
      {id:'example-reviewer',name:'Example reviewer',type:'subagent',kind:'reviewer',role:'Review',parentAgentId:'example-root',projectNames:['Example project'],taskIds:['sample-one'],activity:{state:'completed',summary:'The scoped check is finished',observedAt},latestResult:{summary:'Scoped check passed; business acceptance remains separate',observedAt,evidence:[{label:'Synthetic result',url:'https://example.com/result'}]},source:{kind:'verified_report',label:'Synthetic report',observedAt}}
    ]
  };
}
