# AgentMail 与通用 Webhook

入口为「设置 → AgentMail」与「设置 → Webhook」两个独立tab，API Key 在「设置 → API Key」。设置是同一面板内的左侧带图标垂直导航与右侧内容分区，只保留常规、API Key、AgentMail和Webhook。切换、刷新与浏览器返回保留当前页签；旧 `/app/integrations` 和 `?tab=integrations` 兼容跳转到 `/app/settings?tab=agentmail`。

两类集成均无需搜索或内部tabs，列表、标题说明和操作区使用统一间距。首次使用显示紧凑空态和唯一创建入口，加载失败提供重试。新增、查看与编辑均使用居中Dialog，不使用Sheet。首次AgentMail连接依次填写凭证、验证并选择邮箱、完成；连接测试失败后保留已有连接，重试不重复创建。Webhook创建完成显示接收地址和一次性令牌；编辑不恢复令牌。操作位于固定底部，正文超高时独立滚动。

工作区成员可以查看连接和接收地址，human owner/admin 可以管理连接与端点。管理请求使用登录 Cookie 的实时工作区权限；API Key 仅开放按表授权的记录 CRUD，不用于管理集成；外部投递只使用端点自己的 Bearer token 或 Svix 签名。来自外部的 organizationId、actorId、URL 都不会变成宿主权限或网络请求地址。

## 部署

配置 `INTEGRATION_ENCRYPTION_KEY` 为32字节随机值的标准 Base64 或64位HEX。API与worker必须使用同一个值，可用环境secret manager注入。未配置或格式不正确时，AgentMail凭证不能保存/解密，返回503，没有明文fallback。通用Webhook不依赖该加密密钥。

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

数据库保存AES-256-GCM envelope，nonce随机，tag验证完整性，AAD绑定workspace、对象ID和用途；AgentMail API key与Svix签名secret分别加密，普通读接口不返回密文、原文或remote webhook ID。单部署密钥的keyId写在envelope中，用于检测配置变化。此版本没有自动轮转/重加密：更换部署密钥前应在旧密钥仍可用时安排受控重加密；否则需重新设置连接凭证并重新注册邮件Webhook。不要仅替换环境变量并认为旧密文已迁移。

`WEBHOOK_PUBLIC_URL` 是接收服务的公网基础URL，不含 `/api/webhooks`；未配置时使用 `APP_URL`。AgentMail需要能访问这个地址，生产使用稳定HTTPS，本地可明确配置开发隧道。客户端请求中的Host/Origin不会覆盖它。若更换公网地址，已有远端注册仍指向旧地址，应重新注册。默认接收体上限2MiB，可用 `WEBHOOK_MAX_BODY_BYTES` 调整（1KiB–16MiB）；实际流字节始终受限，含chunked请求，不信任Content-Length。

schema属于0023，迁移由项目正常部署流程执行。开发验收仅迁移隔离 `*_agent_test` 数据库，不自动操作用户数据库。

## 连接和端点

| 接口 | 行为 |
| --- | --- |
| `GET /api/integrations` | `{connections,canManage}`，仅当前工作区metadata |
| `POST /api/integrations` | `{provider:"agentmail",name,apiKey}` → `201 {connection}`；初始unverified |
| `PATCH /api/integrations/:id` | `{name?,apiKey?,enabled?}`，更换凭证回到unverified |
| `POST /api/integrations/:id/test` | 使用真实官方收件箱接口校验，返回`{connection,ok}`和connected/error状态 |
| `GET /api/integrations/:id/inboxes` | `{inboxes:[{inboxId,address,displayName?}]}`，跟随官方分页 |
| `POST /api/integrations/:id/webhooks` | `{inboxIds}`，1–10个可访问邮箱 → `201 {endpoint}` |
| `DELETE /api/integrations/:id` | 先本地停用，删除该连接的远端注册后软删除本地连接/端点 |
| `GET /api/webhook-endpoints` | `{endpoints,canManage}`，当前工作区endpoint metadata |
| `POST /api/webhook-endpoints` | `{name}` → `201 {endpoint,token}`；generic token仅此一次 |
| `PATCH /api/webhook-endpoints/:id` | `{name?,enabled?}`；邮件端点同步官方enabled |
| `DELETE /api/webhook-endpoints/:id` | 先本地禁用/撤销；邮件端点同时删除官方远端注册 |

AgentMail首次注册使用固定 `https://api.agentmail.to/v0/webhooks`，明确发送 `event_types:["message.received"]`、`inbox_ids`和稳定本地`client_id`。此版本使用组织级Webhook API；只允许pod/inbox级Webhook的scoped key不能假称支持，会显示真实权限错误，应使用能管理组织Webhook且访问所选邮箱的凭证。API访问仅固定官方origin，禁止redirect；上游错误不透传response body，避免凭证或其他敏感字段反射。

