# 可选接入

[English](integrations.md) · [简体中文](integrations.zh-CN.md)

快照看板可以独立运行。需求保存、任务队列和事件投递是不同层次，它们都不会自动授予执行用户输入的权限。

## 当前 Site 的接入范围

新建私有在线看板按 [Sites 部署](sites-deployment.zh-CN.md)操作。当前产品主线是线上界面、手动状态及实际配置好的需求/观察服务。下面的队列执行、Events、中继传输与外部宿主配置属于可选工程接入，不是安装看板必须做的步骤。

仓库提供这些接口源码与合成测试，但获取源码不会连接原生执行宿主或启动自动任务。Sites 已将所有者认证的 Events 发现与受策略控制的直接投递分开。标准安装保持投递关闭；直接路径需要独立核实的运行时、路由、精确 origin 证据及真实原生订阅。Sites 定时处理仍明确禁用。独立中继桥接仍需另外的私有配置和验收，标准安装不启用它。详见 [Sites 直接 Events](sites-direct-events.md)。

### 只读的项目 Events scope 诊断

在 owner-private Sites 中，`list_request_projects` 可为原有可见列表中的每个项目附加 `eventScope: {allowed, reason}`。Events 订阅/投递授权与该诊断共用项目 scope 判断；不会返回 owner 身份、registry 原文、隐藏项目清单、callback URL 或凭据，也没有新增查询参数。隐藏、已移除、未注册或原来未列出的项目不会为诊断而补入。通用 Worker 或未安装适配器的服务保持 `{id, name}` 旧形状；安装适配器后的默认 `projects()` 调用也保持原形状。

`allowed: true` 和 `project_scope_allowed` 只表示当前 active 项目的范围允许 Events。`project_notification_allowed` 表示延后项目获得独立的部署级需求通知许可，其执行状态仍为 deferred。这两个原因都不授予执行权限。投递开关、入口认证、存储、callback 策略、订阅验证与真实收件仍是独立条件。任务 completed 不是项目 Events 门禁。读取诊断不会创建需求、订阅、outbox、callback 或执行。

固定拒绝原因包括 `project_registry_absent`、`project_registry_invalid`、`empty_hidden_configuration`、`invalid_hidden_configuration`、`project_hidden`、`project_not_found`、`project_requests_closed`、`project_paused`、`project_deferred`、`project_canceled`、`invalid_notification_configuration`。判断顺序保留为 registry、隐藏配置及成员关系、项目存在、显式关闭新需求、执行状态，以及仅适用于 deferred 的通知白名单；未设置需求/执行状态字段仍按原默认允许处理。隐藏/缺席项目原因仅是内部判断结果，不允许将这些项目暴露到列表。

此诊断有意保留现有行为：隐藏项目配置为空字符串时，列表仍可能可读，但订阅/投递拒绝并给出 `empty_hidden_configuration`；全局 `canSubscribe` 现与此共用同一判断，没有合格项目时也保持 false。格式错误、非数组、无效 ID 或过长的隐藏配置继续在私站入口返回 `invalid_visibility_configuration`（HTTP 503），不返回任何项目诊断。Events list 与 owner-scoped unsubscribe 保持原授权顺序，不附加订阅/投递 scope 门禁。该诊断不代表真实原生投递已验收。

### 延后项目的需求通知

`DOT_BOARD_REQUEST_NOTIFICATION_PROJECT_IDS` 是仅在部署侧设置的 JSON 数组，值为区分大小写的精确注册项目 ID，例如 `["demo-deferred"]`。未设置、空字符串或 `[]` 不授予延后例外。输入最多 32 KiB（UTF-8），数组最多 200 个不重复的 ID。每个 ID 为 1–100 个 ASCII 字母、数字或 `_.:-`，首字符必须为字母或数字，不能含空白。无效 JSON、错误类型、对象包裹或非字符串条目、无效 ID、重复及超限均拒绝全部延后例外。即使此可选配置无效，active 项目的原有行为仍不变。源码没有内置项目 ID，请求参数不能改写或替代部署配置。

