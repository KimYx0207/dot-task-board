# 候选审批与原任务接续

[English](candidate-workflow.md) · [简体中文](candidate-workflow.zh-CN.md)

## 使用流程

1. 把建议存入候选区，附所属项目、来源、推荐理由和预期成果，需要时填写截止时间与领域。来源是判断材料，不是执行命令。
2. 看完后选择**批准并保存需求**或**暂不采用**，可写判断备注。批准会保存一条待读取需求，并保留它与候选的关系。
3. dot 通过已有认证需求接口读取。受理、选择有权使用的执行环境、真正派发分别记录。
4. 在任务和成果区查看进展。追加要求继续关联原任务，完成状态依据本次实际交付范围。

## 持久接口

- `GET /api/candidates`：读取当前所有者的候选，支持分页和按客户端提交标识查回执。
- `POST /api/candidates`：用 `clientSubmissionId` 保存有来源的候选。
- `GET /api/candidates/:id`：读取候选及已关联的需求。
- `POST /api/candidates/:id/review`：提交 `eventId`、`expectedVersion`、`decision`（`approve` 或 `reject`）及 `note`。
- MCP 工具：`list_candidates`、`get_candidate`、`propose_candidate`、`review_candidate`。

本次仅追加普通候选与审批数据表，不修改旧执行表。批准时把审批、需求和首次保存回执放在同一事务中。版本冲突先重读，响应不明先查已存回执。候选批准不会写入派发队列、事件投递、权限或任务绑定。

## 先检查原任务，再领取执行

会话客户端提供两种检查：

- `inspectDotSessionCapabilities(...)`：不调用工具，列出缺少的实际工具及宿主核验函数。工具存在不代表已经获准执行。
- `client.inspectContinuation({requestId})`：读取已有的指定排队需求、原绑定、撤回决定和原会话，由实际宿主核对任务范围与是否有在途写入，不领取、不更新、不发送。

正向检查结果仅代表接续证据已经核对，准入、当前控制、TTL 与容量仍由原领取及执行前检查处理。真正 `dispatchNext` 仍重新检查，保存本次派发意图后只向原会话发送一次。结果不明时保留占位，等待核对。详见[完整客户端契约](dot-session-dispatch-client.md)。

公开源码尚未提供 `get_request_withdrawal_state`，客户端要求实际宿主提供这一认证读取能力，以及真实核验函数。缺少撤回证据时停止，不能返回虚构的 `false` 让流程继续。

## 事件接入

[官方 MCP Events 文档](https://developers.openai.com/plugins/build/mcp-events)规定通过认证发现与订阅、HTTPS 回调校验及签名 webhook 投递。收到通知和实际执行是不同步骤，页面刷新也不是事件推送。

仓库已有通用 webhook 实现，标准 Sites 入口仍关闭直接投递，需先具备受支持回调传输与可信宿主连接。候选保存可独立使用。每个部署应实际核对订阅、唤醒、原会话派发和结果回执，再描述该完整链路。

## 公开参考与自主实现

[Yoshio 的任务流程](https://x.com/yoshio_nocode/status/2108111375704695191)把任务填写、执行、成果确认和同会话追加分开，公开演示也区分候选批准与开工。本项目自主实现这些交互思路，不包含其私有提示词、领取材料、代码或个人截图。文档界面图使用本项目明确标注的合成示例。
