# 集成、事件自动化与用户 Key 设计

> API Key 的现行模型已由迁移 0030 统一为逐表 CRUD 授权；下文个人 Key/用户身份桥接段落是历史设计，当前使用见 [API Key](user-api-keys.md)。

2026-10-14，初始只读核对形成的设计与审计基线。后续个人 API Key 和集成后端已实施；本文保留设计依据，现行接口、部署与验收事实分别见 [user-api-keys.md](./user-api-keys.md) 和 [integrations.md](./integrations.md)。初次审计表格中的缺口描述不代表后续实现仍缺失。

建议先统一“来源 → 事件 → 动作”，保留现有事务 outbox、BullMQ worker、执行 fence 和步骤凭据。邮件、Webhook、定时任务不依附虚构表格/记录；智能体动作只配置智能体与任务描述，后台消费官方 HarnessAgent，沿用真实原生工具、Skill、提问与结果保存。

## 初次审计基线（实施前）

| 层 | 当前事实 | 必须调整 |
| --- | --- | --- |
| `shared/src/automation.ts` | 三种表格触发，只有 update_field/run_agent；后者含未来 resultColumnId/resultValue | 增加来源/事件契约，通用数据命令动作；run_agent 收敛为 agentUserId+prompt，结果来自真实执行 |
| `server/src/automation/execution.ts` | run_agent 明确抛 PermanentError；update_field 与 receipt/cursor 同事务 | 接原生执行，分离短事务数据动作与长时间 SDK turn，禁止在持有 SQL 事务时等待模型 |
| schema | automations 无 organizationId/创建人；events/runs tableId/rowId 必填 | 实际 workspace/执行身份归属、可空表格/行、外部事件幂等键 |
| `automation/events.ts` | 命令事务内匹配记录快照并持久化 outbox | 保留；增加独立事件接收/匹配入口，兼容 protocol1 快照 |
| `queue/workers.ts` / lease | 每个事件先 acquireRowLease(event.rowId) | 表格事件保留按行串行；无行事件按 event/run 锁，不使用假 UUID 行 |
| `automation/crud.ts` | 工作区列表通过 innerJoin tables 取得权限与来源名称 | 直接按 rule.organizationId 过滤，来源分别解析表格、连接、收件箱、计划 |
| `auth/actor.ts` | Cookie 或旧 agt_ agent key；hashApiKey 已使用 SHA-256 | 新个人 Key 分支解析同 user+实时 membership，复用 Actor，保留旧 agent key 兼容 |
| `harness/runtime.ts` / SDK | 已有 createNativeAgent、隔离 sandbox、原生 tools/skills；SDK 实际有 generate/stream | 复用配置和执行核心，后台运行不调用本机 HTTP chat，也不写新工具循环 |

当前 API 命令、AI 工具和 MCP 的 wire name 不完全相同。数据动作应落到 camelCase command 层，显示目录再映射，避免把 snake_case 工具名当成另一个 CRUD 实现。

## 统一契约

建议 `AutomationRule` 增加 organizationId、createdByUserId、source；tableId 保留兼容且允许 null。来源用 discriminated union：

```ts
type AutomationSource =
  | { kind: "table"; tableId: string }
  | { kind: "webhook"; endpointId: string }
  | { kind: "agentmail"; connectionId: string; inboxId: string }
  | { kind: "schedule"; scheduleId: string };

type AutomationAction =
  | { type: "command"; command: DataCommandName; input: BoundCommandInput }
  | { type: "run_agent"; agentUserId: string; prompt: string };

type AutomationEventEnvelope = {
  protocol: 2;
  id: string; organizationId: string; source: AutomationSource;
  type: "row_created" | "cells_changed" | "webhook_received"
      | "message.received" | "schedule_due";
  occurredAt: string; receivedAt: string; traceId: string;
  actorUserId: string | null;
  data: Record<string, unknown>;
};
```

表格 data 保留 row/cells/before/after/changedColumnIds 和列快照，记录版本保护只应用于该记录的写回。外部事件不需要 rowVersion，不能因没有源记录而取消合法目标表操作。Webhook JSON、邮件、时间实例分别提供类型化事件字段目录；不是将 payload 任意键写成组织/执行人/目标表。

保留现有字段条件控件与 FilterCondition 用于表格。新事件条件用 `path + operator + value`，操作符复用现有过滤语义，路径来自对应 source 的字段描述；无需伪造 column UUID。字符串、日期、数值、列表均按实际事件类型校验。

