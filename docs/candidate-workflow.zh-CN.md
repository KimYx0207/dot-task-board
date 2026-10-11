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

普通数据迁移只追加候选与审批记录，不修改旧执行表。批准时把审批、需求和首次保存回执放在同一事务中。Sites 直接 Events 开启且存储可用时，同一事务还写入仅含标识的 `project_request.created` 事件和匹配的发件箱条目；任一失败都会回滚整次批准。默认通用/未开启直接 Events 的候选路径仍不写 Events。版本冲突先重读，响应不明先查已存回执，不能据此再建需求或发送原生任务。批准不写派发队列、执行授权、权限或任务绑定，也不执行需求。

## 先检查原任务，再领取执行

会话客户端提供两种检查：

- `inspectDotSessionCapabilities(...)`：不调用工具，列出缺少的实际工具及宿主核验函数。工具存在不代表已经获准执行。
- `client.inspectContinuation({requestId})`：读取已有的指定排队需求、原绑定、撤回决定和原会话，由实际宿主核对任务范围与是否有在途写入，不领取、不更新、不发送。

正向检查结果仅代表接续证据已经核对，准入、当前控制、TTL 与容量仍由原领取及执行前检查处理。真正 `dispatchNext` 仍重新检查，保存本次派发意图后只向原会话发送一次。结果不明时保留占位，等待核对。详见[完整客户端契约](dot-session-dispatch-client.md)。

公开源码尚未提供 `get_request_withdrawal_state`，客户端要求实际宿主提供这一认证读取能力，以及真实核验函数。缺少撤回证据时停止，不能返回虚构的 `false` 让流程继续。

## 事件接入

[官方 MCP Events 文档](https://developers.openai.com/plugins/build/mcp-events)规定通过认证发现与订阅、HTTPS 回调校验及签名 webhook 投递。收到通知和实际执行是不同步骤，页面刷新也不是事件推送。

Sites 入口现已将所有者认证的 Events 发现与直接传输就绪分开。候选保存可独立使用；直接订阅/投递要求开关启用、持久存储可用，以及独立核实的运行时、路由和精确 origin 策略。启用后的 Sites 批准可通过 `ctx.waitUntil` 即时尝试最多两次回调，总预算 25 秒、每次 10 秒；不新增调度器、自主重试、轮询或执行。目录与 `2xx` 回执都不能证明原生聊天唤醒。宣称线上链路成立前，须核对用户实际批准的订阅、精确 origin 所有权、运行时/zone 证据、challenge、持久化、真实到达/聊天唤醒及获准结果回执；原会话派发仍需单独授权和证据。详见 [Sites 直接 Events](sites-direct-events.md)。

## 公开参考与自主实现

[Yoshio 的任务流程](https://x.com/yoshio_nocode/status/2108111375704695191)把任务填写、执行、成果确认和同会话追加分开，公开演示也区分候选批准与开工。本项目自主实现这些交互思路，不包含其私有提示词、领取材料、代码或个人截图。文档界面图使用本项目明确标注的合成示例。