端点状态为pending/active/error。远端失败留下真实失败记录和简短lastError；本地禁用先于远端操作生效。删除或切换远端失败时不丢掉可重试句柄，保留disabled/error连接或端点；远端DELETE的404视为已删除。连接级enabled会同步它现有邮件端点的远端enabled；只重新开启本地仍启用且active的端点。多个远端资源没有跨系统事务，失败可能已更新部分远端资源，重试会再次对齐目标状态。创建若远端已返回ID而本地提交失败，会尝试删除该注册；若响应前网络中断，无法知道远端是否创建成功，可用保留的client_id在AgentMail控制台核对。

通用端点返回 `receiveUrl=/api/webhooks/:id`；邮件端点返回 `/api/webhooks/agentmail/:id`。端点ID仅用于定位，不是认证秘密。generic token为32字节随机`hook_…`，仅存SHA-256摘要。无需登录Cookie即可投递合法JSON（对象、数组或标量都可），使用 `Authorization: Bearer hook_…`；可选 `Idempotency-Key` 最多300字符，重复key保留首次已接受投递。没有key时每次请求视为新事件。停用立即拒绝，删除后token不可恢复。

## 接收、落盘与后台执行

邮件先限制原始body，再用官方`svix`的`Webhook.verify(Buffer,headers)`验证`svix-id`、`svix-timestamp`、`svix-signature`和官方时间容差；验证后才解析JSON。仅`message.received`触发收信自动化，其他合法签名事件记为ignored。邮箱必须属于注册时的inboxIds，否则403且不落delivery。

同事务内重新检查连接/端点未停用，按 `(endpointId,dedupeKey)` 去重，再按 `(connectionId,[eventType,inboxId,messageId])` 逻辑去重。不同注册不会重复执行同一邮件。delivery、规则匹配、automation event、run与outbox在同一个数据库事务提交后才200 ACK。没有匹配规则仍保留ignored delivery。数据库提交失败返回500，发送方可用同一个投递ID重试；Redis和模型不参与ACK，后台沿用既有durable outbox/BullMQ/Harness执行链。

数据绑定：通用事件使用 `payload`，邮件使用 `message`。邮件规范字段为`messageId/inboxId/threadId/senders:string[]/to:string[]/cc/replyTo/subject/preview/text/html/receivedAt/attachments`，附件仅`attachmentId/filename/contentType/size`元信息。兼容官方示例的`from`和`from_`，不保留任意附件下载URL或外部organization_id。HTML-only邮件保留html并让text为null，不伪造文本，不在界面执行邮件HTML。

两种正文都缺失时标记`bodyMissing=true`，接收阶段不为GET邮件阻塞ACK；条件依赖未知正文时先保留候选规则，完整条件在补取后求值，不把缺失正文当成false而漏排队。worker在绑定上下文前调用`hydrateAgentMailEvent`，按已验证的source+inbox/message ID、实时启用连接，从固定官方消息API补取，并再次检查返回身份；网络失败抛错供后台重试。附件元信息不表示附件已下载、入库或送入原生Harness，现已提供已连接 AgentMail 收件箱的发送/回复服务，按组织连接及官方收件箱列表校验权限；不支持附件发送，自动化动作和 agent 工具尚未接入。出站协议 fixture 通过不等于真实邮箱验收。

## 验证

`apps/server/test/routes/integrations.test.ts` 使用真实本地HTTP协议fixture和官方Svix签名，覆盖官方请求格式、分页、AESGCM/AAD、无密钥拒绝、secret不回传、tenant/role隔离、签名字节/过期、订阅邮箱、并发与跨注册去重、HTML-only/后台补正文、generic认证/幂等/体积上限、远端停用删除失败后的本地保护与重试。仅测试组织上的临时DB trigger在最后outbox insert制造失败，证明delivery/event/run完整回滚，失败不ACK且重试成功。没有调用真实AgentMail凭证、邮箱、用户数据库或模型。

官方依据：[创建Webhook](https://docs.agentmail.to/api-reference/webhooks/create)、[更新enabled](https://docs.agentmail.to/api-reference/webhooks/update)、[删除Webhook](https://docs.agentmail.to/api-reference/webhooks/delete)、[收件箱分页](https://docs.agentmail.to/api-reference/inboxes/list)、[事件契约](https://docs.agentmail.to/api-reference/webhooks/events/message-received)、[原始body验签](https://docs.agentmail.to/webhook-verification)、[正文省略边界](https://docs.agentmail.to/webhooks-overview)。

```sh
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test \
  pnpm --filter @tabdo/server exec tsx --test test/routes/integrations.test.ts
```
