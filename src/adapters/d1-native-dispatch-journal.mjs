// Restart-safe at-most-one write attempt for a dispatch operation. Native tools
// have no idempotency-key argument: uncertain entries may never be auto-deleted.
export function createD1NativeDispatchJournal(db,{clock=()=>new Date().toISOString()}={}){
 if(!db?.prepare)throw Error('A durable D1-compatible database is required');
 const get=async key=>{const row=await db.prepare('SELECT * FROM native_dispatch_journal WHERE owner_id=? AND operation_id=?').bind(key.ownerId,key.operationId).first();return row?{key:JSON.parse(row.binding_json),state:row.state,receipt:row.receipt_json?JSON.parse(row.receipt_json):null}:null;};
 return {get,async reserve(key){const now=clock();const r=await db.prepare("INSERT INTO native_dispatch_journal(owner_id,operation_id,binding_json,state,created_at,updated_at) VALUES (?,?,?,'reserved',?,?) ON CONFLICT(owner_id,operation_id) DO NOTHING").bind(key.ownerId,key.operationId,JSON.stringify(key),now,now).run();if(![0,1].includes(r?.meta?.changes))throw Error('Uncertain durable reservation; do not invoke native tool');return {acquired:r.meta.changes===1,record:await get(key)};},async save(key,patch){
  if(!['admitted','uncertain'].includes(patch.state))throw Error('Invalid native journal state');
  const r=await db.prepare('UPDATE native_dispatch_journal SET state=?,receipt_json=COALESCE(?,receipt_json),updated_at=? WHERE owner_id=? AND operation_id=? AND binding_json=?').bind(patch.state,patch.receipt?JSON.stringify(patch.receipt):null,clock(),key.ownerId,key.operationId,JSON.stringify(key)).run();if(r?.meta?.changes!==1)throw Error('Native journal binding changed or write unverified');
 }};
}
