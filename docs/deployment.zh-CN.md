# 部署说明

[English](deployment.md) · [简体中文](deployment.zh-CN.md)

本项目的主要在线形态请先阅读[部署自己的在线 Site](sites-deployment.zh-CN.md)，其中明确了 Sites 专用入口、完整表结构、所有者身份和私有部署产物。下文是可选替代运行模式；通用 Worker 不能替代完整的私有 Sites 适配器。

## 选择运行模式

| 模式 | 要求 | 能力 |
| --- | --- | --- |
| 本地快照 | Node.js 24+ 与导出快照 | 在本机环回地址展示观察记录 |
| 合成示例 | Node.js 24+ | 虚构项目、临时 SQLite 回执与队列状态检查，不执行真实任务 |
| 认证需求通道 | 持久化存储、项目注册表与已验证身份 | 保存需求，以及带版本的已读、推进回执 |
| Worker 与 D1 | 单独配置的 Worker 宿主和 `DB` 绑定 | 运行相同看板，可选择持久化需求 |
| 队列 / Events 实验 | 明确启用，并提供所需存储和宿主接入 | 记录排队意图，或通过注入的传输实现投递事件 |

运行、测试和构建本仓库都不需要安装 npm 依赖。托管平台 CLI 与账号配置属于单独步骤。交给 Agent 安装时，可参考 [INSTALL.zh-CN.md](../INSTALL.zh-CN.md)。

## 本地快照服务

`npm start` 只监听 `127.0.0.1`。使用 `DOT_BOARD_SNAPSHOT_PATH` 指向仓库之外的快照，或在服务端通过 `DOT_BOARD_SNAPSHOT` 提供 JSON 字符串。程序不会自动加载 `.env` 文件。`DOT_BOARD_PORT` 可修改默认端口 `4317`。

```sh
DOT_BOARD_SNAPSHOT_PATH=/absolute/path/outside-repo/snapshot.json npm start
```

未配置输入时返回 `no_feed`，不会替换为虚构活动。本地 Node 会剥离调用方提交的身份头；自定义需求接入必须通过服务端认证回调提供经过验证的身份。

保留本地环回限制，不要移除 Host 校验或直接向公网开放。需要远程访问时，应将整个应用置于经过验证的认证与授权边界内。

## 持久化本地安装

按 [INSTALL.zh-CN.md](../INSTALL.zh-CN.md) 使用 `install`、`start`、`status` 和 `stop`。这些命令在独立安装目录中保留源码版本，将 SQLite 数据放在其 `data/` 目录。受管理的演示在重启后保留存储；直接运行 `npm run demo` 时，未另行配置则每次使用新的临时目录。

本地需求服务为环回客户端提供统一用户身份，不是托管认证。持久化本地应用在看板和接口请求时重读外部快照，保留来源观察时间。注册表在启动时载入，变更后需要重新启动。纯快照模式的 `npm start` 也会在看板请求时重读快照文件。

## Worker 构建

```sh
npm run build
node --check dist/server/index.js
```

该命令生成 ESM Worker `dist/server/index.js`，导出请求处理和可选的定时事件处理入口，包含应用代码与静态资源。构建不会执行部署，也不会嵌入运行数据或凭据。

快照通过以下任一方式提供：

- `DOT_BOARD_SNAPSHOT`：完整 JSON 字符串
- `DOT_BOARD_SNAPSHOT_PARTS`：分块数量，配合 `DOT_BOARD_SNAPSHOT_0` 至最后一个分块

分块用于应对单值传输限制，不是加密。敏感运行数据应通过宿主支持的秘密值机制保存。真实快照和托管项目身份不能提交到仓库。

## 可选 D1 存储

持久化需求的 Worker 需要将兼容 D1 的数据库绑定为 `DB`。对本次安装选定的数据库应用仓库中的 SQL：

1. [0000_project_intake.sql](../migrations/0000_project_intake.sql) 创建需求和回执事件存储
2. [0001_events_dispatch.sql](../migrations/0001_events_dispatch.sql) 添加实验性队列和 Events 存储

