export const agentStates = Object.freeze({
  running:{label:'正在执行',tone:'blue'},
  waiting:{label:'等待回报 / 决定',tone:'amber'},
  blocked:{label:'受阻',tone:'red'},
  paused:{label:'暂停',tone:'slate'},
  idle:{label:'未在执行',tone:'slate'},
  completed:{label:'本轮已交付',tone:'green'},
  unknown:{label:'活动未核实',tone:'slate'}
});
