import {taskDisplayProjection} from '../../public/task-display.js';
import {taskStatusOverlayMetadata} from '../domain/task-status-overlay.mjs';
import {intakeDigest,intakeProjectRegistry,intakeProjectForName} from '../domain/intake.mjs';
import {normalizeSnapshot, SnapshotError} from '../domain/snapshot.mjs';
import {dispatchProjectionMetadata} from './dispatch-projection.mjs';
export function observationState(observedAt, now, staleAfterMinutes) {
  if (!observedAt) return 'unknown';
  const age = now - Date.parse(observedAt);
  if (age < -300000) return 'clock_error';
  return age > staleAfterMinutes * 60000 ? 'stale' : 'current';
}
export function buildBoard(input, config, now = Date.now()) {
  const snapshot = normalizeSnapshot(input,config);
  const registry=intakeProjectRegistry(input.projectRegistry);
  const agents=snapshot.agents.map(agent=>({...agent,activity:{...agent.activity,
    observationState:observationState(agent.activity.observedAt,now,config.staleAfterMinutes)}}));
  const tasks = snapshot.tasks.map(task => ({...task,
    projectId:intakeProjectForName(registry,task.project)?.id??null,
    assignedAgentIds:agents.filter(agent=>agent.taskIds.includes(task.id)).map(agent=>agent.id),
    observationState:observationState(task.observedAt,now,config.staleAfterMinutes),
    stateView:config.states[task.state],
    ...taskDisplayProjection(task,config.states)
  })).sort((a,b) => a.displayStateView.order - b.displayStateView.order || a.title.localeCompare(b.title,'zh-CN'));
  const currentActive=agent=>agent.kind!=='coordinator'&&agent.activity.state==='running'&&agent.activity.observationState==='current';
  const workers=agents.filter(agent=>agent.kind!=='coordinator');
  const latest=values=>values.filter(Boolean).sort().at(-1)??null;
  const observedProjectNames=[...new Set([...tasks.map(t=>t.project),...agents.flatMap(a=>a.projectNames)])];
  const representedIds=new Set(observedProjectNames.map(name=>intakeProjectForName(registry,name)?.id).filter(Boolean));
  const projectNames=[...observedProjectNames,...registry.filter(project=>project.acceptNewRequests===true&&!representedIds.has(project.id)).map(project=>project.name)].sort();
  const projectSummaries=projectNames.map(name=>{
    const projectTasks=tasks.filter(t=>t.project===name),projectAgents=agents.filter(a=>a.projectNames.includes(name));
    return {id:intakeProjectForName(registry,name)?.id??null,canonicalName:intakeProjectForName(registry,name)?.name??name,name,taskIds:projectTasks.map(t=>t.id),agentIds:projectAgents.map(a=>a.id),activeAgentIds:projectAgents.filter(currentActive).map(a=>a.id),pausedTaskCount:projectTasks.filter(t=>t.state==='paused').length,unknownTaskCount:projectTasks.filter(t=>t.state==='unknown').length,lastObservedAt:latest([...projectTasks.map(t=>t.observedAt),...projectAgents.map(a=>a.activity.observedAt)])};
  });
  const agentSummary={knownAgents:agents.length,coordinators:agents.filter(a=>a.kind==='coordinator').length,activeWorkers:workers.filter(currentActive).length,waitingWorkers:workers.filter(a=>['waiting','blocked'].includes(a.activity.state)&&a.activity.observationState==='current').length,completedWorkers:workers.filter(a=>a.activity.state==='completed').length,unknownWorkers:workers.filter(a=>a.activity.state==='unknown'||(a.activity.state!=='completed'&&a.activity.observationState!=='current')).length,coverage:'selected_known_business_workers',observedAt:latest(agents.map(a=>a.source.observedAt))};
  return {...snapshot, tasks, agents,agentSummary,projectSummaries,...(taskStatusOverlayMetadata(input)?{statusUpdates:taskStatusOverlayMetadata(input)}:{}),...(dispatchProjectionMetadata(input)?{queueUpdates:dispatchProjectionMetadata(input),...(dispatchProjectionMetadata(input).projectTotals?{projectTotals:dispatchProjectionMetadata(input).projectTotals}:{})}:{}),generatedAt:new Date(now).toISOString(),
    displayCounts:Object.fromEntries(Object.keys(config.states).map(state => [state,tasks.filter(t=>t.displayState===state).length])),
    counts:Object.fromEntries(Object.keys(config.states).map(state => [state,tasks.filter(t=>t.state===state).length])),
    projects:projectNames,
    presentation:{title:config.title,text:config.text,states:config.states,agentStates:config.agentStates,verification:config.verification,staleAfterMinutes:config.staleAfterMinutes}
  };
}
export async function readBoard(readSnapshot, config, now = Date.now()) {
  try {
    const input = await readSnapshot();
    if (!input) return {status:503,body:{error:'no_feed'}};
    const body=buildBoard(input,config,now);
    body.snapshotRevision='sha256:'+await intakeDigest({snapshot:normalizeSnapshot(input,config),projectRegistry:intakeProjectRegistry(input.projectRegistry),...(dispatchProjectionMetadata(input)?{queueUpdates:dispatchProjectionMetadata(input)}:{})});
    return {status:200,body};
  } catch(error) {
    return {status:503,body:{error:error instanceof SnapshotError ? error.code : 'source_unavailable'}};
  }
}
