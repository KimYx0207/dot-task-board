# 来源与依赖

[English](THIRD_PARTY.md) · [简体中文](THIRD_PARTY.zh-CN.md)

- 本仓库的展示、读模型、校验和适配代码为本模块编写
- 没有 npm 运行时或开发依赖；测试使用 Node.js 自带的 `node:test`
- Node.js 是单独安装的运行环境，本仓库不分发其二进制
- 页面使用系统字体回退，不下载或分发第三方字体文件
- 图标由简单文本和本模块的基础 SVG favicon 构成，没有引入图标包或图库
- Workbench 适配器仅映射导出字段，没有复制其 UI、执行引擎或无许可实现
- GitHub Actions 使用官方 `actions/checkout` 和 `actions/setup-node`，固定到提交 SHA；这些动作在 CI 中运行，不被打包到本应用
- 本仓库不包含第三方角色定义、核心方法、提示词或能力包

加入第三方代码或依赖前，应先确认来源、许可证兼容性及必要的署名。