这些功能还需要完整普通 SQL/本地链中的 `0002_execution_evidence.sql`、`0003_dispatch_guards.sql`、`0004_native_dispatch_journal.sql`、`0005_board_observations.sql`、`0006_board_observation_outbox.sql`、`0007_dispatch_manual_authorizations.sql`、`0008_manual_task_status.sql`。Sites 应使用[在线指南](sites-deployment.zh-CN.md)中的独立完整 Drizzle 链，不能将两条链重复应用到同一数据库。

使用宿主官方支持的迁移工具，确认实际修改的数据库，升级前备份已有数据。仓库已经包含普通 SQL，运行时不需要模式生成器。缺少表会关闭对应能力；不能仅凭健康检查就宣称需求通道已经可用。

普通 Worker 部署需要自行配置绑定、路由和访问控制。其他宿主的私有站点标记并不是通用 Worker 认证机制。公开源码不包含私有部署的配置、网址、项目 ID 或运行数据。

## 运行时配置

以下布尔开关仅在字符串严格等于 `true` 时生效；可选开关缺省保持关闭。

| 变量 | 用途 |
| --- | --- |
| `DOT_BOARD_PROJECT_REGISTRY` | 固定项目 ID、名称和别名的 JSON 数组 |
| `DOT_BOARD_INTAKE_ENABLED` | 操作者启用需求通道 |
| `DOT_BOARD_INTAKE_MCP_ENABLED` | 操作者启用认证 MCP 桥接 |
| `DOT_BOARD_INTAKE_CONNECTION_VERIFIED` | 操作者确认已测试客户端连接 |
| `DOT_BOARD_INTAKE_READER_VERIFIED` | 操作者确认已验证读取与已读链路 |
| `DOT_BOARD_INTAKE_WRITER_VERIFIED` | 操作者确认已验证进展事件写入 |
| `DOT_BOARD_INTAKE_POLL_MINUTES` | 可选的界面轮询间隔说明，不创建调度器 |
| `DOT_BOARD_QUEUE_ENABLED` | 表存在时启用实验性队列 |
| `DOT_BOARD_QUEUE_CAPACITY` | 每位用户的预留名额上限，默认 1，范围 1–32 |
| `DOT_BOARD_EVENTS_ENABLED` | 表存在时启用实验性 Events |

需求提交要求需求通道启用、存储可用、有效且非空的项目注册表、桥接启用和连接已经验证。读取、写入验证还会影响就绪状态说明。配置只能声明验证结果，不能代替验证。设置已验证标记前，应检查 `/api/intake/capabilities` 并实际运行认证后的完整流程。

## 认证边界

Worker 不提供登录系统，也不会自动验证任意传入的身份头。宿主必须认证请求、移除客户端伪造的身份头，再注入经过验证的用户 ID。整个页面、`/api/board`、需求路由和 `/mcp` 都应受保护；不能在受保护入口之外另外开放无认证的 Worker 入口。

需求记录按用户隔离，快照则属于整个部署，因此它不是自动实现多租户隔离的快照服务。每个部署的快照应只面向获准的同一受众；若需要按用户区分快照，应另行实现并审查数据源。

浏览器提交要求同源 JSON 请求，这不能替代认证。隐藏网址、界面的私密标记或健康检查成功都不是访问控制。

## 刷新、事件与验证

刷新会重读已有记录，不更新观察时间。导出或轮询服务需要单独配置。Events 还需要获准的、固定解析地址的传输实现，以及明确配置的定时处理。本仓库不附带 Cloudflare 回调适配器或原生任务调度器。

接入私有记录前，应使用合成数据验证未登录访问被拒绝、用户隔离、保存与重试、读取与事件写入，以及所选宿主的实际行为。390 像素预览框是布局检查，不是真实手机测试。真实设备和线上接入须分别验收后才能宣称通过。平台限制和费用取决于账号与配置，本项目不承诺免费托管或特定吞吐量。
