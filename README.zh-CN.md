<div align="center">

# dot task board

**看清谁在工作、哪里卡住，以及最近交付了什么。**

[English](README.md) · [简体中文](README.zh-CN.md)

[快速开始](#3-步上手) · [文档导航](#文档导航) · [参与贡献](CONTRIBUTING.zh-CN.md) · [MIT 许可](LICENSE)

</div>

## 从这里开始

多个 Agent 同时处理不同项目时，一张任务清单还不够。你需要知道谁在负责、谁和谁有关联、为什么在等，以及这些状态是什么时候确认的。

**dot task board 把明确导出的状态快照，变成以 Agent 为主视图的看板。** 它可以通过 Node.js 独立运行，没有第三方运行时依赖。

| 你想知道什么 | 看板会展示什么 |
| --- | --- |
| 谁在干活？ | 有实际记录的 Agent、各自职责和关联任务 |
| 谁创建了哪个子 Agent？ | 输入中明确的父子关系，与项目分组分开展示 |
| 为什么停住了？ | 已记录的阻塞原因、等待状态和下一步 |
| 到底交付了什么？ | 最近成果和证据入口，单独区分部署与验收 |
| 这些状态还能信吗？ | 观察时间、过期记录，以及尚未覆盖的范围 |

### 你能拿到什么

- 以 Agent 为主的总览、项目筛选和任务详情
- 用于接入自有导出数据的版本化 JSON 契约
- 可独立运行的本地服务和可移植的 Worker 适配器
- 可选的 Workbench 导出映射，无须运行 Workbench
- 合成示例、隐私边界检查和回归测试

当前界面使用中文文案。文档分为英文和简体中文两个独立版本，界面的英文切换尚未实现。

### 3 步上手

需要 **Node.js 22 或更新版本**，无须执行 `npm install`。

1. 获取源码：

   ```sh
   git clone https://github.com/KimYx0207/dot-task-board.git
   cd dot-task-board
   ```

2. 启动合成示例：

   ```sh
   npm run demo
   ```

3. 打开 `http://127.0.0.1:4317`，或终端显示的地址。选择一个 Agent，查看其任务、最近成果和已记录的创建关系。

示例中的角色和任务均为虚构，不连接真实账号，也不启动真实 Agent。

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

本版本读取外部宿主提供的快照。刷新会重读这份快照；导出方提供新的观察后，看板才能显示新的活动。

| 现在可用 | 当前版本尚未包含 |
| --- | --- |
| 有记录的 Agent 关系和任务状态 | 原生 Agent 自动发现或调度 |
| 观察时效、阻塞与成果入口 | 自动采集的实时事件流 |
| 只读 Node 和 Worker 接口 | 项目提交、任务执行或暂停与恢复按钮 |
| 导出任务的可选映射 | 直接读取 Workbench 会话或私人对话 |

Agent 完成一次交付，不自动代表项目已经部署或通过验收。缺少证据的状态会保留为未知。

## 文档导航

| 接下来读什么 | 内容 |
| --- | --- |
| [架构说明](docs/architecture.zh-CN.md) | 分层边界与职责 |
| [数据契约与 HTTP 接口](docs/data-contract.zh-CN.md) | 输入字段、兼容性和路由 |
| [部署说明](docs/deployment.zh-CN.md) | 运行数据、访问控制和刷新行为 |
| [参与贡献](CONTRIBUTING.zh-CN.md) | 开发与验证要求 |
| [安全说明](SECURITY.zh-CN.md) | 问题报告和信任边界 |
| [更新日志](CHANGELOG.zh-CN.md) | 版本变化 |
| [来源与依赖](THIRD_PARTY.zh-CN.md) | 代码来源和依赖规则 |

## 开发与检查

```sh
npm run check
npm run check:public
npm test
npm run build
node --check dist/server/index.js
```

测试覆盖输入契约、真实记录的关系、过期计数、隐私边界、只读 HTTP、导出映射和 Worker 请求处理。文档检查验证语言入口和本地链接。自动检查不能代替真实手机的视觉验收，也不代表某个宿主接入已经验收。

持续集成使用标准公共 Ubuntu 运行器、Node.js 22/24 和只读权限，不部署、不发布软件包、不上传构建产物。私有仓库自动跳过线上运行，本地检查仍可使用。参见 [GitHub Actions 计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。

<details>
<summary><strong>源码结构</strong></summary>

| 位置 | 职责 |
| --- | --- |
| `config/` | 展示文案、状态和过期阈值 |
| `src/domain/` | 版本化输入、字段白名单和关系校验 |
| `src/application/` | 只读模型、观察时效和范围内计数 |
| `src/adapters/` | 快照与可选 Workbench 导出适配 |
| `public/` | 总览、筛选与详情 |
| `server.mjs`、`worker.mjs` | Node 与 Worker 运行入口 |
| `examples/`、`fixtures/`、`tests/` | 合成数据与回归检查 |

</details>

## 安全与隐私

Node 服务仅供本机访问。Worker 没有内置账号系统，使用真实数据前，部署平台必须对页面和接口同时提供认证与授权。真实任务、对话、凭据和部署身份应留在公开源码之外。接入私有数据前，请先阅读[安全说明](SECURITY.zh-CN.md)。

## 维护者

[GitHub：KimYx0207](https://github.com/KimYx0207) · [官网](https://www.aiking.dev/) · [X](https://x.com/KimYx0207)

普通问题请通过 [问题反馈](https://github.com/KimYx0207/dot-task-board/issues) 提供合成复现。涉及安全风险时，按[安全说明](SECURITY.zh-CN.md)中的私密报告方式处理。

## 许可

[MIT](LICENSE) · Copyright (c) 2026 KimYx0207
