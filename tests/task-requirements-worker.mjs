import {parentPort,workerData} from 'node:worker_threads';
import {sqliteIntakeFixture} from './sqlite-intake-fixture.mjs';
import {createD1TaskRequirementsStore} from '../src/adapters/d1-task-requirements.mjs';
import {createTaskRequirementsService} from '../src/application/task-requirements-service.mjs';
const f=sqliteIntakeFixture(workerData.filename);f.db.exec('PRAGMA busy_timeout=10000');
const service=createTaskRequirementsService({store:createD1TaskRequirementsStore(f.binding),ownerId:'owner-a',readSnapshot:()=>workerData.snapshot,clock:()=>workerData.now});
parentPort.postMessage({ready:true});parentPort.once('message',async()=>{try{parentPort.postMessage({ok:true,result:await service.set('owner-a',workerData.input)});}catch(error){parentPort.postMessage({ok:false,code:error.code});}finally{f.close();parentPort.close();}});
