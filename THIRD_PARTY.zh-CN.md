# 来源与依赖

[English](THIRD_PARTY.md) · [简体中文](THIRD_PARTY.zh-CN.md)

- 本仓库的展示、读模型、校验和适配代码为本模块编写
- 没有 npm 运行时或开发依赖；测试使用 Node.js 自带的 `node:test`
- 本地可选持久化使用 Node.js 24+ 内置 SQLite；Node 运行时由用户单独安装，不随源码分发
- D1 托管与平台工具是可选部署方式，不属于 npm 运行时依赖；仓库中的 SQL 不要求安装模式生成器
- `public/dot-agent-roles.png` 中的六款角色形象为本看板生成，用于装饰和区分卡片，不是真人照片或经过验证的身份
- 页面使用系统字体回退，不下载或分发第三方字体文件
- 嵌入了四个 Tabler SVG 配饰图标（skull、clipboard-text、flask、check），采用 MIT 许可，版权归 2020–2026 Paweł Kuna。完整许可证、来源链接与原始 blob ID 保留在 `public/collaboration-graph.js` 中，没有安装运行时图标依赖。
- `public/board-team.png` 是为看板生成的八人装饰性横幅。
- Workbench 适配器仅映射导出字段，没有复制其 UI、执行引擎或无许可实现
- GitHub Actions 使用官方 `actions/checkout` 和 `actions/setup-node`，固定到提交 SHA；这些动作在 CI 中运行，不被打包到本应用
- 作者联系图原样沿用维护者的 [Meta_Kim 公开联系图](https://github.com/KimYx0207/Meta_Kim/blob/5c77918045d2372a5254b8738bdcfaff468bf4f1/docs/images/contact-qr.png)，只用于文档展示，不是应用依赖
- 本仓库不包含第三方角色定义、核心方法、提示词或能力包

加入第三方代码或依赖前，应先确认来源、许可证兼容性及必要的署名。

- 公开界面使用项目自己的 CSS/SVG 基础圆形，不嵌入 OpenAI 标识路径。OpenAI、GitHub、X、微信等名称和商标归各自权利人所有；仓库 MIT 许可不授予这些商标的使用权，也不代表官方背书。
