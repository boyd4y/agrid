# API Key

For external agent connections, see [OpenAPI and Connect Agents](api/openapi-and-plugins.md).

统一入口为「设置 → API Key」。工作区所有者或管理员可以创建、编辑和删除 Key；每张表格一行，分别勾选**读取、新增、更新、删除**。未勾选的操作一律拒绝，新增表格不会自动加入。权限覆盖表内全部记录，不再区分“个人 Key”和“站点 Key”。

Key 可用于 GraphQL、表格 REST 接口和 `@tabdo/sdk`，统一使用 `Authorization: Bearer KEY`。例如，同一 Key 可以读取商品表、仅向线索表新增记录，同时禁止修改或删除商品。写权限不自动包含读权限。Key 用于外部网站时，访问者可以看到它，因此只授予网站需要的权限。

Key 属于当前工作区，不冒充创建用户；修改权限或删除后，下一次请求立即生效。管理集成、邀请成员、运行智能体、修改表结构和管理其他 Key 仍需要登录会话。原生 `agt_` 智能体身份不受影响。

创建后仅显示一次完整 Key，关闭后无法回读。数据库只保存 SHA-256 摘要、名称、前缀和创建信息。列表与管理响应禁止缓存，客户端不写入 localStorage；删除直接移除记录。

## 管理接口

管理接口使用登录会话，路径保持兼容：

| 方法 | 路径 | 参数 |
|---|---|---|
| GET | `/api/user/api-keys` | 当前工作区 |
| POST | `/api/user/api-keys` | `{ name, permissions }` |
| PATCH | `/api/user/api-keys/:id` | `{ name, permissions }` |
| DELETE | `/api/user/api-keys/:id` | Key ID |

每条 `permissions` 包含 `tableId` 和独立的 `canRead`、`canCreate`、`canUpdate`、`canDelete` 布尔值。不允许跨工作区授权；每张已选表格至少有一项权限。

表级 CRUD 是记录、正文、附件和表视图的唯一授权来源。正文读取/写入沿用 Read/Create/Update；站点视图读取沿用 Read，配置和显式发布沿用 Update，不另设正文或博客权限。

Key 的身份标识、哈希、日历与日程授权沿用原有契约。完整用法见 [表格 API 与 SDK](api/site-api.md)；迁移影响见[内部迁移记录](unified-record-site-migration.md)。

回归覆盖真实登录、权限独立性、跨组织拒绝、Key 不回读、即时编辑/删除、关联记录删除保护、SDK CRUD、REST/命令一致性和旧 Key 迁移。浏览器验证统一 Tab、逐表勾选、编辑持久化、窄屏/明暗主题以及 HTML 接入。