白名单中的项目仍必须存在、在配置的 audience 下对认证所有者可见、接受新需求，且执行状态为 `deferred`。`paused` 和 `canceled` 始终拒绝。该配置只影响 `project_request.created` 通知及共用的项目诊断/就绪判断，不改变 registry 执行状态、派发准入、任务控制、队列容量、资源锁、原线程绑定或回调传输策略。

订阅前、挑战完成后及每次投递均重读当前授权，使用缓存验证刷新订阅时也一样。新配置生效后，移除 ID 会拒绝后续准入；下次获准的 drain 检查到待投递项时，会撤销订阅并取消相应投递。已发送的回调无法撤回，此配置也不安装 drain 定时器；若需立即撤销存储中的订阅，应明确执行 unsubscribe。移除白名单、隐藏或删除项目后，所有者仍可取消订阅。重新加入 ID 不会复活已撤销订阅。通知白名单不能证明接收的原生聊天身份或实际送达，这些仍需原生订阅及独立的真实回执验证。

## dot 定时接续

维护者的线上部署于2026年10月9日完成了一项限定范围的两轮验收：自然定时触发后，沿同一个原生线上任务完成真实展示修复、测试、发布和结果回读；下一自然轮仅核查已完成结果，没有重复写入。这验证的是该宿主原生接续路径，不等于本地电脑派发、cloud_threads 请求/队列链、全部项目或外部回调已通过。

这条路径不要求 Sites 服务器直接调用 cloud_threads。定时检查在用户获准的 dot 会话里执行，由该会话使用实际可用的原任务和原生工具。网页刷新或复制一个配置开关不会提供这些能力；安装本仓库也不会创建或恢复定时任务。

### 用自己的 dot 配置

1. 先部署自己的私有看板，验证现有认证读写接口；用自己的账号确认一个真实未完线上任务及其原执行者。不要复制维护者的私有映射，也不要拿别的项目替代。
2. 明确授权这个任务的范围和检查时间。优先复用合适的现有检查；已取消项目、暂停的定时器继续保持原决定，除非你明确恢复。缺少定时或原任务访问能力时，准确报告缺项，不编造接口或绑定。
3. 检查先读现状：原执行者还在工作就只跟进，不重复发任务；某一步已结束但仍有获准步骤且无在途写入时，通过受支持的原生能力接续同一原任务一次。暂停、取消、完成等用户决定持续生效；UNKNOWN只读对账，不自动重发或释放。
4. 读取实际工具/产物证据，记录完成范围和剩余验收，并回读允许的状态写入。观察绑定缺失时不能自行补造，更不能声称已回写；可以在原任务保留子步骤回执，同时保持整个项目未完。

可以给自己的 dot 这段要求：

> 对我明确选定的线上任务，用我授权的定时检查读取原任务；只有没有执行者在途、仍有获准步骤时才接续同一个原执行者，并核实真实结果。保留人工停止决定，不重试发送结果不明的调用。说明本次完成什么、还缺什么，不把一个子步骤当成整个项目完成，也不据此恢复其他项目。

### 验收真实路径

- 保存自然定时触发的回执；手动“立即运行”必须标为人工触发。
- 把同一个原任务、实际执行、持久结果和回读对应起来；接单不等于已执行。
- 下一自然轮确认已完成步骤没有被重复派发或写入。
- 只宣布实际走过的路径：原生协作接续与 cloud_threads 请求派发是两条不同路径；后者需另行完成已有请求/版本/领取/执行前检查/绑定/终态协议，才能称通过。

本次更新不新增凭据、扩大权限或修改执行门禁；原 checkpoint、取消、TTL和不确定结果规则保持不变。

## 已认证的需求通道

