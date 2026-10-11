import {candidateCapabilities} from './src/domain/candidates.mjs';
import {createD1CandidateStore} from './src/adapters/d1-candidates.mjs';
import {createCandidateService} from './src/application/candidate-service.mjs';
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
    const eventStore=createD1McpEventsStore(env.DB),requested=env.DOT_BOARD_EVENTS_ENABLED==='true';
    const discoveryRequested=runtime.eventDiscoveryEnabledFor?runtime.eventDiscoveryEnabledFor(env):requested;
    const storageReady=Boolean((requested||discoveryRequested)&&eventStore&&await eventStore.available()),available=requested&&storageReady;
    const discoveryReady=Boolean(runtime.eventDiscoveryEnabledFor?discoveryRequested:available);
    const transport=runtime.eventTransportFor?runtime.eventTransportFor(env):runtime.eventTransport;
    const events=discoveryReady?createMcpEventsService({store:storageReady?eventStore:null,transport,clock:runtime.clock,authorize:async details=>{const current=readEnvironmentProjectRegistry(env);const scopeAllowed=details.action==='unsubscribe'&&runtime.ownerScopedEventUnsubscribe===true||current.status==='configured'&&(details.action==='list'||current.records.some(p=>p.id===details.arguments.projectId));return Boolean(scopeAllowed&&typeof runtime.authorizeEvent==='function'&&await runtime.authorizeEvent(details,env));}}):null;
    const transportStatus=transport?.readiness?.()??{ready:Boolean(transport),reason:transport?'': 'event_transport_disabled'};
    return {eventStore:available?eventStore:null,statusStore:storageReady?eventStore:null,events,requested,available,discoveryReady,storageReady,transportStatus};
  }
  return {async fetch(request,env={},ctx={}) {
    const path=new URL(request.url).pathname;
    const needsStorage=path==='/api/config'||path==='/api/candidates'||path.startsWith('/api/candidates/')||path==='/health'||path==='/mcp'||path==='/api/board'||path.startsWith('/api/dispatch/')||path.startsWith('/api/tasks/')||path.startsWith('/api/intake/')||path.startsWith('/api/projects/')||path.startsWith('/api/requests/');
    const registry=readEnvironmentProjectRegistry(env);
    const event=needsStorage?await eventRuntime(env,registry):{eventStore:null,events:null,requested:false,available:false};
    const queueStore=createD1DispatchQueue(env.DB),queueRequested=env.DOT_BOARD_QUEUE_ENABLED==='true',queueAvailable=queueRequested&&Boolean(queueStore)&&needsStorage&&await queueStore.available();
    let createdRequestId=null;
    const baseStore=createD1IntakeStore(env.DB,{eventStore:event.eventStore,guardDispatchOwnership:queueAvailable});
    const store=baseStore?{...baseStore,async create(value){const saved=await baseStore.create(value);if(!saved.replayed)createdRequestId=saved.request.id;return saved;}}:null;
    const storageAvailable=Boolean(store)&&(needsStorage?await store.available():false);
    let capabilities=gateIntakeByProjectRegistry(intakeCapabilities(env,storageAvailable),registry);
    if(event.requested&&!event.available||queueRequested&&needsStorage&&!queueAvailable)capabilities={...capabilities,canSubmit:false,enabled:false};
    const ownerId=request.headers.get('oai-authenticated-user-id');
    const readSnapshot=async()=>{
      let snapshot=withIndependentProjectRegistry(await applyTaskStatusOverlay(runtime.readObservationSnapshot?await runtime.readObservationSnapshot(readEnvironmentSnapshot(env),env,ownerId):readEnvironmentSnapshot(env),readEnvironmentTaskStatusOverlay(env),config),registry);
      if(snapshot&&queueAvailable&&ownerId&&runtime.projectQueueProjection!==false){const projection=await queueStore.projectionInputs(ownerId,Math.max(0,config.maxTasks-snapshot.tasks.length));snapshot=projectDispatchJobs(snapshot,projection.jobs,projection.requests,registry.records,{maxTasks:config.maxTasks,maxAgents:config.maxAgents,totalJobs:await queueStore.count(ownerId),now:runtime.clock?.()??Date.now(),projectTotals:projectAccountingView(await queueStore.projectAccounting(ownerId),registry.records,runtime.clock?.()??Date.now())});}
      return snapshot;
    };
    const service=createIntakeService({store,readBoard:()=>readBoard(readSnapshot,config),capabilities,projectEventScope:runtime.projectEventScopeFor?details=>runtime.projectEventScopeFor(details,env):null,clock:runtime.clock,newId:runtime.newId});
    const baseCandidateStore=createD1CandidateStore(env.DB,{eventStore:runtime.candidateRequestEvents?event.eventStore:null});
    const candidateStore=baseCandidateStore?{...baseCandidateStore,async review(...args){const saved=await baseCandidateStore.review(...args);if(runtime.candidateRequestEvents&&!saved.replayed&&saved.candidate?.requestId)createdRequestId=saved.candidate.requestId;return saved;}}:null,candidateStorageAvailable=storageAvailable&&Boolean(candidateStore)&&await candidateStore.available();
    const candidateCaps=candidateCapabilities(capabilities,candidateStorageAvailable);
    const candidates=candidateStorageAvailable?createCandidateService({store:candidateStore,requests:service,readBoard:()=>readBoard(readSnapshot,config),capabilities:candidateCaps,clock:runtime.clock,newId:runtime.newId}):null;
    capabilities={...capabilities,candidates:candidateCaps};
    if(runtime.eventDeliveryMode){
      let summary=null;
      if(event.storageReady&&ownerId)try{summary=await event.statusStore.deliverySummary(ownerId,new Date(runtime.clock?.()??Date.now()).toISOString());}catch{}
      const scopeReady=registry.status==='configured'&&registry.records.length>0&&(!runtime.eventScopeReadyFor||runtime.eventScopeReadyFor(env));
      capabilities.eventDelivery={mode:runtime.eventDeliveryMode,requested:event.requested,discoveryReady:event.discoveryReady,storageReady:event.storageReady,transportReady:Boolean(event.requested&&event.transportStatus?.ready),canSubscribe:Boolean(event.available&&event.discoveryReady&&scopeReady&&event.transportStatus?.ready),reason:!event.requested?'direct_events_disabled':!event.discoveryReady?'event_mcp_disabled':!scopeReady?'event_project_scope_unavailable':!event.storageReady?'event_storage_unavailable':!event.transportStatus?.ready?event.transportStatus?.reason:summary?.activeSubscriptions>0?'active_callback_subscription':'ready_for_native_subscription',activeSubscriptions:summary?.activeSubscriptions??null,outbox:summary?.outbox??null,immediateDelivery:typeof ctx.waitUntil==='function',autonomousRetry:false};
    }
    const dispatch=queueAvailable?createDispatchService({store:queueStore,requests:service,enabled:true,readRegistry:async()=>{const current=readEnvironmentProjectRegistry(env);return current.status==='configured'?current.records:null;},capacity:env.DOT_BOARD_QUEUE_CAPACITY??1,clock:runtime.clock}):null;
    const response=await handleRequest(request,{readSnapshot,getAsset:path=>assets[path],config,intake:{service,capabilities,candidates,manualStatus:runtime.manualStatusFor?runtime.manualStatusFor(env):null,requirements:runtime.requirementsFor?runtime.requirementsFor(env):null,mcpEnabled:env.DOT_BOARD_INTAKE_MCP_ENABLED==='true',events:event.events,eventsEnabled:event.discoveryReady,dispatch,manualCheck:runtime.manualCheckFor?runtime.manualCheckFor(env,{requests:service,dispatch,clock:runtime.clock}):null,observations:runtime.observationsFor?await runtime.observationsFor(env,ownerId):null,taskControls:runtime.taskControlsFor?runtime.taskControlsFor(env,ownerId):null}});
    if(event.available&&event.events&&createdRequestId&&event.transportStatus?.ready&&typeof ctx.waitUntil==='function'){
      // Saving has already committed the request/event/outbox atomically. This is
      // a bounded immediate attempt, not an installed retry scheduler.
      ctx.waitUntil(event.events.drain({limit:2,budgetMs:25000,preferredEventId:createdRequestId+':created:v1'}).catch(()=>({disabled:false,reason:'event_delivery_pending'})));
    }
    return response;
  },async scheduled(_controller,env={}){
    const event=await eventRuntime(env,readEnvironmentProjectRegistry(env));return event.events?event.events.drain({limit:50}):{disabled:true};
  }};
}
