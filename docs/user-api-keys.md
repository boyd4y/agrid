# 个人 API Key

设置页可创建当前工作区的个人 API Key。任何现有 human 成员都能管理自己的 Key；列表与撤销只能操作自己的当前工作区 Key。创建后立即复制：完整密钥仅在创建响应与当前对话框中出现，关闭后无法回读。列表保留名称、前缀、创建时间和撤销状态。

Key 使用 `tab_` 前缀和32字节随机值。数据库 `user_api_keys`（迁移0022）只保存 SHA-256 摘要与归属，不保存明文或可解密的副本。创建、列表和撤销响应使用 `Cache-Control: private, no-store`。服务端日志不输出 Key，客户端不写入 localStorage。

```sh
curl "$TABDO_URL/api/tables" \
  -H "Authorization: Bearer $TABDO_API_KEY"
```

每个 Key 固定绑定创建用户和创建时所选工作区，无需额外工作区请求头。切换网页工作区不会改变已有 Key 的归属。请求中的 organizationId 不能覆盖绑定关系。所有平台 API 继续走同一 Actor/租户与业务权限检查，Key 没有独立 scopes 或缓存角色；角色改变立即影响后续请求，成员移除、用户删除或撤销 Key 后即无法继续使用。其他工作区需要分别创建 Key。

接口：

| 方法与路径 | 请求 | 响应 |
| --- | --- | --- |
| `GET /api/user/api-keys` | 当前登录/Key 身份 | `{keys:[{id,name,prefix,createdAt,revokedAt}]}` |
| `POST /api/user/api-keys` | `{name}`，去首尾空格后1–100字符 | `201 {key:{…metadata},secret}`，完整密钥仅此一次 |
| `DELETE /api/user/api-keys/:id` | 自己在当前工作区的 Key ID | `{key:{…metadata,revokedAt}}` |

撤销保留摘要记录，不返回秘密字段。格式非法的 `tab_`、已撤销或不再有成员身份的 Key 会被拒绝，即使请求同时带有效登录 cookie，也不会回退使用 cookie。现有 `agt_` 智能体凭证保持兼容。

`/api/auth/*` 是登录、会话、密码及组织认证控制面，仍使用 Better Auth 的正常认证。平台 `/api/members/invite` 支持个人 Key：`auth/key-invitation-context.ts` 用仅服务端 AsyncLocalStorage 的调用上下文，通过 Better Auth 官方 before hook 提供临时邀请上下文。只有已验证 human `tab_` 发起的该平台调用、且精确路径为 `/organization/invite-member` 时生效；没有创建数据库 session、前端 cookie 或可通过 header/body 注入的全局身份。原 organization plugin 仍执行实时成员与角色检查、邀请限制、发送钩子和正常接受流程。升级 Better Auth 时应保持对应回归测试。

该桥使用 [Better Auth 官方 hooks/context 扩展](https://better-auth.com/docs/concepts/plugins)；已核对安装版本1.7.7的 `api/to-auth-endpoints.mjs`、`api/dispatch.mjs`、`api/routes/session.mjs` 和 `plugins/organization/routes/crud-invites.mjs`，没有绕过插件直接插入邀请记录。

验证仅使用 `*_agent_test` 数据库和新建的测试工作区：`apps/server/test/routes/api-keys.test.ts` 覆盖租户归属、body覆盖拒绝、密钥不回读、实时角色/成员变化、撤销与cookie回退保护、Bearer邀请和原接受链、临时上下文不产生持久session、legacy agent兼容；`apps/client/test/browser/api-keys.mjs` 覆盖创建防重复、失败重试、一次性显示、复制调用、取消/撤销重试及紧凑中英文主题交互。没有修改用户数据库。
