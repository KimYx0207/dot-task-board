import {IntakeError} from '../domain/intake.mjs';
export function readObservationBindings(env){
 let raw=env.DOT_BOARD_OBSERVATION_BINDINGS;
 if(!raw&&env.DOT_BOARD_OBSERVATION_BINDINGS_PARTS){const n=Number(env.DOT_BOARD_OBSERVATION_BINDINGS_PARTS);if(!Number.isSafeInteger(n)||n<1||n>32)throw new IntakeError('invalid_observation_bindings',503);const parts=Array.from({length:n},(_,i)=>env['DOT_BOARD_OBSERVATION_BINDINGS_'+i]);if(parts.some(x=>typeof x!=='string'))throw new IntakeError('invalid_observation_bindings',503);raw=parts.join('');}
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>100000)throw new IntakeError('observation_bindings_unavailable',503);
 let value;try{value=JSON.parse(raw);}catch{throw new IntakeError('invalid_observation_bindings',503);}
 if(!Array.isArray(value)||value.length>200||new Set(value.map(x=>x?.taskId)).size!==value.length)throw new IntakeError('invalid_observation_bindings',503);
 return value;
}
