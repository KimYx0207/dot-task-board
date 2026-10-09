# 部署自己的在线 Site

[English](sites-deployment.md) · [简体中文](sites-deployment.zh-CN.md)

本项目的主要使用形态是所有者私有的在线 Sites 看板。使用者在浏览器打开已部署网址，无需在自己电脑安装 Node.js。本仓库提供该看板的应用源码，包含当前手动状态展示改动；本机示例仅用于可选预览与开发。

## 哪些部分能够复现

| 部分 | 仓库包含 | 新安装需要自行提供 |
| --- | --- | --- |
| 项目/任务/Agent 界面、搜索、筛选、历史和证据 | 界面源码与资源 | 符合数据契约的快照 |
| 手动任务状态与备注 | 私有 Sites 服务、D1 存储与界面 | 新站身份边界、项目注册表和数据库 |
| 需求、已读/推进回执、队列和观察记录 | 服务、HTTP/MCP 路由与完整表结构 | 自己的运行配置、获准调用方和原任务绑定 |
| 私有在线托管和登录 | Sites 专用应用适配器 | Sites 平台权限、私有访问策略、可信身份注入和 D1 |
| 原生任务执行和续跑 | 适配器接口与合成测试 | 已授权的真实执行宿主；实际端到端链路未完成验收 |
| 原站真实任务、身份、线程绑定和数据库行 | 不包含 | 安装者自己的数据，不能照搬他人的部署 |

Sites 托管、登录和工具能力属于平台服务，不是本仓库可开源的组成部分。克隆源码不会获得这些服务，也不会创建 Site。如果账号不能创建带 D1 与 MCP 的 Sites 应用，该账号就不能直接使用这条在线部署路径。通用 Worker 需要另行审查身份接入，不能只改一个环境变量便宣称功能等价。

## 1. 准备自己的私有 Site

通过账号支持的 Sites 创建/部署流程建立新的“仅所有者可访问”项目，配置逻辑 D1 绑定 `DB` 与 MCP 能力。部署行为需要使用者另行明确授权；本文不是修改账号、公开数据或扩大访问范围的许可。

站点创建后返回的项目 ID、网址及部署配置应保存在公开仓库之外。以[逻辑托管配置示例](../config/hosting.sites.example.json)为起点，加入真实返回的 `project_id`，存入私有文件。示例故意不包含可用的站点身份。

`DOT_BOARD_OWNER_ID` 必须是已登录所有者在“这个新 Site”上的专用用户 ID，应通过平台可信身份/配置流程取得。该 ID 会随 Site 改变；普通账号 ID、邮箱、浏览器自行提交的请求头、原作者的 ID 都不能替代。如果当前工具没有受支持的方式建立这个绑定，就停在此处解决配置缺口，不能关闭所有者校验。本仓库目前没有自动登记所有者的初始化端点。

现有适配器要求 Sites 完成访客认证、剥离伪造身份头，并注入 `oai-authenticated-user-id`。不能将它直接放在允许客户端自填此请求头的普通公网代理后面。

## 2. 构建并准备在线部署产物

构建环境使用 Node.js 24+，无 npm 依赖：

```sh
npm run check
npm run check:public
npm test
npm run package:sites -- --hosting "/absolute/private/hosting.json" --out "/absolute/new/sites-stage"
```

输出目录必须是仓库外尚不存在的新目录。命令先构建 `dist/sites/index.js`，再把私有入口放到部署所需的 `dist/server/index.js`。它不会覆盖通用 Worker 构建、连接账号或执行发布。私有托管文件只接受 `project_id`、`d1: "DB"` 和 `capabilities: ["mcp"]`，不接受运行时数据或凭据。

产物目录包含 19 个文件：

- `dist/server/index.js`：所有者私有的 Sites 应用与界面资源
- `dist/.openai/hosting.json`：本次安装自己的项目身份和逻辑能力
- `dist/.openai/drizzle/`：8 条 SQL 迁移、8 个结构快照及迁移日志

完整源码仍是本仓库；构建产物是本次部署的私有文件。不能把产物或私有配置提交到 GitHub。使用平台支持的源码版本、打包和部署流程，将这个确切源码版本及私有产物发布到新 Site，并保持仅所有者访问。本地构建成功不等于新站已经上线。

