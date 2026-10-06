import {agentStates} from './agents.mjs';
export const boardConfig = Object.freeze({
  title: 'dot 任务看板',
  staleAfterMinutes: 120,
  maxTasks: 200,
  maxAgents: 100,
  agentStates,
  states: {
    running: {label:'推进中', tone:'blue', order:0},
    reviewing: {label:'复检中', tone:'blue', order:1},
    waiting: {label:'待确认', tone:'amber', order:2},
    blocked: {label:'受阻', tone:'red', order:3},
    partial: {label:'部分完成', tone:'amber', order:4},
    paused: {label:'已暂停', tone:'slate', order:5},
    queued: {label:'待开始', tone:'slate', order:6},
    completed: {label:'已完成', tone:'green', order:7},
    canceled: {label:'已取消', tone:'slate', order:8},
    unknown: {label:'待核实', tone:'slate', order:9}
  },
  verification: {
    passed:'通过', scoped_pass:'限定范围通过', pending:'待确认',
    failed:'未通过', not_started:'未开始', not_applicable:'不适用', unknown:'未核实'
  },
  text: {
    all:'全部', allProjects:'全部项目', search:'搜索任务或下一步', refresh:'重读快照',
    loading:'正在读取状态快照…', empty:'没有符合条件的任务', emptyHint:'试试其他状态或清空搜索',
    private:'仅自己可见', readOnly:'只读', snapshot:'状态快照',
    noFeed:'尚未接入状态快照', noFeedHint:'需要由宿主导出选定任务，再导入此看板',
    loadFailed:'暂时无法读取快照', retained:'保留上次成功读取的内容，当前连接不可用',
    schemaError:'快照格式暂不受支持，请更新导入数据',
    sourceReview:'源码 / 资料检查', deployment:'部署 / 交付', acceptance:'业务验收',
    evidence:'证据与验收', next:'下一步', blocker:'停在这里的原因', nextOwner:'下一步负责人',
    owner:'当前角色', noOwner:'角色未记录', observation:'最近观察', noObservation:'观察时间未记录',
    stale:'观察已过期', future:'观察时钟异常', goal:'目标', criteria:'完成标准', decisions:'留给你的决定',
    noLinks:'尚未附可打开的证据链接', countSuffix:'项已选事项',
    subset:'这是已确认的选定任务子集，不代表所有项目',
    reported:'由宿主汇总导入；重读快照不会更新任务的观察时间',
    demo:'演示数据', result:'查看结果', lastRead:'本次读取', imported:'快照导入',
    timeline:'状态说明', pausedNote:'保持暂停；此页面不会启动或恢复任务'
  }
});
