<div align="center">

<img src="public/board-team.png" alt="dot 任务看板团队合照" width="360">

# dot task board

**把每个项目的任务、Agent、阻塞与最近成果，放到同一张看板。**

[English](README.md) · [简体中文](README.zh-CN.md)

[快速开始](#3-步上手) · [交给 Agent 安装](INSTALL.zh-CN.md) · [文档导航](#文档导航) · [参与贡献](CONTRIBUTING.zh-CN.md) · [MIT 许可](LICENSE)

</div>

**0.2.0-rc.1 源码预发布版：**可独立安装的项目看板，包含本地持久化需求回执、手动状态展示与可选宿主接入接口。原生自动执行和自动续跑尚未完成开箱即用验收。

## 从这里开始

多个 Agent 同时处理不同项目时，你需要的不只是一张任务清单：每个项目包含什么、谁在负责、哪里卡住，以及这些状态究竟是什么时候观察到的。

**dot task board 把明确导出的任务和 Agent 记录，变成以项目为主入口的工作台。** 它可以用 Node.js 独立运行，没有第三方运行时依赖。可选的认证需求通道，将需求保存、已读确认和推进回执与状态快照分别记录。

| 你想知道什么 | 看板会展示什么 |
| --- | --- |
| 这个项目正在做什么？ | 同一画布中的任务，以及有记录依据的 Agent 关联 |
| 谁在负责？ | 已观察到的 Agent、职责和明确的父子关系 |
| 为什么停住了？ | 已记录的阻塞原因、等待状态和下一步 |
| 到底交付了什么？ | 成果与证据入口，部署和业务验收单独表示 |
| 状态还新鲜吗？ | 来源观察时间、过期记录和尚未覆盖的范围 |
| 我的需求收到了吗？ | 接入需求通道后，先看保存回执，再看独立的已读和推进记录 |

### 你能拿到什么

- 以项目为主的统一画布、项目导航、任务与 Agent 筛选、搜索和详情
- 六款生成式角色形象；岗位未核实时，按稳定 ID 分配展示形象
- 版本化 JSON 契约、独立 Node 服务和可移植 Worker 适配器
- 可选的只读 Workbench 导出映射
- 可选的持久化需求通道，以及用于读取和记录进展的认证 MCP 工具
- 本地安装、启动、状态检查、停止与代码回滚命令，用户数据保存在源码之外
- 一致的手动展示状态、数量、筛选与折叠历史，不改写来源观察和执行证据
- 普通运行模式默认关闭的实验性有限队列与 Events 接入
- 合成示例、隐私边界检查和回归测试

当前界面使用中文文案。英文与简体中文文档独立维护，界面英文切换尚未实现。角色图片仅用于展示，不证明 Agent 的身份、岗位或在线状态。

### 3 步上手

使用 **Node.js 24 或更新版本**，无须执行 `npm install`。

1. 获取源码：

   ```sh
   git clone https://github.com/KimYx0207/dot-task-board.git
   cd dot-task-board
   ```

2. 启动合成示例：

   ```sh
   npm run demo
   ```

3. 打开 `http://127.0.0.1:4317`，或终端显示的地址。选择项目，再点击任务或 Agent，查看观察记录和成果证据。

示例使用虚构记录，每次运行新建临时 SQLite 数据库来保存本地需求回执，并提供队列工具用于合成测试。它不连接真实账号，也不启动真实 Agent；重新启动演示会创建新的临时数据库。

### 接入自己的数据

参考[完整示例](examples/synthetic-snapshot.json)和[数据契约](docs/data-contract.zh-CN.md)，准备脱敏后的快照。真实数据必须保存在仓库之外。

macOS / Linux：

```sh
DOT_BOARD_SNAPSHOT_PATH=/absolute/path/outside-repo/snapshot.json npm start
```

PowerShell：

```powershell
$env:DOT_BOARD_SNAPSHOT_PATH = 'C:\private-data\snapshot.json'
npm start
```

服务只监听 `127.0.0.1`。通过 `DOT_BOARD_PORT` 修改默认端口 `4317`。没有配置数据源时，看板会显示“未接入”，不会悄悄换成演示数据。[`.env.example`](.env.example) 用于说明配置项，程序不会自动加载 `.env` 文件。

## 当前能力

| 能力 | 状态与边界 |
| --- | --- |
| 项目、任务与 Agent 展示 | 可读取已有快照；刷新不会采集新的观察 |
| 观察时效与成果证据 | 已提供；完成记录与部署、业务验收分别表示 |
| 需求保存与 MCP 回执 | 可选；需要存储、固定项目 ID 和经过验证的认证边界 |
| 手动任务状态 | 认证宿主可提供编辑；普通/本地安装仅展示状态。手动完成与观察到的执行、业务验收分别保留 |
| 原生宿主适配器 | 提供源码接口与合成契约测试；仍需配置已授权的真实宿主并完成端到端验收 |
| 有限派发队列 | 实验性，默认关闭；可认领和记录任务，本身不提供原生执行器 |
| Events 与 Webhook 投递 | 实验性，默认关闭；需要单独提供并授权的传输实现 |
| 原生调度、插件连接与外部回调 | 启动本仓库或通过本地测试，都不代表这些接入已经完成 |

浏览器保存需求不会自动启动、恢复、取消或抢占原生任务。宿主需要单独执行获准的操作，并写回实际发生的结果。过期的运行观察不代表 Agent 现在仍在运行。

### 本次源码验证结果

2026-10-09，使用 Node.js 24.19.0 在整合源码和便携包全新解压目录各运行 **649 项测试，全部通过，零失败、零跳过**；219 个源码文件摘要全部一致。公共、候选、所有者私有三种构建、编译语法及私有观察通道的合成检查通过。干净本地安装已验证静态资源、需求持久化、幂等重试、停止与重启。

当前预览环境无法把本地候选页面提供给浏览器，因此本次源码的浏览器视觉验收与真实设备验收未完成，自动化界面契约测试不能替代它们。真实插件连接、原生自动执行、自动续跑和真实外部回调交付仍未验收。

## 文档导航

| 接下来读什么 | 内容 |
| --- | --- |
| [架构说明](docs/architecture.zh-CN.md) | 组件、职责与信任边界 |
| [数据契约与 HTTP 接口](docs/data-contract.zh-CN.md) | 快照字段、项目 ID、路由与 MCP 工具 |
| [安装说明](INSTALL.zh-CN.md) · [部署说明](docs/deployment.zh-CN.md) | 本地运行、可选 Worker/D1 托管和访问控制 |
| [可选接入](docs/integrations.zh-CN.md) | 需求生命周期、有限队列、宿主适配与实验性 Events |
| [参与贡献](CONTRIBUTING.zh-CN.md) | 开发与验证要求 |
| [安全说明](SECURITY.zh-CN.md) | 问题报告与隐私边界 |
| [更新日志](CHANGELOG.zh-CN.md) | 版本变化 |
| [来源与依赖](THIRD_PARTY.zh-CN.md) | 代码、图片与依赖来源 |

## 开发与检查

```sh
npm run check
npm run check:public
npm run build
npm test
node --check dist/server/index.js
```

测试覆盖快照校验、关系、时效、项目分组、需求持久化、用户隔离、幂等与队列转换。文档检查验证语言入口和本地链接。本地检查通过，不代表真实插件连接、外部回调投递、原生调度或真实手机验收已经通过。

[持续集成配置](.github/workflows/ci.yml)使用标准公共 Ubuntu 运行器和只读仓库权限，不部署、不发布软件包、不上传构建产物。私有仓库自动跳过线上运行，本地检查仍可使用。托管服务及其用量由操作者自行选择，各自有独立的限制与费用。

<details>
<summary><strong>源码结构</strong></summary>

| 位置 | 职责 |
| --- | --- |
| `config/` | 展示文案、状态和过期阈值 |
| `src/domain/` | 快照、需求、队列与事件校验 |
| `src/application/` | 只读模型、需求通道、队列转换与可选宿主接口 |
| `src/adapters/` | 快照、Workbench 与持久化适配 |
| `src/presentation/` | HTTP 与 MCP 请求处理 |
| `public/` | 画布、筛选、详情与角色图片 |
| `server.mjs`、`worker.mjs` | Node 与 Worker 运行入口 |
| `examples/`、`fixtures/`、`tests/` | 合成数据与回归检查 |

</details>

## 安全与隐私

Node 服务用于本机环回访问。Worker 不提供账号系统：使用私有数据前，宿主必须对整个页面和所有数据路由进行认证与授权。只有宿主先剥离客户端提交的身份头、完成认证后再设置身份，服务端才能信任该身份头。真实快照、需求数据库、凭据和部署身份应留在公开源码之外。接入私有数据前，请先阅读[安全说明](SECURITY.zh-CN.md)。

## 联系方式

![作者联系方式：公众号与个人微信二维码](docs/images/contact-qr.png)

[GitHub：KimYx0207](https://github.com/KimYx0207) · [X：@KimYx0207](https://x.com/KimYx0207) · [官网：aiking.dev](https://www.aiking.dev/)

- 微信公众号：**老金带你玩AI**
- 个人微信：扫描联系图中的个人微信二维码，备注“AI”加群
- [飞书知识库：长期更新入口](https://my.feishu.cn/wiki/OhQ8wqntFihcI1kWVDlcNdpznFf)

以上沿用维护者在 [Meta_Kim 联系区](https://github.com/KimYx0207/Meta_Kim/blob/5c77918045d2372a5254b8738bdcfaff468bf4f1/README.zh-CN.md#联系方式)已经公开的联系方式。

### 问题与漏洞反馈

普通问题请通过[问题反馈](https://github.com/KimYx0207/dot-task-board/issues)提供合成复现。涉及漏洞时，请按[安全说明](SECURITY.zh-CN.md)处理，不要将利用细节或私有数据发到公开问题区或群聊。

## 许可

[MIT](LICENSE) · Copyright (c) 2026 KimYx0207

## 构建入口与手动状态

`npm run build` 生成通用 Worker `dist/server/index.js`；`npm run build:sites` 生成所有者私密入口 `dist/sites/index.js`；`npm run build:candidate` 生成 `dist/candidate/index.js`。三个产物互不覆盖。Sites 入口仍必须配置可信入口、所有者与受众校验。

通用 Worker 与本机部署没有接通可信的手动状态服务，因此只读展示任务状态并拒绝手动状态写入。只有宿主提供经过身份验证的服务时，才启用快捷状态与备注。需求和队列记录不代表原生执行或自动续跑已接通。