`package:sites` 是当前在线打包入口。其他构建目标属于[开发者备选入口](deployment.zh-CN.md#开发者构建入口)，不是安装时还要完成的步骤。不要把通用构建当作私有 Sites 产物部署。

## 3. 应用完整数据库结构

Sites 使用未经改写的 `drizzle/` 日志、全部 8 条 SQL 与全部 8 个结构快照，打包命令会一并复制。迁移顺序如下：

1. `0000_project_intake`
2. `0001_events_dispatch`
3. `0002_regular_nomad`：执行证据
4. `0003_lame_ultimates`：派发门禁与原生调用日志
5. `0004_living_mephisto`：看板观察记录
6. `0005_board_observation_outbox`
7. `0006_dispatch_manual_authorizations`
8. `0007_manual_task_status`

通过平台迁移机制应用到新安装的 `DB`，不能只跑前两条。独立的 `migrations/` 目录是普通 SQL/本地迁移链，编号 0000 至 0008；两条链不能重复应用到同一个数据库。升级已有站点需要单独备份和迁移审查，不能复制生产数据行或改写已经应用过的历史迁移。

## 4. 配置私有运行参数

通过新 Site 的运行时配置设置以下内容，不写进源码或浏览器：

| 设置 | 必需值或来源 |
| --- | --- |
| `DOT_BOARD_INGRESS` | `sites-owner-private-v1` |
| `DOT_BOARD_OWNER_ID` | 新 Site 可信认证取得的站点专用所有者 ID |
| `DOT_BOARD_AUDIENCE` | 平台返回的新站完整 HTTPS origin |
| `DB` | 已应用完整结构的 D1 绑定 |
| `DOT_BOARD_SNAPSHOT` | 填入 `examples/synthetic-snapshot.json` 的 JSON **文件内容**，不是文件路径；验收后再换自己的获准快照内容 |
| `DOT_BOARD_PROJECT_REGISTRY` | 与快照项目名称对应的固定 ID 和名称 |
| `DOT_BOARD_INTAKE_ENABLED`、`DOT_BOARD_INTAKE_MCP_ENABLED` | 仅启用实际配置好的功能 |
| `DOT_BOARD_INTAKE_CONNECTION_VERIFIED`、`DOT_BOARD_INTAKE_READER_VERIFIED`、`DOT_BOARD_INTAKE_WRITER_VERIFIED` | 对应真实连接/流程验证后才设为 `true` |
| `DOT_BOARD_OBSERVATIONS_ENABLED` | 可选；需要观察表结构与已授权的原任务映射 |
| `DOT_BOARD_OBSERVATION_BINDINGS` | 自己的私有任务/线程/环境映射，不能照搬原站 |
| `DOT_BOARD_QUEUE_ENABLED`、`DOT_BOARD_QUEUE_CAPACITY` | 可选队列策略，不会安装执行器 |

可从仓库示例生成合成项目注册表：

```sh
node -e "const s=require('./examples/synthetic-snapshot.json'); console.log(JSON.stringify([...new Set(s.tasks.map(t=>t.project))].map((name,i)=>({id:'demo-'+i,name,aliases:[]}))))"
```

当前私有 Sites 入口禁用直接 Events 投递和定时处理，修改环境开关不能开启。标准安装不配置 Events/中继；可单独配置的中继桥接属于宿主接入实验，不是使用看板必须补做的步骤，也不是已验收的自动执行连接。不要公开中继地址、秘密值或真实观察记录。其他接入边界见[所有者观察通道](OWNER_OBSERVATION_UPDATES.md)和[原生宿主契约](NATIVE_HOST_ADAPTER.md)。

## 5. 验收新在线站点

平台确认部署完成后，打开新站网址：

1. 验证登录、未登录拒绝、非所有者拒绝以及 origin 匹配。
2. 在真实托管页面核对合成项目、资源加载、筛选与任务详情。
3. 修改合成任务的手动状态，刷新后确认保留，同时不改写来源证据、不伪造执行状态。
4. 接通需求/MCP 后核对一次保存、重试、已读与推进回执；此测试不应启动真实执行器。
5. 观察写入只针对自己明确绑定的测试任务，保留来源时间。

原站应用及本源码有私有入口自动化覆盖。本仓库自动化测试尚未证明“另一个账号从零部署新 Site”的完整链路，也未完成浏览器视觉、真机、原生执行/续跑或真实回调验收。必须分别记录这些结果，不能把源码已公开或 CI 成功当作原私有账号的完整复制。
