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
