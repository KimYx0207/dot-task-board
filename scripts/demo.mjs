import {readFile} from 'node:fs/promises';
import {createBoardServer} from '../server.mjs';

const snapshot=JSON.parse(await readFile(new URL('../examples/synthetic-snapshot.json',import.meta.url),'utf8'));
const now=new Date().toISOString();
// Freshen only the explicitly synthetic demo. Imported real observations are never reset.
snapshot.importedAt=now;
for(const task of snapshot.tasks)if(task.observedAt)task.observedAt=now;
for(const agent of snapshot.agents){agent.source.observedAt=now;if(agent.activity.observedAt)agent.activity.observedAt=now;if(agent.latestResult?.observedAt)agent.latestResult.observedAt=now;}
const port=Number(process.env.DOT_BOARD_PORT||4317);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid port');
createBoardServer({env:{DOT_BOARD_SNAPSHOT:JSON.stringify(snapshot)}}).listen(port,'127.0.0.1',()=>{
  console.log(`Synthetic demo only: http://127.0.0.1:${port}`);
  console.log('No native agent connection, private task data or background execution');
});
