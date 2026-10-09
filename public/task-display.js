// Presentation only: never replaces observations, acceptance or execution controls.
export const MANUAL_STATES = {queued:'待开始',running:'进行中',blocked:'受阻',paused:'已暂停',completed:'已完成',canceled:'已取消'};
export const manualStatusOf = task => task?.manualStatus?.source === 'owner_manual' && Number.isSafeInteger(task.manualStatus.version) && task.manualStatus.version > 0 && Object.hasOwn(MANUAL_STATES, task.manualStatus.state) && (!['paused','canceled'].includes(task.state) || task.manualStatus.state === task.state) ? task.manualStatus : null;
export function taskDisplayProjection(task, states = {}) {
  const manual = manualStatusOf(task), displayState = manual?.state || task.state;
  return {displayState, displayStateView:states[displayState] || task.stateView, manualCompleted:manual?.state === 'completed'};
}
