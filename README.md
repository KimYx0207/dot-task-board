# dot task board

看清谁在负责、谁在等待，以及最近交付了什么。

A portable, read-only dashboard for explicit Agent and task status snapshots. Runs independently with Node.js, with zero runtime dependencies.

## 能做什么

- 按实际记录显示主 Agent、subagent 和创建关系
- 将项目归属、Agent 活动、任务进展与业务验收分开
- 查看当前工作、阻塞原因、下一步和成果入口
- 对缺失、过期和未知观察明确标记，不把旧的 `running` 当作持续运行
- 独立 Node 服务与 Worker 适配器共用同一读模型
- 可选 Workbench 导出适配器，无须安装 Workbench

数据来源是宿主明确导出的 JSON 快照。浏览器不会自动读取私有对话、调用原生 Agent 工具或调度任务。刷新只会重读快照，直到宿主提供新的观察。

## 30 秒运行示例

需要 Node.js 22 或更新版本。不需要 `npm install`。

```sh
git clone https://github.com/KimYx0207/dot-task-board.git
cd dot-task-board
npm run demo
```

打开终端显示的 `http://127.0.0.1:4317`。示例包含明确标记的合成角色和任务，不连接任何真实账号或执行服务。

## 接入自己的快照

1. 参考 [`examples/synthetic-snapshot.json`](examples/synthetic-snapshot.json) 和[数据合同](docs/data-contract.md)
2. 将经过脱敏的真实快照放在源码目录外
3. 指定文件并启动

macOS / Linux：

```sh
DOT_BOARD_SNAPSHOT_PATH=/absolute/path/outside-repo/snapshot.json npm start
```

PowerShell：

```powershell
$env:DOT_BOARD_SNAPSHOT_PATH = 'C:\private-data\snapshot.json'
npm start
```

默认只监听 `127.0.0.1`。`DOT_BOARD_PORT` 可调整端口，默认 `4317`。未配置数据时显示“未接入”，不会悄悄切换成演示数据。

程序不会自动加载 `.env` 文件；[`.env.example`](.env.example) 仅用于说明配置项。

## 配置与结构

| 位置 | 职责 |
| --- | --- |
| `config/board.mjs`、`config/agents.mjs` | 集中文案、状态标签与过期阈值 |
| `src/domain/` | 版本化输入、字段白名单、关联关系与安全校验 |
| `src/application/board-service.mjs` | 只读投影、观察时效与范围内计数 |
| `src/adapters/` | 快照和可选 Workbench 导出适配 |
| `public/` | Agent 主视图、任务次级视图、筛选与详情 |
| `server.mjs`、`worker.mjs` | Node 与 Worker 运行适配器 |
| `examples/`、`fixtures/`、`tests/` | 仅合成数据和回归检查 |

更多说明：[架构](docs/architecture.md) · [数据合同与 API](docs/data-contract.md) · [部署边界](docs/deployment.md)

## 开发与检查

```sh
npm run check
npm run check:public
npm test
npm run build
node --check dist/server/index.js
```

检查覆盖数据合同、真实父子关系、过期计数、输入隐私边界、只读 HTTP、导出适配与 Worker 构建。自动检查不代表真实手机视觉或特定宿主集成已经验收。

CI 使用标准公共 Ubuntu runner、Node.js 22/24 和只读仓库权限，无部署步骤、缓存或构建产物上传。工作流在私有仓库自动跳过，避免未经选择使用私有仓库分钟额度；本地命令仍可运行。参见 [GitHub Actions 计费说明](https://docs.github.com/en/billing/concepts/product-billing/github-actions)。不在 README 中写死 CI 通过状态。

## 安全边界

真实任务、对话、提示词、角色/方法资产、密钥和部署身份都不应进入仓库。公开的是通用界面、读模型和适配代码。

- 本地服务只读、仅 loopback，无任务执行或修改接口
- Worker 本身不提供登录系统；部署真实数据时必须由宿主提供并验证访问控制
- 真实运行数据留在源码之外；不要把快照放进 `public/`、示例或构建输出
- 已完成的 Agent 结果不自动代表任务已部署或已获业务验收

更多内容见 [SECURITY.md](SECURITY.md)。欢迎通过 [CONTRIBUTING.md](CONTRIBUTING.md) 参与改进。

## 许可

[MIT](LICENSE) · Copyright (c) 2026 KimYx0207

本项目没有运行时第三方依赖；来源和依赖说明见 [THIRD_PARTY.md](THIRD_PARTY.md)。
