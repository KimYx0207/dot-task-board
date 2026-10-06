import {normalizeSnapshot, SnapshotError} from '../domain/snapshot.mjs';
export function observationState(observedAt, now, staleAfterMinutes) {
  if (!observedAt) return 'unknown';
  const age = now - Date.parse(observedAt);
  if (age < -300000) return 'clock_error';
  return age > staleAfterMinutes * 60000 ? 'stale' : 'current';
}
export function buildBoard(input, config, now = Date.now()) {
  const snapshot = normalizeSnapshot(input,config);
  const agents=snapshot.agents.map(agent=>({...agent,activity:{...agent.activity,
    observationState:observationState(agent.activity.observedAt,now,config.staleAfterMinutes)}}));
  const tasks = snapshot.tasks.map(task => ({...task,
    assignedAgentIds:agents.filter(agent=>agent.taskIds.includes(task.id)).map(agent=>agent.id),
    observationState:observationState(task.observedAt,now,config.staleAfterMinutes),
    stateView:config.states[task.state]
  })).sort((a,b) => a.stateView.order - b.stateView.order || a.title.localeCompare(b.title,'zh-CN'));
  const currentActive=agent=>agent.kind!=='coordinator'&&agent.activity.state==='running'&&agent.activity.observationState==='current';
  const workers=agents.filter(agent=>agent.kind!=='coordinator');
  const latest=values=>values.filter(Boolean).sort().at(-1)??null;
  const projectNames=[...new Set([...tasks.map(t=>t.project),...agents.flatMap(a=>a.projectNames)])].sort();
  const projectSummaries=projectNames.map(name=>{
    const projectTasks=tasks.filter(t=>t.project===name),projectAgents=agents.filter(a=>a.projectNames.includes(name));
    return {name,taskIds:projectTasks.map(t=>t.id),agentIds:projectAgents.map(a=>a.id),activeAgentIds:projectAgents.filter(currentActive).map(a=>a.id),pausedTaskCount:projectTasks.filter(t=>t.state==='paused').length,unknownTaskCount:projectTasks.filter(t=>t.state==='unknown').length,lastObservedAt:latest([...projectTasks.map(t=>t.observedAt),...projectAgents.map(a=>a.activity.observedAt)])};
  });
  const agentSummary={knownAgents:agents.length,coordinators:agents.filter(a=>a.kind==='coordinator').length,activeWorkers:workers.filter(currentActive).length,waitingWorkers:workers.filter(a=>['waiting','blocked'].includes(a.activity.state)&&a.activity.observationState==='current').length,completedWorkers:workers.filter(a=>a.activity.state==='completed').length,unknownWorkers:workers.filter(a=>a.activity.state==='unknown'||(a.activity.state!=='completed'&&a.activity.observationState!=='current')).length,coverage:'selected_known_business_workers',observedAt:latest(agents.map(a=>a.source.observedAt))};
  return {...snapshot, tasks, agents,agentSummary,projectSummaries,generatedAt:new Date(now).toISOString(),
    counts:Object.fromEntries(Object.keys(config.states).map(state => [state,tasks.filter(t=>t.state===state).length])),
    projects:projectNames,
    presentation:{title:config.title,text:config.text,states:config.states,agentStates:config.agentStates,verification:config.verification,staleAfterMinutes:config.staleAfterMinutes}
  };
}
export async function readBoard(readSnapshot, config, now = Date.now()) {
  try {
    const input = await readSnapshot();
    if (!input) return {status:503,body:{error:'no_feed'}};
    return {status:200,body:buildBoard(input,config,now)};
  } catch(error) {
    return {status:503,body:{error:error instanceof SnapshotError ? error.code : 'source_unavailable'}};
  }
}
