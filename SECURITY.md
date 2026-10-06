# Security

## Supported versions

当前维护 `0.1.x`。这是只读快照展示工具，不是安全隔离的 Agent 执行环境。

## Reporting a vulnerability

如果仓库提供 GitHub 私密漏洞报告入口，请优先使用。若入口未启用，可以新建只含“请求私密安全联系渠道”的 issue；不要在公开 issue 中贴出漏洞利用细节、真实快照、账号信息、凭据或私人日志。

普通界面问题可用合成复现公开报告。不要假定仓库维护者已承诺响应时限。

## Trust boundaries

- 输入必须由可信宿主主动导出并脱敏
- 字段白名单、长度限制、链接筛选与 `textContent` 渲染是防御措施，不是完整的数据脱敏保证
- Node 服务默认仅监听 loopback，并拒绝非 loopback Host；不要直接将它开放到公网
- Worker 依赖部署平台的认证与授权。真实数据部署必须验证“未登录者不能读取数据”，不能仅凭隐藏导航判断私密
- 部署配置、运行时变量与快照不属于公开源码
- 安全修复应保留未知/过期/错误状态，不能为消除报错而伪造成功

## CI

工作流只需要 `contents: read`，checkout 不保留写入凭据。没有 `pull_request_target`、仓库写权限、秘密输入、生产部署、付费大规格 runner、缓存或产物上传步骤。
