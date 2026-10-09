import {safeText} from '../domain/snapshot.mjs';
import {intakeProjectRegistry} from '../domain/intake.mjs';
// This configuration is independent of task-snapshot exports. No write or fallback
// into snapshot secrets is performed, and an invalid registry never hides the board.
export function readEnvironmentProjectRegistry(env={}) {
  const value=env.DOT_BOARD_PROJECT_REGISTRY;
  if(value===undefined||value===null||value==='')return {status:'absent',records:[]};
  if(typeof value!=='string'||new TextEncoder().encode(value).byteLength>65536)return {status:'invalid',records:[]};
  try{
    const records=intakeProjectRegistry(JSON.parse(value));
    // Reject rather than rewrite labels, avoiding leaks or collisions after sanitizing.
    const labels=records.flatMap(record=>[record.name,...record.aliases]);
    if(labels.some(label=>safeText(label,100)!==label||/__external_/i.test(label)))return {status:'invalid',records:[]};
    return {status:'configured',records};
  }
  catch{return {status:'invalid',records:[]};}
}
export function withIndependentProjectRegistry(snapshot,registry) {
  if(!snapshot)return null;
  return {...snapshot,projectRegistry:registry.records};
}
export function gateIntakeByProjectRegistry(capabilities,registry) {
  const registryAvailable=registry.status==='configured'&&registry.records.length>0;
  return {...capabilities,registryStatus:registry.status,registryAvailable,canSubmit:capabilities.canSubmit&&registryAvailable,enabled:capabilities.enabled&&registryAvailable};
}