动作绑定值建议为 literal / event-path / previous-step-output 三种。字面量保留 CellValue 类型；引用整个值时保持原类型，缺失字段明确失败，不把对象静默转成字符串；文本模板仅用于 prompt 等文本字段。通过安全路径读取 JSON，不执行用户 JS/eval，不把事件中的 organizationId/actorId 当成权限输入。

旧 `update_field` 在读取时映射为 updateCells，目标 row 来自表格事件；不强制改已有记录和快照。旧 run_agent 的 agentUserId+prompt 可正常迁入；已保存 resultColumnId/resultValue 不是实际 SDK 结果，不能自动视为已执行写回。编辑时移除该旧占位设置并提示，若用户需要结果写回，应明确增加后续 command 动作绑定真实输出。

## 数据动作覆盖与复用

数据动作目录集中在 shared 的命令元信息注册表，包含共享 schema、名称、分组、目标类型与字段编辑描述。服务器 dispatch 到已存在命令/事务 helper；前端渲染同一描述，值编辑复用 FormFieldControl/记录选择器/文件与人员控件，不为每种来源复制一套编辑器。

| 分组 | 应提供的现有能力 |
| --- | --- |
| 记录 | addRow、updateCell/updateCells、deleteRow、setStatus、moveCard；查询 getRow/queryRows 供后续动作绑定 |
| 字段 | addColumn、updateColumn、deleteColumn、reorderColumns |
| 关联 | setRelation、addRelation、removeRelation；queryRelationRecords |
| 批量 | batchAddRows、batchUpdateRows、batchDeleteRows、batchAddColumns、batchUpdateColumns、batchDeleteColumns、batchSetRelations、batchAddRelations、batchRemoveRelations |

“全部数据动作”指上述真实记录/字段/关联及批量语义，不用一个允许任意内部函数名的入口冒充。共享 CommandInputMap 仍做编译契约；已经存在的 Zod schema直接复用，缺失的 schema 迁至 shared 后由 UI/tool/MCP共同引用。字段公式、依赖、双向关联、文件同字段引用、租户和版本检查都由现有命令执行。

必须抽出/复用事务 helper，使数据库动作、步骤 receipt、cursor 处于同一事务；直接在现有 executeNext 事务里调用另一个 `db.transaction` 命令会产生独立提交，崩溃后重复写入。修改多行时使用原有批量稳定锁序。update_field 的旧行保护继续有效，外部命令按目标记录实际版本执行。

现有自动化写回用 skipAutomation 避免自触发循环。内部执行上下文保留此策略，API/事件不能自行设置 skipAutomation。若后续需要自动化互相触发，应另做可解释的 trace 传播策略，不隐式开启无限连锁。

## AgentMail 连接与收信

