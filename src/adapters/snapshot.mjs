import {SnapshotError} from '../domain/snapshot.mjs';
export function parseSnapshot(value) {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > 250000) throw new SnapshotError('invalid_snapshot_size');
  try { return JSON.parse(value); } catch { throw new SnapshotError('invalid_json'); }
}
export function readEnvironmentSnapshot(env) {
  const raw = env.DOT_BOARD_SNAPSHOT;
  if (raw) return parseSnapshot(raw);
  if (!env.DOT_BOARD_SNAPSHOT_PARTS) return null;
  const count = Number(env.DOT_BOARD_SNAPSHOT_PARTS);
  if (!Number.isInteger(count) || count < 1 || count > 64) throw new SnapshotError('invalid_snapshot_parts');
  const parts = Array.from({length:count},(_,i)=>env[`DOT_BOARD_SNAPSHOT_${i}`]);
  if (parts.some(p=>typeof p !== 'string')) throw new SnapshotError('missing_snapshot_part');
  return parseSnapshot(parts.join(''));
}

export function readEnvironmentTaskStatusOverlay(env={}) {
  let value=env.DOT_BOARD_TASK_STATUS_OVERLAY;
  if(value===undefined||value===null||value===''){
    if(!env.DOT_BOARD_TASK_STATUS_OVERLAY_PARTS)return null;
    const count=Number(env.DOT_BOARD_TASK_STATUS_OVERLAY_PARTS);
    if(!Number.isInteger(count)||count<1||count>12)throw new SnapshotError('invalid_status_overlay');
    const parts=Array.from({length:count},(_,i)=>env[`DOT_BOARD_TASK_STATUS_OVERLAY_${i}`]);
    if(parts.some(part=>typeof part!=='string'))throw new SnapshotError('invalid_status_overlay');
    value=parts.join('');
  }
  if(typeof value!=='string'||new TextEncoder().encode(value).byteLength>32768)throw new SnapshotError('invalid_status_overlay');
  try{return JSON.parse(value);}catch{throw new SnapshotError('invalid_status_overlay');}
}
