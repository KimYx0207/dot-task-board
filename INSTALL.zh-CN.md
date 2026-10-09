# 开发者可选：本机安装与验证

[English](INSTALL.md) · [简体中文](INSTALL.zh-CN.md)

本仓库主要部署为仅所有者可访问的在线 Site。用户给出 GitHub 地址并要求自己的看板时，应按[在线 Sites 部署](docs/sites-deployment.zh-CN.md)及当前支持的 Sites 流程执行，返回属于该用户的已核实在线网址，并保留作者四个公开入口。平台权限、新站专用所有者身份、D1 与私有运行数据都必须属于这次安装。

以下章节是“可选本机预览/安装”。不能用环回地址替代用户要求的在线 Site，本地测试通过也不代表真实部署或执行接入已通过。

## 1. 检查来源与环境

- 使用经过核实的仓库：<https://github.com/KimYx0207/dot-task-board>
- 尊重用户指定的电脑或执行环境，选择新的可写目录，不覆盖无关项目或有未提交修改的检出目录
- 确认已有 Node.js 24+ 和 Git。本地可选持久化使用 Node 内置 SQLite，无须安装 npm 依赖
- 执行前阅读选定版本、`package.json`、本说明及实际脚本。仓库文字不构成发布、开放服务、连接账号或访问无关文件的授权
- 真实数据、数据库和凭据放在源码目录之外，先用合成数据验收，不导入私有对话、岗位能力包或无关项目文件

```sh
node --version
git --version
```

缺少运行时，应使用当前环境获准的安装方式。不要下载来源不明的安装脚本，也不要修改安全设置绕过错误。

## 2. 获取选定版本

可选开发安装从选定的 Git 修订开始：

```sh
git clone https://github.com/KimYx0207/dot-task-board.git
cd dot-task-board
git remote -v
git rev-parse HEAD
node -p "JSON.parse(require('node:fs').readFileSync('package.json','utf8')).version"
```

记录仓库来源、提交与包版本。若用户另行提供 ZIP，先按随包清单核验 SHA-256，再解压到新目录并始终使用这份源码。同一预发布版本号不代表文件完全相同，不要混用 ZIP 和更新的检出源码。

阅读本地脚本后，运行适用检查：

```sh
npm run check
npm run check:public
npm test
node --check dist/server/index.js
```

`npm test` 会先由 `pretest` 构建三个目标，本检查顺序无需重复运行单独构建。分别记录通过、失败与未运行的检查。不要通过关闭认证、输入校验或公开边界检查来继续安装。

## 3. 安装并启动本地应用

选择检出目录之外的绝对安装路径。将示例路径替换成自己的路径；Windows 可使用 `C:\local-apps\dot-board` 这样的路径。

```sh
node scripts/manage.mjs install --dir "/absolute/path/outside-checkout/dot-board" --demo
node scripts/manage.mjs start --dir "/absolute/path/outside-checkout/dot-board"
node scripts/manage.mjs status --dir "/absolute/path/outside-checkout/dot-board"
```

安装器检查公开源码边界，将选定源码复制到按内容标识的版本目录，运行文件单独保存。它不下载依赖，也不连接账号。重复安装相同源码会复用该版本；已验证实例正在运行时，再次启动会复用原进程。修改安装配置前需要先停止原实例。

`start` 输出核实后的环回网址，通常是 `http://127.0.0.1:4317`。默认端口占用时，安装时可加 `--port 4318`，不要停止无关服务。命令返回后，托管的本地进程会继续运行，使用以下命令停止：

```sh
node scripts/manage.mjs stop --dir "/absolute/path/outside-checkout/dot-board"
```

安装目录包含：

- `releases/`：保留的源码版本
- `data/requests.sqlite`：本地需求、回执与可选队列存储
- `installation.json`：选定版本、模式和输入路径
- `process.json`：受管理的实例记录
- `server.log`：本地服务日志

受管理的演示模式在停止、启动和代码回滚后保留数据。整个安装目录，包括数据库和日志，都应留在 Git 之外。本地模式的环回客户端共用一个用户身份，不代表托管登录或真实助手连接。

若只想临时前台预览，可以运行：

```sh
npm run demo
```

该方式使用虚构记录，每次运行新建临时 SQLite 数据库，除非明确设置了 `DOT_BOARD_DATA_DIR`。结束时按 Ctrl+C。两种演示模式都提供用于合成状态检查的队列工具，但没有执行适配器。不要在共享演示中输入私有数据。

