import {parentPort,workerData} from 'node:worker_threads';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {createD1DispatchQueue} from '../src/adapters/d1-dispatch-queue.mjs';
import {createDispatchService} from '../src/application/dispatch-service.mjs';
const db=sqliteIntakeFixture(workerData.filename);
db.db.exec('PRAGMA busy_timeout=10000');
const store=createD1DispatchQueue(db.binding);
const gate=new Int32Array(workerData.gate);
parentPort.postMessage({ready:true});
Atomics.wait(gate,0,0);
const output=[];
try {
 for(let i=0;i<workerData.count;i++){
  const eventId=workerData.sharedEvent??`claim-${workerData.id}-${i}`;
  const service=createDispatchService({store,requests:{},enabled:true,capacity:6,newId:()=>`key-${workerData.id}-${i}`});
  const result=await service.claim('owner',{eventId});
  output.push({eventId,id:result.job?.id??null,replayed:result.replayed});
 }
 parentPort.postMessage({output});
} catch(error) {parentPort.postMessage({error:{message:error.message,code:error.code}});}
finally {db.close();}
