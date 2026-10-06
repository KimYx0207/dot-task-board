# 快照与 HTTP 契约

[English](data-contract.md) · [简体中文](data-contract.zh-CN.md)

## 版本

标准化后的数据格式为 `dot-board.snapshot/2`。仍可读取第 1 版任务快照；没有明确的 Agent 记录时，返回空名单。未知版本会被拒绝。后续刷新失败时，浏览器保留上一次成功读取的内容。

参见[完整合成示例](../examples/synthetic-snapshot.json)。

## 根字段

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 支持的数据格式标识 |
| `importedAt` | 必填的 UTC ISO 时间 |
| `source.label` | 人能理解的数据来源名称 |
| `source.mode` | 示例使用 `synthetic`，其他值表示报告型观察 |
| `coverage.scope` | 用人话说明本次选择的数据范围 |
| `tasks` | 任务数组，数量受配置上限约束 |
| `agents` | 可选，必须是明确观察到的 Agent 名单 |

未知字段不会投影到浏览器响应中。任务必填标识无效、重复身份、无效导入或循环父子关系都会使输入被拒绝。

## 任务

`id` 和 `title` 必填，其他支持字段包括：

- `project`、`state`、`stage`、`ownerRole`：项目、状态、阶段和负责人岗位
- `observedAt`、`observation`：观察时间和说明
- `blocker`、`nextAction`、`nextOwnerRole`：阻塞、下一步和下一位负责人岗位
- `goal`、`acceptanceCriteria`、`retainedDecision`：目标、验收标准和用户保留的决定
- `evidence`：通过安全校验的 `{label, url}` 成果链接
- `verification.sourceReview`、`.deployment`、`.businessAcceptance`：审查、部署和业务验收，各自包含 `state`，可附 `note` 和 `observedAt`

任务状态和验收标签集中在 `config/board.mjs`。缺失时间保留为 `null`，不支持的状态显示为未知。

## Agent

`id` 和 `name` 必填，支持以下字段：

- `type`：`agent` 或 `subagent`
- `kind`：`coordinator`、`owner`、`worker`、`reviewer` 或 `researcher`
- `role`、`responsibility`：角色和职责
- `parentAgentId`、`projectNames`、`taskIds`：父 Agent、关联项目和任务
- `activity`：状态、摘要、观察时间、阻塞原因和下一步
- `latestResult`：真实成果摘要、观察时间和安全证据链接
- `source`：来源类型、名称和观察时间

只读模型补充时效、关系状态、未解析任务数量和双向任务关联，不会根据岗位名称创建角色。协调者与实际执行者分开计数。

## HTTP 接口

| 路由 | 响应 |
| --- | --- |
| `GET /` | 看板页面 |
| `GET /api/config` | 展示配置 |
| `GET /api/board` | 校验后的第 2 版只读模型，或安全的数据源错误 |
| `GET /health` | 服务健康与只读模式 |
| `GET /preview/mobile` | 将同一页面放入 390 像素宽的布局检查框 |

支持 `HEAD`。其他方法返回 `405`，未知路径返回 `404`。响应使用 `no-store`。未接数据源时返回 `503` 和 `no_feed`；数据源无效或不可用时仅返回安全错误码，不泄露私有细节。

## Workbench 导出映射

```js
import {fromWorkbenchExport} from './src/adapters/workbench.mjs';

const snapshot = fromWorkbenchExport(exportedTaskDto, {
  importedAt: new Date().toISOString(),
  observedAt: null,
  projectLabels: {},
  stageLabels: {}
});
```

调用方提供已经获准使用的导出数据。该函数不会建立网络连接、收集凭据、读取私有对话或控制任务。