服务端先检查项目、用户、输入上限与引用上下文，再保存需求。是否保存以服务器回执为准；浏览器草稿不代表已保存到服务器。草稿使用当前标签页的会话存储。

生命周期明确区分以下事实：

1. `received`：存储已确认保存
2. `read`：读取方明确确认已经读过这条需求
3. `accepted`、`needs_confirmation` 或 `declined`：记录实际受理判断
4. `assigned`、`in_progress` 或 `blocked`：关联任务 ID，并记录真实进展摘要
5. `completed`：完成记录附带成果证据链接

取消也只能通过允许的状态转换。读取、受理和写入事件都不会执行需求内容，必要的用户审批仍由接入宿主负责。

启用提交前，应配置项目注册表、持久化存储和已认证的 MCP 桥接。配置开关表示操作者的设置，不证明真实客户端已经连接。相应读写链路核实后，才能设置已验证标记。可选轮询间隔只是界面说明，本仓库不会自动创建轮询服务。

## 有限队列：实验性

`DOT_BOARD_QUEUE_ENABLED=true` 仅在队列存储可用时启用队列，普通模式默认关闭；合成演示会启用队列工具，用于验证状态转换，不执行真实工作。`DOT_BOARD_QUEUE_CAPACITY` 默认是 1，允许 1 到 32 的整数。这是每位用户的名额预留策略，不是宿主平台的并发配额承诺。

| MCP 工具 | 用途 |
| --- | --- |
| `list_dispatch_jobs` | 读取当前用户的队列和配置容量 |
| `enqueue_request_dispatch` | 将确切版本的已受理需求加入指定环境队列 |
| `claim_next_dispatch` | 原子预留名额，并持久化幂等派发意图 |
| `change_dispatch_priority` | 调整排队中或已安全阻塞的任务顺序 |
| `update_dispatch_execution` | 记录带版本、经过核实的执行转换 |

已受理需求可以进入队列，但浏览器提交不会自动入队。重试依靠事件 ID 与预期版本。收到重放的认领回执时，绝不能再次执行外部创建操作。

正常流程为 `queued` → `claimed` → `dispatching` → `assigned` → `running`，并明确区分阻塞、结果不明与终态。创建队列记录不等于开始执行。分派需要核实线程回执，运行状态还需要核实执行轮次。

