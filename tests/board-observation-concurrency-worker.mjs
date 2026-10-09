import {parentPort,workerData} from 'node:worker_threads';
import {createD1BoardObservationStore} from '../src/adapters/d1-board-observations.mjs';
import {createBoardObservationService} from '../src/application/board-observation-service.mjs';
import {createD1BoardObservationOutbox} from '../src/adapters/d1-board-observation-outbox.mjs';
import {sqliteBoardObservationFixture} from './sqlite-board-observation-fixture.mjs';
const fixture=sqliteBoardObservationFixture(workerData.filename);
const clock=()=>workerData.now;
const observationOutbox=workerData.outbox?createD1BoardObservationOutbox(fixture.binding,{clock}):null;
const service=createBoardObservationService({store:createD1BoardObservationStore(fixture.binding,{clock,observationOutbox}),clock});
parentPort.postMessage({ready:true});
parentPort.once('message',async()=>{
  if(workerData.crashDuringBatch)fixture.binding.batch=async statements=>{fixture.db.exec('BEGIN IMMEDIATE');statements[0].execute();parentPort.postMessage({uncommittedJournal:true});process.exit(77);};
  try{const receipt=await service.record(workerData.owner,workerData.input,workerData.snapshot,workerData.bindings,workerData.registry);parentPort.postMessage({ok:true,version:receipt.version,duplicate:receipt.duplicate});}
  catch(error){parentPort.postMessage({ok:false,code:error.code,message:error.message});}
  finally{fixture.close();parentPort.close();}
});
