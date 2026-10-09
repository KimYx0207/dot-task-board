import {IntakeError} from '../domain/intake.mjs';
const requirementMcpId={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$'};
export const taskRequirementsMcpTools=[
 {name:'get_task_requirements',description:'Read the current owner’s goal and acceptance-criteria notes for one existing task, with per-field source references and an independent version. Does not establish an execution binding or authorization.',inputSchema:{type:'object',additionalProperties:false,properties:{taskId:requirementMcpId},required:['taskId']},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 {name:'record_task_requirements',description:'Incrementally record source-backed goal and acceptanceCriteria text for one existing owner task. The host must verify the cited user instructions. Preserves task identity, thread binding, observed state, manual decisions, controls, queue and reservations. Requirement text never grants execution permission. Uses expected version and an idempotent event ID; does not create requests or tasks.',inputSchema:{type:'object',additionalProperties:false,properties:{taskId:requirementMcpId,eventId:requirementMcpId,expectedVersion:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER-1},changes:{type:'object',additionalProperties:false,minProperties:1,properties:{goal:{type:'string',maxLength:400},acceptanceCriteria:{type:'string',maxLength:400}}},sourceReferences:{type:'array',minItems:1,maxItems:5,uniqueItems:true,items:{type:'string',minLength:1,maxLength:200}}},required:['taskId','eventId','expectedVersion','changes','sourceReferences']},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}}
];
export async function callTaskRequirementsTool(service,owner,name,args){
 if(name==='get_task_requirements'){if(!args||typeof args.taskId!=='string'||Object.keys(args).some(key=>key!=='taskId'))throw new IntakeError('invalid_arguments');return service.get(owner,args.taskId);}
 if(name==='record_task_requirements')return service.set(owner,args);
 throw new IntakeError('invalid_arguments');
}