首次覆盖连接校验、收件箱选择、创建收信 webhook 和邮件事件触发；不因为支持收信就宣传发送、回复或附件自动导入。AgentMail 的 `POST /v0/webhooks` 使用 Bearer API Key，创建请求明确发送 `event_types:["message.received"]`；可带 inbox_ids（官方最多10）。响应 webhook_id/secret 只保存在服务端。pod/inbox scoped key 需对应 scoped endpoint，不能假称所有 key 均能调用组织级 API。[官方创建契约](https://docs.agentmail.to/api-reference/webhooks/create)、[scoped webhook 说明](https://docs.agentmail.to/webhooks-overview)。

连接接口建议：POST/GET/PATCH/DELETE `/api/integrations`，POST `/:id/test`，GET `/:id/inboxes`，POST `/:id/webhooks`。管理连接复用现有 workspace 管理身份；读接口只返回 id/provider/name/state/邮箱摘要/最近事件或错误，绝不回传 API key、signing secret 或加密密文。首次连接失败保留待修复配置而不是展示已连接。远端创建采用稳定 client_id 及记录状态，处理创建成功但本地保存失败后的核对；不能在 SQL 事务里等待远端注册。

接收 URL `/api/webhooks/agentmail/:endpointId` 的 endpointId 仅定位服务端配置，不作认证。先限 raw body，再用官方 Svix Webhook.verify 验证 `svix-id`、`svix-timestamp`、`svix-signature`，通过后才解析数据。原始字节不可先 JSON.stringify；重复投递沿用 svix-id。签名时间容差交由官方验证库，不另写密码学实现。[官方验证文档](https://docs.agentmail.to/webhook-verification)。

验证后，在一个短事务里：写入唯一接收记录 → 来源/收件箱校验 → 匹配规则快照 → 创建事件/run/outbox。提交成功返回200（重复合法投递也200）；数据库失败返回5xx让发送方重投，不能先回复成功再只放内存。Redis故障不妨碍持久接收，现有 relay 稍后发布。

用 `(endpointId, svix-id)` 去重传输投递；同时按连接、事件类型、inbox_id/message_id 记录逻辑幂等键，避免同一邮箱重新注册 endpoint 后再次处理同一邮件。未知事件可持久记为 ignored 并200，不误当 received。AgentMail外部 organization_id 绝不是 tabdo workspace ID。

邮件归一化以官方 event reference为契约。文档示例存在 `from` 与 `from_` 不一致，adapter兼容归一为 senders:string[]，实测 fixture分别覆盖；保留 message_id/inbox_id/thread_id、subject、text/html、时间与附件元信息。纯 HTML 邮件可能没有 text；payload 达1MB时正文可能被省略，worker用受控的官方 message API 按已验证邮箱/message ID补取，绝不 fetch 用户 payload 中任意 URL。HTML只作受限内容转换，不渲染可执行 HTML；附件是元信息，不伪装成已传入当前 text-only Harness 的 FilePart。[官方 received event](https://docs.agentmail.to/api-reference/webhooks/events/message-received)、[正文与附件边界](https://docs.agentmail.to/events)、[payload 大小说明](https://docs.agentmail.to/webhooks-overview)。

事件文本进入 agent 作为外部数据，而用户保存的 prompt 是任务要求；连接密钥不放在 prompt、AGENTS.md、工具结果或 sandbox 环境。将来邮件发送工具如需接入，使用宿主 adapter 注入密钥，不向模型公开凭证。

## 通用 Webhook

入站 webhook 是独立来源，复用 event matching/outbox，而非必须先选一张表。创建时生成 endpointId 与高熵接收 token；token 仅一次显示、服务端hash保存，调用方通过 Authorization Bearer 发送。仅知道 URL 不能伪造事件。AgentMail端点仍必须验Svix签名，不降级为Bearer。

支持 JSON payload，`Idempotency-Key` 可选：有键时 `(endpointId,key)` 唯一；没有时每次请求是独立事件，UI/文档明确不能保证来源重投去重。payload不能选择 rule/组织/执行身份。实际source绑定配置决定匹配规则。需要标准签名供应商时，新增verification adapter及加密signing secret，与通用接收/执行层复用，不复制整个自动化引擎。

暂停 endpoint 后拒绝新请求且不入队，撤销 token立即失效；与“暂停规则但继续接收连接事件”区分。历史成功接收、匹配与执行错误可从同一运行记录核对。本阶段不引入任意 outbound HTTP 动作或跟随请求给出的回调 URL。

## 定时来源与后台原生执行

同行常见契约是 schedule+assistant+input，并区分每次新会话和固定会话的执行。LangSmith官方有 stateless / stateful cron；tabdo第一版建议每次触发新线程，保留结果供查看，避免把昨天的未完成任务自动接到今天的新计划。此处借鉴产品形态，不换 SDK。[官方 cron 说明](https://docs.langchain.com/langsmith/cron-jobs)。

时间配置保存 cron（首版标准5字段）、IANA timezone、nextRunAt UTC、可选单次 runAt。UI使用当地日常/每周控件生成表达式，并展示时区与后续3次实际时间；高级cron与日常表单共用同schema。日期运算使用成熟cron解析器的tz能力，不写手工 offset/DST 算法，春季跳时与秋季重叠必须用真实预览/回归明确行为。

推荐在现有 worker/relay 常驻进程增加短 `claimDueSchedules` tick：按 nextRunAt `FOR UPDATE SKIP LOCKED`，原子创建 occurrence/event/outbox并推进nextRunAt。唯一键 `(ruleId,ruleVersion,scheduledForUTC)` 防多实例重复。SQL保存计划游标，BullMQ仍承担执行与并发，不是让浏览器计时；Redis恢复无需重建一个不透明计划仓库。停机错过实例首版采用可见的合并补发一次策略，记录 missedCount/原定时间，正常多个到期时间仍是不同事件；此为调度策略，不是 agent任务暂停规则。

BullMQ也提供 upsertJobScheduler 与tz；但官方说明队列繁忙时下一实例生成依赖前一job开始，实际触发频率可能下降。若选择该方式，仍须SQL occurrence ledger与重建对账。当前建议SQL计划账本更符合已经存在的outbox；不同时维护两套权威定时器。[BullMQ scheduler](https://docs.bullmq.io/guide/job-schedulers/)、[时区配置](https://docs.bullmq.io/guide/job-schedulers/repeat-options)。

后台动作从真实用户执行身份生成 Actor，加载同一 profile/skills/platform-disabledTools/模型配置，创建独立线程和原生session；事件上下文以文本或runtimeContext附加。抽出 transport无关 `runNativeTurn`，chat writer 和worker persistence是不同sink，同一 core调用真实SDK stream并消费到底，记录输出与原生history。run_agent界面始终只用“智能体+任务描述”，表格/邮件/cron复用；无需新结果占位值。

官方 HarnessAgent已有 generate/stream、原生历史、stop/detach/opaque resume，没有内置通用cron或脱离进程的可靠队列。可由常驻BullMQworker运行。官方 `@ai-sdk/workflow-harness` 提供durable Workflow DevKit辅助，需要额外runtime；现项目未安装，不宣称已具备。第一版不引入semantic step stopWhen或自建agent loop；以后需跨进程可靠长turn可单独验证time-slice集成。[官方 HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)、[官方 Workflow Utilities](https://ai-sdk.dev/docs/ai-sdk-harnesses/workflow-utilities)。

长动作先在短事务保存 `(automationRunId,step)` 到原生thread/run关联，再放开事务执行。worker重复投递只核对同一关联，不创建另一个原生turn。原生已完成则提交receipt/cursor；尚未发起模型的启动失败可重试；实际已开始且完整resume可沿官方恢复；状态不完整则如实记录unknown/保存问题，不用旧checkpoint重放写入。现有chat保存/lease逻辑应复用，不另建“目标完成/计划完成”门禁。

原生提问时记录真正waiting-input，运行Sheet显示对应问题和对话入口，答案沿SDK官方continuation回同一原生Run；不能后台自动造答案或当作completed。队列释放长等待槽，收到答案后再派发；需要等待的人由执行身份/线程所有者决定。后台结果线程仍遵循现有私人对话权限，团队共享运行摘要不可泄漏其他人的私有历史。

## 执行身份、凭证与个人 API Key

新rule保存createdByUserId，Webhook/cron使用该明确身份；执行前重新查询membership，移除成员立即不再代其写入。选择的agent也必须仍在同workspace。表格事件继续用原有actorId；旧匿名表单事件保留既有数据动作语义，但不能凭空选择管理员作为run_agent执行人。旧rule首次配置后台动作时必须补真实执行身份，不静默授权某个owner。修改规则/连接权限沿用现有角色，不做另一套动作scope。

连接API key、Svix secret和以后签名密钥必须可解密供宿主使用：AES-256-GCM envelope，随机nonce、认证tag、keyId，AAD绑定workspace/connection/provider。主密钥从部署secret manager或显式32-byte环境keyring加载，不复用BetterAuth secret，不进数据库/日志/frontend。轮转时新写用active key，旧key保留到密文重加密结束；无密钥明确连接不可用，不明文fallback。服务密钥与tabdo个人Key完全分开。

个人Key已实施（0022）：生成32-byte随机token，使用 `tab_` 前缀，原文仅创建响应显示一次；DB保存SHA-256摘要、userId、organizationId、name、prefix、createdAt、revokedAt，不存可恢复密文，不增加scopes。接口GET/POST/DELETE `/api/user/api-keys` 只操作当前用户在当前工作区的Key；设置页提供创建、一次性复制、摘要列表和撤销。

Bearer tab_在resolveActor内按hash查未撤销Key，实时join该用户在Key绑定workspace的membership，返回相同Actor，role不缓存。Key固定绑定创建时的工作区，不要求organization header，客户端body.organizationId仍忽略。角色改变、Member移除、用户删除和Key撤销立即影响后续请求，agt_保留兼容。平台API执行相同业务权限，私人线程仍以同userId隔离。/members/invite通过限定服务端调用上下文复用Better Auth完整邀请链，不生成持久session或cookie；登录/会话控制面 /api/auth/* 不接受个人Key。个人Key不经AgentMail连接接口管理，也不作为Webhook接收token复用。实现与使用见 [user-api-keys.md](./user-api-keys.md)。

## 必要迁移与兼容路线

文件存储使用0021，个人API Key已使用0022；其余来源/集成迁移由root继续分配。

1. `user_api_keys`（0022已实施）：user与workspace FK、hash唯一、摘要字段、revokedAt；不存raw key、不增加scope表。
2. `integration_connections` / `webhook_endpoints`：workspace FK、provider/config/status/createdBy、encrypted credential与remote webhook ID；接收token hash与Svix加密secret独立字段。普通GET projection明确不选择secret列。
3. `integration_deliveries`：endpoint/connection、deliveryId逻辑dedupe key、规范payload、receivedAt/status/error；唯一传输和逻辑键，保留最小必要事件内容，支持配置保留期。
4. automations：organizationId从现有tables回填并NOT NULL，source现有映射table；tableId变nullable；createdBy新规则填，旧规则允许null到明确配置；既有trigger/actions兼容读取。
5. automationEvents/runs：table/row/version相关字段nullable，source/type/dedupeKey/actor context；已有protocol1数据与receipt/fence保留。runs增加agentThreadId/agentRunId或单独step execution关联，步骤唯一避免重复turn。
6. `automation_schedules`：rule唯一、cron/timezone/nextRunAt/version及enabled；occurrence唯一键落delivery/event ledger，无需第二份本地定时服务。

组织规则列表直接按organizationId取，left join来源摘要，旧table列表过滤source.kind=table。旧records/event/runs不被新source校验错误取消。新queue payload可继续eventId+generation，事件snapshot protocol2用于分流；旧protocol1照原行为处理，不重放已完成receipt。

## 页面与并行分工

创建第一步来源选择提供“表格、收件邮箱、Webhook、定时”，之后各来源简短配置与同一动作区。列表卡片由统一summary函数生成三行：来源名称、触发摘要、动作摘要。表格显示字段/状态，邮件显示连接与邮箱，Webhook显示端点名，schedule显示可读时刻与时区；run_agent显示智能体和任务描述短摘要，多动作显示首个+剩余数量。启用与运行记录继续统一，不能全部显示一个表格名或原始cron技术串。

| 实施块 | 独占范围建议 | 前置 |
| --- | --- | --- |
| A 个人Key/连接/签名接收 | auth actor/key service、integration routes/adapters、crypto、接收tests | root批准schema/shared契约；迁移集中由一人写 |
| B 通用自动化与调度 | shared automation/contracts、automation CRUD/events/execution、queue schedule | A event envelope确定；命令事务helpers重用 |
| C 原生后台执行 | transport无关native core、automation agent关联/continuation | B action/step关联契约；不改原生工具或任务门禁 |
| D 配置界面/摘要 | integrations/settings、AutomationDetailPage/Panel/卡片 | A/B API形状先落；共享FormFieldControl/descriptor |
| E 精准回归 | 隔离API/Redis/DB和provider/Svix/AgentMail fixtures | 功能分别就绪后测试；不冒充真实provider连接 |

shared/DB schema/主route挂载由root或指定单一owner合并；不能几个worker同时补相同migration编号。先落个人Key独立可验收功能，再通用source+data动作；AgentMail接收/cron实例可并行，最后接run_agent与UI完整联测。没有真实凭证时协议fixture足以验证签名/去重/执行契约，真实AgentMail收信与远程Codex/Claude仍列独立待验收，不挡本地Pi开发。

## 精准验收

- 个人Key与Cookie同用户同workspace返回一致结果；body伪组织无效、跨workspace membership拒绝、撤销/移除成员即时失效、列表无hash/raw、原文一次返回。
- Svix官方签名原始body通过，缺失/改字节/超时/错secret拒绝；同delivery多实例仅一个event/outbox，Redis停机仍持久200并恢复执行；数据库失败不ACK。
- AgentMail不同邮箱隔离、未知事件ignored、text缺失/HTML-only/1MB省略正文受控补取、attachment仅metadata、连接密钥不出现在API/history/provider请求。
- 通用Webhook Bearer/幂等键/无键语义，payload不能改执行身份；不创建假table/row。
- schedule真实timezone计算、下一次预览、DST、双scheduler原子claim、错过实例合并、修改/停用后不触发旧版本。
- 每种数据动作调用真实命令：跨租户/错误字段/文件引用拒绝，双向关联与formula一致，batch失败原子回滚，receipt与副作用同步，worker重复不重复添加或删除。
- 原生Pi实际provider fixture验证后台读写、Skill、平台disable、真实问题/答案续接，worker重投绑定同nativeRun，不引入普通chat fallback或平台goal工具。远程执行只按真实凭证验收结果记录。
