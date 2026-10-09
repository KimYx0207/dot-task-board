<div align="center">

<img src="public/board-team.png" alt="dot 任务看板团队合照" width="360">

# dot task board

**把每个项目的任务、Agent、阻塞与最近成果，放到同一张看板。**

[English](README.md) · [简体中文](README.zh-CN.md)

[快速开始](#3-步上手) · [交给自己的 dot 部署](docs/sites-deployment.zh-CN.md) · [文档导航](#文档导航) · [参与贡献](CONTRIBUTING.zh-CN.md) · [MIT 许可](LICENSE)

</div>

**把这个 GitHub 地址发给自己的 dot，让它为你部署属于自己的私有在线 Site。** 仓库包含线上看板、手动状态、需求、队列与观察服务源码；需要你自己的 Sites 平台权限和身份/数据配置。原生自动执行与自动续跑仍未验收。

## 从这里开始

多个 Agent 同时处理不同项目时，你需要的不只是一张任务清单：每个项目包含什么、谁在负责、哪里卡住，以及这些状态究竟是什么时候观察到的。

**dot task board 把明确导出的任务和 Agent 记录，变成以项目为主入口的工作台。** 主要使用形态是浏览器打开的私有在线 Site。Node.js 用于构建与开发，查看在线站点的人不需要在本机运行它。可选的认证需求通道，将需求保存、已读确认和推进回执与状态快照分别记录。

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

1. 把 `https://github.com/KimYx0207/dot-task-board` 发给自己的 dot。
2. 告诉它按下面的说明，部署“属于你自己的、仅所有者可访问的在线 Site”。如确实需要平台权限或账号确认，再按提示完成。
3. dot 确认新站部署成功、所有者访问检查通过后，打开它给你的新网址。先用合成数据验收，再接入你自己的获准记录。

可直接复制给自己的 dot：

> 读取 https://github.com/KimYx0207/dot-task-board 及 docs/sites-deployment.zh-CN.md，按你当前支持的 Sites 构建托管流程，为我部署属于自己的、仅所有者可访问的在线任务看板。保留作者的四个公开入口：个人主页 aiking.dev、X @KimYx0207、GitHub KimYx0207、微信公众号“老金带你玩AI”。我的身份、项目数据、线程映射和凭据必须保持私有。使用 Sites 专用构建、完整 D1 结构，以及我这个新 Site 的可信所有者身份。先用合成数据完成部署和所有者访问检查，再给我自己的 Site 网址。如果缺少平台权限或站点专用身份配置方式，请准确告诉我缺哪一步。不要把本机预览或尚未验收的执行接入当成在线站点已交付。

仓库不能替你取得平台权限，也不能复制原作者的私有账号。当前已验证构建与打包契约，但还未用独立用户账号走完真实新站部署。[具体部署条件与剩余边界](docs/sites-deployment.zh-CN.md)都有列明。

### 开发者可选：本机预览

只想在本机查看界面时，使用 Node.js 24+，无需 `npm install`：

```sh
git clone https://github.com/KimYx0207/dot-task-board.git
cd dot-task-board
npm run demo
```

终端显示的 `http://127.0.0.1:4317` 是临时本机示例地址，不是为你新部署的在线 Site。示例使用虚构数据，不连接账号，不启动真实 Agent。也可用 `DOT_BOARD_SNAPSHOT_PATH=/absolute/private/snapshot.json npm start` 读取本地快照。持久化本地安装、PowerShell 等细节见 [INSTALL.zh-CN.md](INSTALL.zh-CN.md)。

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

2026-10-09，使用 Node.js 24.19.0 在整合源码和便携包全新解压目录各运行 **652 项测试，全部通过，零失败、零跳过**；224 个源码文件摘要全部一致。公共、候选、所有者私有三种构建、编译语法及私有观察通道的合成检查通过。干净本地安装已验证静态资源、需求持久化、幂等重试、停止与重启。

当前预览环境无法把本地候选页面提供给浏览器，因此本次源码的浏览器视觉验收与真实设备验收未完成，自动化界面契约测试不能替代它们。真实插件连接、原生自动执行、自动续跑和真实外部回调交付仍未验收。

## 文档导航

| 接下来读什么 | 内容 |
| --- | --- |
| [在线 Sites 部署](docs/sites-deployment.zh-CN.md) | 把仓库交给自己的 dot，部署自己的私有在线 Site |
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
