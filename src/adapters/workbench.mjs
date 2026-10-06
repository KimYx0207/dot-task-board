import {SCHEMA_VERSION, safeText, timestamp} from '../domain/snapshot.mjs';
// Pure mapping of explicitly exported Workbench 0.5.0 GET /api/tasks DTOs.
// This adapter does not contact Workbench or acquire native-host access.
const states = {idle:'queued',queued:'queued',running:'running',waiting_human:'waiting',blocked:'blocked',failed:'blocked',completed:'completed',canceled:'canceled'};
export function fromWorkbenchExport(dto,{importedAt,observedAt=null,projectLabels={},stageLabels={}}={}) {
  if (!dto || !Array.isArray(dto.tasks)) throw new Error('Unsupported Workbench task export');
  const tasks = dto.tasks.map(task=>({
    id:task.id,title:task.title,project:projectLabels[task.projectId] ?? task.projectId ?? '未分类',
    state:states[task.executionState] ?? 'unknown',
    stage:stageLabels[task.businessStageId] ?? task.businessStageId ?? '阶段未记录',
    ownerRole:safeText(task.assignee,80), observedAt:timestamp(observedAt),
    observation:'Workbench 导出记录；执行完成不等于业务验收',
    nextAction:safeText(task.nextAction,400), blocker:safeText(task.blocker,400), evidence:[],
    verification:{sourceReview:{state:'unknown'},deployment:{state:'unknown'},businessAcceptance:{state:task.acceptanceStatus==='passed'?'passed':'pending'}}
  }));
  return {schemaVersion:SCHEMA_VERSION,importedAt,source:{label:'Workbench 手动导出',mode:'reported'},
    coverage:{scope:dto.taskPage?.hasMore?'导出的部分分页，仍有未加载记录':'仅本次导出的任务，未声明全局覆盖'},tasks};
}
