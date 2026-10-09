# 快照与 HTTP 契约

[English](data-contract.md) · [简体中文](data-contract.zh-CN.md)

## 快照版本

标准化格式为 `dot-board.snapshot/2`。仍可读取第 1 版任务快照；没有明确 Agent 记录时，返回空名单。未知版本会被拒绝。后续刷新失败时，浏览器保留上一次成功读取的数据并显示提示。

参见[完整合成示例](../examples/synthetic-snapshot.json)。

| 根字段 | 含义 |
| --- | --- |
| `schemaVersion` | 支持的数据格式标识 |
| `importedAt` | 必填的 UTC ISO 时间 |
| `source.label` | 可读的数据来源名称 |
| `source.mode` | 示例使用 `synthetic`，其他值表示报告型观察 |
| `coverage.scope` | 本次选择的数据范围说明 |
| `tasks` | 任务记录，数量受配置上限约束 |
| `agents` | 可选，必须是明确观察到的 Agent 名单 |

未知字段不会投影到浏览器响应。必填身份无效、重复身份、无效导入或循环父子关系都会使输入被拒绝。

## 任务与 Agent

任务的 `id` 和 `title` 必填，其他支持字段包括：

- `project`、`state`、`stage`、`ownerRole`：项目、状态、阶段和负责人岗位
- `observedAt`、`observation`：观察时间和说明
- `blocker`、`nextAction`、`nextOwnerRole`：阻塞、下一步和下一位负责人岗位
- `goal`、`acceptanceCriteria`、`retainedDecision`：目标、验收标准和用户保留的决定
- `evidence`：通过安全校验的 `{label, url}` 成果链接
- `verification.sourceReview`、`.deployment`、`.businessAcceptance`：审查、部署与业务验收，各自包含 `state`，可附 `note` 和 `observedAt`

Agent 的 `id` 和 `name` 必填，支持以下字段：

- `type`：`agent` 或 `subagent`
- `kind`：`coordinator`、`owner`、`worker`、`reviewer` 或 `researcher`
- `role`、`responsibility`：岗位和职责
- `parentAgentId`、`projectNames`、`taskIds`：父 Agent、项目和任务关联
- `activity`：`state`、`summary`、`observedAt`、`blocker` 和 `nextAction`
- `latestResult`：真实成果摘要、观察时间和安全证据链接
- `source`：`kind`、`label` 和 `observedAt`

状态及文案集中在 `config/board.mjs` 和 `config/agents.mjs`。缺失时间保留为 `null`，不支持的状态显示为未知。只读模型补充时效、关系状态、未解析任务数量、项目汇总和双向关联，不会根据岗位名称创建 Agent。

响应中的 `snapshotRevision` 是标准化快照及适用项目、队列上下文的 SHA-256 版本标识。`generatedAt` 是响应时间，不是观察时间。需求保留用户提交时看到的版本；之后快照发生变化，可将上下文标为过期，但不改写原需求。

## 项目注册表

`DOT_BOARD_PROJECT_REGISTRY` 使用独立的运行时 JSON：

```json
[
  {"id": "demo-alpha", "name": "Demo Alpha", "aliases": ["Alpha"]}
]
```

ID 是稳定标识，不是展示名称。项目名称和别名必须明确且不冲突，并匹配导出数据中的项目名称。最多支持 200 个项目。注册表缺失或无效时禁止提交，原有快照仍可查看。仅通过 Agent 关联观察到、尚无任务的项目也会展示。

## HTTP 路由

| 路由 | 用途 |
| --- | --- |
| `GET /` | 看板页面 |
| `GET /api/config` | 展示配置 |
| `GET /api/board` | 校验后的只读模型或安全的数据源错误 |
| `GET /health` | 服务健康与配置模式，不代表接入验收通过 |
| `GET /preview/mobile` | 同一页面的 390 像素布局检查框 |
| `GET /api/intake/capabilities` | 存储、项目注册表和需求通道能力 |
| `GET /api/projects/:projectId/requests` | 当前用户的项目需求分页 |
| `POST /api/projects/:projectId/requests` | 保存需求并返回持久化回执 |
| `GET /api/requests/:requestId` | 当前用户的需求回执与事件历史 |
| `POST /mcp` | 可选的 JSON-RPC MCP 入口 |

看板和静态资源路由支持 `HEAD`；不支持的方法返回 `405`。响应使用私有 `no-store`。未接数据源时返回 `503` 和 `no_feed`，其他数据源错误只返回安全提示，不泄露私有细节。

需求列表、详情和写入路由均要求已认证的用户身份。浏览器 POST 必须带同源 `Origin` 和 JSON 内容。MCP 使用 POST JSON-RPC，提供了 `Origin` 时也必须同源。工具读写要求桥接已经配置，并具有经过验证的用户身份。不能通过允许任意客户端自填身份头的方式开放服务。

## 需求提交与回执

`dot-board.request/1` 输入包含：

| 字段 | 要求 |
| --- | --- |
| `clientSubmissionId` | 客户端生成的固定标识，16–100 字符；原样重试时保持不变 |
| `body` | 非空原文，最多 6,000 字符 |
| `contextTaskId` | 可选，必须属于当前项目 |
| `viewedSnapshotRevision` | `/api/board` 返回的 `sha256:` 版本 |
| `viewedSnapshotImportedAt` | 所引用快照的 UTC ISO 导入时间 |
| `contextSummary` | 可选的纯文本上下文，最多 1,500 字符 |

首次保存返回 `201`，完全相同的重试返回原回执、`200` 和 `replayed: true`。同一标识对应不同内容时返回 `409`。JSON 请求体上限为 32 KiB。后续事件必须携带最新需求 `version`；版本过期时返回冲突，不覆盖已有进度。

保存后状态为 `received`。读取不会改变状态，单独确认后才变为 `read`。之后可按允许的转换进入 `accepted`、`needs_confirmation`、`declined`、`assigned`、`in_progress`、`blocked`、`completed` 或 `canceled`。分派与推进需要关联任务 ID，完成需要安全 HTTPS 证据。详见[生命周期边界](integrations.zh-CN.md)。

## MCP 工具

| 工具 | 作用 |
| --- | --- |
| `get_board_snapshot` | 读取字段白名单投影后的看板 |
| `list_request_projects` | 读取当前看板中已经配置的项目 |
| `list_project_requests` | 读取数量受限的需求分页 |
| `get_project_request` | 读取单条需求及其历史 |
| `acknowledge_project_request` | 持久化已读确认 |
| `record_project_request_event` | 持久化允许的、带版本的状态事件 |

MCP 读取既不确认已读，也不执行任务。事件写入需要幂等 `eventId` 和 `expectedVersion`，完全相同的重试可以安全回放。[可选接入](integrations.zh-CN.md)说明队列工具及实验性 Events 方法。应通过 `tools/list` 查看当前服务的输入格式，不应假定可选工具已经启用。

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

调用方提供已经获准使用的导出数据。映射函数不会建立网络连接、收集凭据、读取私有对话或控制任务。提供导入时间，也不代表补齐了缺失的观察时间。
