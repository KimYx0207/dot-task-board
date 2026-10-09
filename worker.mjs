import {applyTaskStatusOverlay} from './src/domain/task-status-overlay.mjs';
import {readEnvironmentProjectRegistry,withIndependentProjectRegistry,gateIntakeByProjectRegistry} from './src/adapters/project-registry.mjs';
import {handleRequest} from './src/presentation/http.mjs';
import {readEnvironmentSnapshot,readEnvironmentTaskStatusOverlay} from './src/adapters/snapshot.mjs';
import {boardConfig} from './config/board.mjs';
import {intakeCapabilities} from './src/domain/intake.mjs';
import {createD1IntakeStore} from './src/adapters/d1-intake.mjs';
import {createIntakeService} from './src/application/intake-service.mjs';
import {readBoard} from './src/application/board-service.mjs';
import {createD1McpEventsStore} from './src/adapters/d1-mcp-events.mjs';
import {createMcpEventsService} from './src/application/mcp-events-service.mjs';
import {createD1DispatchQueue} from './src/adapters/d1-dispatch-queue.mjs';
import {createDispatchService} from './src/application/dispatch-service.mjs';
import {projectAccountingView} from './src/application/project-accounting.mjs';
import {projectDispatchJobs} from './src/application/dispatch-projection.mjs';
export function createWorker(assets,config=boardConfig,runtime={}) {
  async function eventRuntime(env,registry){
    const eventStore=createD1McpEventsStore(env.DB),requested=env.DOT_BOARD_EVENTS_ENABLED==='true',available=requested&&Boolean(eventStore)&&await eventStore.available();
    const events=available?createMcpEventsService({store:eventStore,transport:runtime.eventTransport,clock:runtime.clock,authorize:async details=>Boolean(registry.status==='configured'&&(details.action==='list'||registry.records.some(p=>p.id===details.arguments.projectId))&&typeof runtime.authorizeEvent==='function'&&await runtime.authorizeEvent(details,env))}):null;
    return {eventStore:available?eventStore:null,events,requested,available};
  }
  return {async fetch(request,env={},ctx={}) {
    const path=new URL(request.url).pathname;
    const needsStorage=path==='/health'||path==='/mcp'||path==='/api/board'||path.startsWith('/api/dispatch/')||path.startsWith('/api/tasks/')||path.startsWith('/api/intake/')||path.startsWith('/api/projects/')||path.startsWith('/api/requests/');
    const registry=readEnvironmentProjectRegistry(env);
    const event=needsStorage?await eventRuntime(env,registry):{eventStore:null,events:null,requested:false,available:false};
    const queueStore=createD1DispatchQueue(env.DB),queueRequested=env.DOT_BOARD_QUEUE_ENABLED==='true',queueAvailable=queueRequested&&Boolean(queueStore)&&needsStorage&&await queueStore.available();
    const store=createD1IntakeStore(env.DB,{eventStore:event.eventStore,guardDispatchOwnership:queueAvailable});
    const storageAvailable=Boolean(store)&&(needsStorage?await store.available():false);
    let capabilities=gateIntakeByProjectRegistry(intakeCapabilities(env,storageAvailable),registry);
    if(event.requested&&!event.available||queueRequested&&needsStorage&&!queueAvailable)capabilities={...capabilities,canSubmit:false,enabled:false};
    const ownerId=request.headers.get('oai-authenticated-user-id');
    const readSnapshot=async()=>{
      let snapshot=withIndependentProjectRegistry(await applyTaskStatusOverlay(runtime.readObservationSnapshot?await runtime.readObservationSnapshot(readEnvironmentSnapshot(env),env,ownerId):readEnvironmentSnapshot(env),readEnvironmentTaskStatusOverlay(env),config),registry);
      if(snapshot&&queueAvailable&&ownerId&&runtime.projectQueueProjection!==false){const projection=await queueStore.projectionInputs(ownerId,Math.max(0,config.maxTasks-snapshot.tasks.length));snapshot=projectDispatchJobs(snapshot,projection.jobs,projection.requests,registry.records,{maxTasks:config.maxTasks,maxAgents:config.maxAgents,totalJobs:await queueStore.count(ownerId),now:runtime.clock?.()??Date.now(),projectTotals:projectAccountingView(await queueStore.projectAccounting(ownerId),registry.records,runtime.clock?.()??Date.now())});}
      return snapshot;
    };
    const service=createIntakeService({store,readBoard:()=>readBoard(readSnapshot,config),capabilities,clock:runtime.clock,newId:runtime.newId});
    const dispatch=queueAvailable?createDispatchService({store:queueStore,requests:service,enabled:true,readRegistry:async()=>{const current=readEnvironmentProjectRegistry(env);return current.status==='configured'?current.records:null;},capacity:env.DOT_BOARD_QUEUE_CAPACITY??1,clock:runtime.clock}):null;
    const response=await handleRequest(request,{readSnapshot,getAsset:path=>assets[path],config,intake:{service,capabilities,manualStatus:runtime.manualStatusFor?runtime.manualStatusFor(env):null,mcpEnabled:env.DOT_BOARD_INTAKE_MCP_ENABLED==='true',events:event.events,eventsEnabled:event.available,dispatch,manualCheck:runtime.manualCheckFor?runtime.manualCheckFor(env,{requests:service,dispatch,clock:runtime.clock}):null,observations:runtime.observationsFor?await runtime.observationsFor(env,ownerId):null,taskControls:runtime.taskControlsFor?runtime.taskControlsFor(env,ownerId):null}});
    if(event.events&&response.status===201&&request.method==='POST'&&path.startsWith('/api/projects/')&&typeof ctx.waitUntil==='function')ctx.waitUntil(event.events.drain({limit:10}));
    return response;
  },async scheduled(_controller,env={}){
    const event=await eventRuntime(env,readEnvironmentProjectRegistry(env));return event.events?event.events.drain({limit:50}):{disabled:true};
  }};
}
