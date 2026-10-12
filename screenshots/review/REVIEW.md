# PM + Design Review — Table (docs / MCP / skill 交付后)

评审日期：2026-10-11 · 截图目录：`screenshots/review/`

## 成功标准核对

| 项 | 状态 |
|----|------|
| 公开 `/docs` Notion 风文档站（免登录） | ✅ `02-docs` … `05-docs-mcp` |
| 营销导航含「文档」 | ✅ 顶栏 + 页脚 |
| `/app` 无博客入口 | ✅ 侧栏仅工作区/表格/成员/设置 |
| MCP `@table/mcp` 命令层 1:1 | ✅ `mcp/` + `/docs/mcp` |
| Agent Skill `skills/table-ops` | ✅ |
| README 已述 docs/MCP/skill | ✅ |

## 截图清单

### 公开站
- `01-home.png` — 首页（CTA「阅读文档」）
- `02-docs.png` — 文档首页
- `03-docs-introduction.png` — 简介
- `04-docs-commands.png` — 命令层 API
- `05-docs-mcp.png` — MCP
- `06-blog.png` — 博客（公开）
- `07-login.png` / `08-signup.png` — 认证

### 工作台（demo@agrid.app）
- `09-app-home.png` — 工作区首页
- `10-app-tables.png` — 表格列表
- `11-app-table-detail.png` — 表格视图
- `12-app-kanban.png` — 看板（修复后重拍）
- `12b-app-ai-drawer.png` — AI 抽屉
- `13-app-members.png` — 成员
- `14-app-settings.png` — 设置
- `fix-docs-mobile.png` / `fix-docs-sidebar.png` — 文档修复后

### P1 修复后重拍
- `p1-01-home.png` / `p1-01b-home-cta.png` — 首页 + 「登录后进入」CTA
- `p1-02-docs-search.png` — Docs 全文搜索（查 MCP）
- `p1-10-app-tables.png` — 无「新表格 2/3」噪音
- `p1-11-table-filters-collapsed.png` / `p1-11b-filters-expanded.png` — 筛选默认折叠
- `p1-13-members-empty.png` — 成员空态插画

## 问题与处理

### P0 / 已修
1. **文档侧栏小屏不可用** → `DocsMobileNav` Select。
2. **侧栏分区「AGENT」** → 「智能体」。
3. **Vite 仅绑 `[::1]`** → `server.host: true` + CLI `--host 0.0.0.0`。
4. **看板截图未切到看板态** → `data-testid=view-kanban` + 重拍。

### P1 / 本轮已全部修复
5. **种子空「新表格 2/3」噪音** → DB 已删；`seedDemoUser` 幂等清 `新表格%` 占位表。
6. **筛选条默认展开** → `FilterBar` 默认折叠，徽标显示条件数，可展开。
7. **成员页空态弱** → `MembersEmpty` 插画 + CTA（邀请员工 / 创建智能体）；仅 Demo User 时展示。
8. **Docs 无全文搜索** → 侧栏/移动端 `searchDocs` + 结果下拉。
9. **MCP `server.tool` 弃用** → 全部迁 `registerTool`。
10. **首页「打开工作台」** → 文案改为「登录后进入」，链到 `/login`。

### 设计观察（保持）
- Notion 色板 / 软插画在营销与登录侧一致。
- 文档排版：callout、代码块、表格清晰，适合对外。
- 工作台左栏信息架构清楚；AI 抽屉与成员同权叙事对齐产品定位。

## 结论

Docs + MCP + Skill 交付达标；P0/P1 评审项均已关闭。关键页已按 P1 重拍。