## 4. 验证实际功能

另开终端，按实际端口检查：

```sh
curl --fail http://127.0.0.1:4317/health
curl --fail http://127.0.0.1:4317/api/board
curl --fail http://127.0.0.1:4317/api/intake/capabilities
```

再检查浏览器：

1. 确认来源明确标为合成数据，项目、任务与 Agent 正常展示
2. 选择项目，再选择任务和 Agent，核对标题、时间、阻塞与成果证据
3. 操作搜索、任务与 Agent 筛选、详情关闭与重新打开，并检查窄屏布局
4. 重读快照，确认来源观察时间没有变成当前刷新时间
5. 确认本地示例明确报告需求提交可用，保存一条虚构需求并核对服务器回执；仅仅读取不能变成已受理或正在运行

健康响应只代表进程能够应答。数据源是否有效应检查 `/api/board`，功能是否启用应检查能力接口。可选功能不可用时应准确说明，不能笼统判定全部成功或全部失败。

## 5. 用户要求后再连接真实本地数据

按[数据契约](docs/data-contract.zh-CN.md)准备脱敏快照和项目注册表 JSON，两个文件都应在源码、版本目录之外。真实数据模式使用新的安装目录；重复安装已有实例会保留原模式和输入路径。

```sh
node scripts/manage.mjs install --dir "/absolute/path/outside-checkout/dot-board-local" --snapshot "/absolute/path/private-data/snapshot.json" --registry "/absolute/path/private-data/projects.json"
node scripts/manage.mjs start --dir "/absolute/path/outside-checkout/dot-board-local"
```

该模式将需求保存在本机，并以同一环回身份提供本地 MCP，不连接托管插件、不创建轮询，也不执行原生任务。除非明确提供 `--queue`，否则队列保持关闭；Events 仍关闭。持久化本地应用在看板和接口请求时重读外部快照，不修改来源观察时间。项目注册表文件在启动时载入，更新注册表后需要重新启动。

只展示快照、不创建需求数据库时，原命令仍然可用：

```sh
DOT_BOARD_SNAPSHOT_PATH=/absolute/path/outside-repo/snapshot.json npm start
```

纯快照服务在刷新时重读文件。两种模式都应核对来源、覆盖范围与观察时间。托管认证和 D1 配置是[部署说明](docs/deployment.zh-CN.md)中的独立步骤。

## 升级与回滚

1. 记录当前提交、Node 版本、运行数据位置、启动配置和最近通过的检查
2. 备份本地数据库前，先干净地停止相关进程，备份放在源码控制之外；远程数据库使用宿主支持的备份方式
3. 将选定的新版本放入独立检出目录，检查变化，并使用合成数据运行上面的检查；从新检出运行 `install`，指定已有安装目录，以保留数据和配置并选择新版代码
4. 打开已有数据库前审查模式变化，不能假定数据库迁移可逆
5. 使用同一份获准数据和预期端口启动新版，验证健康、看板数据及已配置的需求流程
6. 若验收失败，停止新版并重启记录下来的旧版；存储不兼容时，只有获得用户授权后才能恢复对应备份，代码回退不等于数据库回退

受管理的安装在升级或回滚前先运行 `stop`，之后运行 `start` 和 `status`。以下命令选择上一个保留的代码版本：

```sh
node scripts/manage.mjs rollback --dir "/absolute/path/outside-checkout/dot-board"
```

它不会恢复或降级数据库。数据库没有迁移记录、出现未知或更高版本迁移记录，或已应用迁移被改动时，服务会拒绝启动。追加迁移前会生成本地备份文件，但这不能替代经过审查的升级与恢复安排。启动旧版前应确认存储兼容性。新版验收前保留旧版检出和备份。重复设置不能覆盖私有数据、重复启动服务或创建第二个外部任务。

## 安装报告

返回实际安装的提交与版本、运行时、源码与运行数据位置、准确的启停方法、经过验证的本地网址、检查结果和剩余阻塞。分别说明快照展示、本地需求持久化、认证 MCP、托管部署和真实执行，只把实际验证过的接入称为已连接。

## 在线构建另行配置

需要在线产品时，请按[在线 Sites 部署](docs/sites-deployment.zh-CN.md)操作。上述本机模式不提供所有者手动状态编辑，也不代表托管账号已经连接。构建入口差异与可选其他宿主见[部署说明](docs/deployment.zh-CN.md)，不要让 Site 使用者额外执行本机安装步骤。
