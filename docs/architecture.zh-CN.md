# 架构说明

[English](architecture.md) · [简体中文](architecture.zh-CN.md)

```text
宿主明确导出
       |
       v
快照适配 / 可选 Workbench 映射
       |
       v
领域校验与字段白名单
       |
       v
应用层只读模型
       |
       v
只读 HTTP 适配 -> 浏览器展示
```

## 职责边界

- 外部宿主负责执行、审批和任务持久化
- 领域层校验快照和已观察到的 Agent 关系
- 应用层计算展示计数、关联关系和观察时效
- HTTP 适配器提供数据与静态资源，不调度任务
- 浏览器负责本地选择、筛选和详情展开

`server.mjs` 与 `worker.mjs` 共用应用层和 HTTP 函数。`scripts/build.mjs` 根据明确的模块列表生成轻量 Worker 包，不将运行时快照嵌入构建产物。

## 关系语义

`parentAgentId` 必须来自真实的关系记录，`projectNames` 只负责项目分组。一个项目可以有多个协作 Agent，也可能没有出现在本次名单中的 Agent。自由填写的任务岗位不会自动变成 Agent 身份。

同一个 Agent 可以完成一项交付后，又开始另一项任务。当前活动与最近成果分开记录；任务执行、代码审查、交付和业务验收也分别表示。

## 时间与覆盖范围

观察时间属于来源记录。导入时间表示快照何时整理，请求时间表示它何时被读取。刷新不能重写观察时间。

计数仅说明本次导入的已知范围。未知覆盖范围不能变成全局总数。旧的运行记录会变为待核实，不会自动算作完成或持续运行。

## 兼容性

可选的 Workbench 映射接受 `id`、`title`、`projectId`、`businessStageId`、`executionState`、`acceptanceStatus` 等导出字段。它不调用 Workbench 的界面状态库或执行引擎，也不连接正在运行的 Workbench 实例。