继续队列任务时，保留原线程和原执行环境。既有任务没有经过验证的原绑定，就不能直接继续；队列不能悄悄创建替代线程。环境类型包括 `native_cloud`、`coding_environment` 和 `computer`，后两种需要宿主提供环境 ID。特殊目标 `existing_thread` 的 `id` 为 `null`，仅能继续已经核实的原线程；它不代表已知物理环境，也不能创建新线程，见[原线程契约](NATIVE_HOST_ADAPTER.md#existing-thread-opaque-bindings-continuation-only)。

优先级调整不会终止或抢占活动任务。释放名额需要执行方确认安全检查点，证明没有活动写入者。环境离线、超时或没有响应都不够。创建结果不明时，必须绑定已创建的线程，或核实确实没有创建线程。完成还需要成果证据。

## 执行宿主接口：实验性

`src/application/dispatch-host.mjs` 的 `dispatchOne` 接受注入的适配器：

- `environmentStatus(environment)` 检查指定环境
- `create(...)` 根据已保存操作 ID 创建获准的工作
- `followup(...)` 继续原先已经核实的线程

适配器必须返回可以核实的线程与环境回执；只有确实开始执行时，才提供执行轮次 ID。外部副作用发生前先持久化开始记录。结果不明时保留名额并等待核对，不自动重试创建。

仓库包含 `cloud_threads` 能力适配器源码，但没有已连接的原生工具客户端、账号凭据或已部署执行调度器。真实授权宿主仍需提供并验证连接；只有队列和适配器源码，不会让浏览器需求自动执行，见[原生宿主契约](NATIVE_HOST_ADAPTER.md)。

## Events 与 Webhook：实验性

Events 边界先校验并剥离标准请求 `params._meta`，再按原有白名单校验业务字段。元数据不授予权限，也不进入订阅身份或存储。拒绝日志及 RPC 错误仅包含白名单错误类别和经校验、规范化的回调 origin，绝不包含路径、密钥或原始异常。不带元数据的既有调用仍兼容；此修复不代表真实原生投递验收通过。详见 [元数据及安全失败诊断](sites-direct-events.md#standard-request-metadata)。

通用 Worker、候选宿主和所有者私有 Sites 的就绪条件不同。Sites 在需求 MCP 开启且中继关闭时提供直接 Events 目录，即使直接投递关闭。订阅与投递要求存储可用、`DOT_BOARD_EVENTS_ENABLED=true` 和独立核实的 [Sites 部署策略](sites-direct-events.md)。可选中继仍是独立路径；两个投递开关同时开启会拒绝服务。Sites 定时处理仍关闭。

通用 Worker 的 `DOT_BOARD_EVENTS_ENABLED=true` 在事件存储存在时启用实验性 Events 方法，默认关闭。Sites 目录发现不依赖此开关，但直接订阅和传输要求开关开启且策略经过核实。实现声明实验协议值 `2026-07-28`，该标识本身不代表与某个客户端已经兼容。

`project_request.created` 事件只包含需求、项目标识和版本，不包含需求正文。它用于通知接收方通过认证工具读取需求，不是执行指令。

实现包含 `events/list`、`events/subscribe`、`events/unsubscribe`、订阅验证、HMAC 签名、持久化事件发件箱与有限重试。订阅最长 24 小时，不支持游标回放。授权宿主必须提供 `authorizeEvent` 及两种已实现契约之一：支持 DNS 解析和固定解析地址发送的 `explicit-pinned-https-v1`，或经过独立平台出站边界验证的 `platform-managed-public-https-v1`。普通 `fetch` 函数本身不构成传输契约。[候选实现](candidate-worker.md)包含后一种传输源码，但其入口认证/授权默认拒绝，需要真实可信接入，并非取得源码即可生产使用。

两种契约均校验回调 URL 并拒绝重定向。显式固定地址路径每次检查 DNS 结果，目前仅接受公共 IPv4，拒绝私有/保留地址和 IPv6。平台管理路径依赖已实际验证的平台公网出站边界，不伪造 DNS 结果，也不接受调用方指定源站覆盖。接收方应校验签名、拒绝过期消息并按事件标识去重。投递可能重试，应按“至少一次”处理，不能假设恰好一次。

通用 Worker 提供 `scheduled` 发件箱处理入口，但平台定时触发需要单独配置；Sites 明确禁用该入口。Sites 直接路径把事件/发件箱与普通需求或候选批准放在同一事务中，再通过 `ctx.waitUntil` 即时尝试最多两项投递，总预算 25 秒、每次回调 10 秒。持久化暂时失败重试和过期认领恢复要等后续获准的处理调用，不安装调度器、轮询或自主重试。`2xx` 只证明回调收到。真实原生订阅、精确 origin 所有权、运行时/zone 证据、challenge、持久化、事件到达/聊天唤醒及获准结果回执仍须分别验收。本地夹具与模拟传输只证明实际测试的行为，详见 [Sites 完整契约](sites-direct-events.md)。

## 持久化调度门禁（实验）

启用队列功能前，按所选宿主应用完整迁移链：[Sites 使用 Drizzle](sites-deployment.zh-CN.md#3-应用完整数据库结构)，[通用/本机宿主使用普通 SQL 链](deployment.zh-CN.md#可选-d1-存储)。不要混跑，也不要只应用旧门禁迁移；缺少必要表会使能力不可用。注册表 `executionState` 支持 `active`（兼容默认值）、`paused`、`deferred`、`canceled`，非活动状态默认阻止执行。经过核实、限定到单条需求的手动授权，可允许 `deferred` 项目中特定既有任务的需求进入流程，但不会激活整个项目，不覆盖 `paused`/`canceled`，也不能代替宿主执行审批。当前受限手动检查流程只读。运行期间的用户决定还应通过 `service.control(owner, {scope, targetId, state, expectedVersion, reason})` 持久化；范围为 `project` 或 `task`，版本 `0` 表示首次建立。解除暂停必须是明确、有版本校验的恢复决定，改优先级不会解除暂停，也不会强杀现有写入者。

入队时用 `resources: [{kind, id}]` 声明独占资源，类型支持 `browser`、`foreground`、`gpu`、`repository`、`service`。标识必须由宿主核验并统一，同一资源不能因属于不同项目而使用不同别名。无资源需求的任务不被全局串行。认领事务同时预留容量和全部资源租约，同一数据库跨所有者仍互斥；不同数据库必须共用租约权威，否则不能声称全局互斥。租约超时会阻止执行前检查，绝不代表可以抢占。仅原任务核实无活跃写入者后的安全检查点或终态转换可释放租约；这些记录不会锁定操作系统或停止本地服务。

宿主可通过 `service.registerBinding(owner, {taskId, projectId, threadId, environment, verified: true, evidence})` 保存已核实的原任务映射，已有映射不可改绑。断线恢复仍回原环境、原线程，重复入队不新增任务号。原生调用前必须使用 `service.preflight(owner, job)` 或 MCP `preflight_dispatch_execution` 复核当前控制、派发版本和租约归属，失败就不执行。最后一次策略读取与外部原生调用之间不存在分布式原子事务；已开工的写入者应协作停在安全检查点，不能强杀。

上述是经授权宿主的接线能力。源码不会从自然语言历史推断私有暂停项、批量注册项目或自动写入线上策略；启用执行前须在私有运行配置中明确所有已暂停工作类别。离线用例只能证明合成回归通过。

## 既有任务需求字段

所有者私有 Sites 可通过 `GET/POST /api/tasks/:taskId/requirements`，或 `get_task_requirements`、`record_task_requirements` 保存原任务的 `goal` 与 `acceptanceCriteria`。先应用完整迁移链。更新使用独立版本 CAS 和幂等事件 ID，逐字段保留来源引用；调用宿主必须核实引用。文本不会授予执行许可、创建请求、改变任务身份或释放队列占位。原任务详情仅在 `/api/config` 返回 `requirementsEnabled` 时显示编辑器。默认 Node 服务、通用 Worker 与 candidate 未注入该服务，只展示原需求，不显示可编辑表单。保存说明不代表已自动获取聊天需求或完成派发。

## native 任务成果注记

`record_task_native_evidence` 为原任务的需求记录追加描述证据：传入当前 `expectedVersion`、已持久保存的文字编辑 `requirementVersion`（至少为 1；纯成果注记版本不能作为需求源）、原 native 任务名称、观察时间、摘要及分类成果引用。记录宿主须先核实真实来源，注记不属于平台认证的执行回执。可通过 `get_task_requirements` 或原任务详情回读；正常已认证 HTTP 入口为 `POST /api/tasks/:taskId/requirements/native-evidence`。

服务端关联原需求事件及其来源，保留全部历史，复用原所有者检查、CAS 和幂等事件。后续文字编辑保留成果注记；记录版本递增不会修改需求正文、原身份、绑定、状态、控制或队列。注记不创建请求、不赋予执行权，也不代表 cloud_threads 派发或整项验收完成。引用按文字显示；超过 20 条或 64 KiB 会明确拒绝，不截掉旧记录。

不需数据库迁移。须先部署兼容读取器再首次保存；之后回滚的版本也必须保留该读取器，旧版无法读取扩展的 JSON 记录。
