# tabdo 迭代记录

用户要求逐项实现，持续迭代；每项以可运行功能和验证记录为完成条件。未完成项不能用 UI 占位或假运行状态标记完成。

## 0. 历史聊天执行链路收尾（升级前记录）

- [x] 使用 AI SDK 原生工具循环、步骤／工具生命周期回调和 timeout；没有自建执行循环。
- [x] 工具结束后继续模型回复，最后一步留给文字收尾；空回复／超时明确说明并保存已有结果。
- [x] 标准 assistant-ui Thread／Composer／ScrollToBottom 保留，修复箭头和运行阶段提示。
- [x] 23 项聊天回归通过，独立测试数据库；浏览器验证事件提示、结束清理和 dark/light 滚动按钮。
- 以上是升级前 `streamText` 的验证记录。当前 `/api/chat` 已使用第 3 项的原生 runtime；旧辅助函数测试不作为原生链路证据。

## 1. 独立自动化

- [x] 自动化与表格并列；工作区直接列出自动化、新建先选择来源，编辑和运行记录有独立路由。
- [x] 表格卡片中移除自动化入口，旧表格自动化链接兼容跳转。
- [x] 来源权限隔离、统一删除确认、数据变更刷新；服务端真实数据库用例通过。
- [x] 浏览器完整走通新建、编辑、删除及旧链接跳转。

## 2. 报告 / Dashboard

- [x] 工作区导航、header 和列表/新建/编辑/预览路由，持久化页面和多组件配置。
- [x] 抽象表单/报告共用 BuilderLayout：组件栏、画布、设置栏。真实图表、指标、文字组件。
- [x] 数据库真实聚合，NULL-aware count/sum/average、字段和租户校验、200分组截断、全量记录计数。
- [x] 乐观版本锁及 tool 编辑事务行锁，支持数据变更刷新、撤销、删除、友好错误与全局 Sonner toast。
- [x] 12列 Dashboard：拖动、缩放、共享位置和宽高配置；窄屏纵向展示不会改写桌面布局。
- [x] 图表11种：柱状、条形、折线、面积、饼图、环形、雷达、径向条形、散点、漏斗、矩形树图。
- [x] UI 与 tool 使用同一布局 schema；set_report_layout 原子调整全部位置，越界/重叠/遗漏拒绝。
- [x] 服务端11项报告测试通过，覆盖真实聚合、持久化、并发工具编辑、布局、全部图表类型与权限。
- [x] Dashboard 浏览器缩放/拖拽/刷新/11种图表/dark-light完整回归；修复拖拽占位框同步和碰撞位移，尺寸仅在画布操作。
- [x] 表单共用 BuilderLayout 的浏览器回归。

## 3. 原生 HarnessAgent

- [x] 原生执行基础设施：官方 adapter 工厂，本地 Pi 工具循环/文字收尾/Skill与AGENTS.md/跨进程日志恢复；12项测试通过（`server/test/harness`）。
- [x] 数据库租约与 fence 接入发送入口：20请求抢占唯一持有人、受保护操作行锁、过期接管、消息与检查点原子提交/回滚。
- [x] 官方 `@ai-sdk/harness` 与对应 runtime adapter 接入 `/api/chat`，移除普通模型调用和离线规则回落。
- [ ] 本地 + sandbox 两种运行环境；显式配置、明确不支持／未配置错误，禁止静默回落成普通 chat agent。
- [x] 本地官方 Pi host runtime 接入，实际工具循环、文件和原生日志恢复验证；sandbox 官方创建/恢复接入，真实远程执行验收仍待完成。
- [x] 本地工作区按私有对话隔离，原生 session resume state 持久化；新 agent/sandbox 从原生日志续接，不重放 UI 历史。
- [x] 并发发送原子 claim／lease、heartbeat、重复输入/分支校验、停止和释放；缺少最新检查点时拒绝重放工具，要求核对并新建对话。
- [x] 确定未调用 Pi 原生 turn 的启动失败/停止原子保存失败说明和下一用户边界，旧 opaque/工作区原样保留；首次历史逐项验证服务端未执行证明。真实 SDK 空 stop 状态、首轮/已有会话 retry、启动中停止、未完成会话继续无重放、伪造证明及损坏状态拒绝已验证；已进入执行或未知 bridge 不提供豁免。
- [x] 当前页面上下文注入 instructions；AGENTS.md 由人设内部生成；plan/goal 持久化，在聊天 header Popover 查看并支持刷新恢复。
- [x] 官方生命周期映射持久化 Run 状态/事件；工具错误具体原因进入模型与 UI 历史，失败调用不发布变更事件。
- [x] 实际原生 API 验证取消、整轮/单步/首个输出/流中断超时、步骤暂停和官方 continuation，已完成操作不重复。
- [x] 智能体配置 UI 和运行文档：本地/Sandbox、原生默认/自定义模型；创建/编辑/刷新恢复浏览器通过，保存时拒绝不支持的环境组合。
- [x] 当前运行状态与执行中刷新恢复：持久停止和原生继续；浏览器流断开后 Node Run 继续，刷新读取实际状态并阻止重复发送，终态消息原位恢复。按用户最新要求移除执行历史入口和面板；组织 AGENTS.md 保持内部生成。
- [ ] Sandbox 用真实配置执行并跨 turn 恢复，覆盖凭证/文件/会话权限；已归档显式 `test:harness:remote`（Pi+真实Vercel创建/停止/resume、原生文件/shell、生产report Skill/reference/Python脚本与真实CSV聚合JSON、历史/输出/执行计数不重放、finally清理），类型检查及宿主脚本窄契约验证通过；node24缺Python会明确失败，不安装包冒充支持。本机缺Vercel凭证，preflight退出2/BLOCKED，真实远程验收仍待配置。

## 4. Skill / 智能体配置

- [x] 组织 Skill 列表→详情路由；详情文件 Explorer，支持SKILL.md、references、scripts阅读。
- [x] 平台内置只读；暂不支持新增、复制或编辑内置内容。管理员可配置工作区启停。
- [x] 四个业务流程技能：table（包含关联/汇总）、form、report、automation。
- [x] 技能描述业务方法与判断，不只包装 tools；YAML/frontmatter/路径/包大小校验，组织权限隔离。
- [x] 智能体创建/修改设置人设、Skill与模型；运行只加载工作区启用且智能体已选的技能，按需读取文件。
- [x] 官方 Harness Skill bundle（name/description/content/files）通过原生 SDK 加载；旧 streamText 执行链已移除。
- [x] 四个生产 bundle 的实际 SDK proof：首次只注入 metadata，native read 按需加载完整 SKILL/script，native bash 读取 reference；恢复旧 snapshot 后仅分配 form，官方 manifest 删除旧 report 且 native read 无法读取。纯 loader 供测试复用；没有新增业务工具包装。
- [x] 6项Skill数据库/权限/选择/文件校验测试，真实CSV脚本执行与列表/Explorer/旧Dialog配置浏览器通过。
- [x] 本地解释器能力如实验证：official just-bash 的 python3 不可用（exit 127）；report 文档有条件执行与 reference/产品聚合 fallback。上述 CSV 宿主脚本验证不代表本地 Harness Python 执行；真实 Sandbox 验收仍在第3节待配置项。
- [x] 创建/编辑独立子路由及共享表单；浏览器验证创建/编辑/深链接刷新/Skill持久化/无效链接/取消。

- [x] 智能体平台/原生工具开关：共享 `disabledTools` 校验与真实 SDK 动态目录，创建/PATCH 组织管理员权限和持久化，官方 `inactiveTools` 生效；本地 Pi 强制关闭调用不执行、模型收到错误、历史保存错误、数据/计划不变与无变更通知的 SDK/API proof 通过。工具 UI 浏览器验收由本轮 UI 任务单独记录；远程真实执行仍在第3节待验收。
- [ ] 外部 MCP 补齐报告/自动化/建表/部分表单布局工具的业务覆盖；本轮工具偏好只影响所选智能体原生 Harness 运行。

## 5. 平台呈现模式

- [x] 标准模式复用表格/表单/报告/自动化现有UI，无需定制。
- 用户于 2026-10-13 明确暂缓 HTML 定制；先重新确认呈现方式与数据结构的边界，不作为独立视图/资源入口擅自推进。本轮实验改动已撤回并隔离备份，未应用数据库迁移。
- Site独立包与client引用由用户明确延期，不在本次实现。

## 6. 交互回归新增项

- [x] 列设置/新增列改为列头锚定Popover，不挤动表格；真实浏览器保存/取消/Escape/嵌套Select/刷新/dark-light通过。
- [x] 修正Dashboard样式的直接依赖与新增列asChild空白节点；生产构建通过。
- [x] 将持续回归脚本纳入仓库及文档，全部完成后再整体review。
- [x] 报告连续拖拽/缩放反馈逐帧验证（包括非整格移动和边缘）；右侧移除返回页面设置，左侧固定入口。
- [x] 核心工作区样式统一：复用shadcn组件/变体和Tailwind；清除重复全局CSS与未使用tokens，保留主题变量和第三方必需基础样式。核心页面实际验收见下方记录，营销页面未作本轮浏览器验收。
- [x] 成员/智能体头像与外观菜单局部审查：共享 DropdownMenu Radio，侧栏按钮 aria-label/图标与 gap，移除全仓无引用的旧 tokens 文件。320px 头像网格无横向溢出，700×650 弹层受可用高度约束并可滚动；末尾表情键盘可达，奶油/墨色头像和选中标记在 light/dark 可辨，主题刷新与跟随系统通过。仅覆盖上述范围，不代表全站样式已验收。
- [x] Settings、Skills 列表/详情、Reports 列表/Builder、Automations 列表/新建来源继续审查：Button/Separator/SelectGroup，设置页使用共享 ToggleGroup/Switch/Field；报告已有数据时刷新失败可见，自动化失败与空列表区分，Skill 复制失败有反馈且紧凑文件树可滚动。七页面 light/dark 700×650 截图和真实重试/复制/偏好持久化通过；归档为 `client/test/browser/platform-style.mjs`。营销页面未在此轮做浏览器验收。
- [x] 看板恢复整卡标题/正文拖拽，拖动不误开详情；交互控件不启动卡片拖拽。卡片右上 hover/focus 快捷菜单使用统一删除确认，取消/错误 toast/重试/删除刷新通过；真实浏览器 `kanban-drag` suite 验证 Sheet 打开/关闭前后的原生鼠标拖拽与真实 PATCH 状态持久化，未使用合成 drag 事件。保留属性模板及密度，移除技术实现 footer 与重复刷新入口。
- [x] 图标选择Select横向显示；无来源/加载/无可分组字段分别提示并禁用，真实浏览器通过。

- [x] 安装官方 shadcn 项目 Skill 和 components.json；Select统一图标横向布局、空字段禁用说明，设置图标与外观区分。

## 7. 测试目录整理

- 用户要求：测试从 `src/` 剥离，各包内 `src/`、`test/` 两个目录平级；现已完成。
- 目标结构：`server/test/{ai,routes,commands,queue,reports,skills,harness}/`、`shared/test/`、`client/test/`；保留与业务源码对应的目录，便于定位。
- [x] 各包 `src/` 与 `test/` 平级，测试按业务目录归档；源码目录不再混放测试。
- [x] 新增 Harness 测试迁入 `server/test/harness/`，更新测试命令与专用类型检查；独立测试数据库约束保留。
- [x] 移动其余现有用例，更新导入路径、测试命令、类型检查范围和文档。
- [x] 持续回归脚本纳入对应 `test/`，统一运行入口；迁移后执行现有必要回归。
- [x] 验收：`src/` 中没有测试文件；测试类型检查覆盖新目录，生产构建不输出测试文件；原有测试命令仍能运行。
- 新增测试直接采用新结构；已有测试和队列故障/负载 fixture 已迁移，统一说明见 `docs/testing.md`。

## Harness Run 与 Chat 验收边界

- Chat 是对话界面和消息持久化；Run 是一次原生执行，Session 保存原生日志与文件工作区。
- [x] 原生 HarnessAgent/Pi 工具循环、文字收尾和跨实例工作区恢复的 SDK 测试。
- [x] 原生运行接入 `/api/chat`，替换 streamText 和离线规则回落；官方生命周期驱动状态。
- [x] 一次 Run 的状态/事件/错误和停止接口，原生取消/继续；完成状态、UI 消息和原生检查点同事务提交。
- [x] 本地环境、内部 AGENTS.md、人设和 plan/goal 持久化、私有权限及浏览器集成验收。
- [x] 本地运行中实际浏览器刷新/停止/原生继续、历史事件与失败详情验收；关闭HTTP流不取消已启动Run，启动阶段停止及运行中删除保护通过。
- [ ] 远程 sandbox 实际执行/恢复验收。

## 官方依据

- Harness/runtime 与 provider/model 的区别：https://ai-sdk.dev/docs/ai-sdk-harnesses/overview
- 原生 session、resume、生命周期：https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent
- Adapter 能力：https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters
- Skills：https://ai-sdk.dev/docs/ai-sdk-harnesses/skills
- Chart：https://ui.shadcn.com/docs/components/chart

## 验证记录

2026-10-13：聊天 23 项测试及 client/server/shared 类型检查通过；浏览器验证工具阶段与模型等待、状态结束、dark/light 滚动到底部按钮。没有从历史截图推断某次供应商的具体失败原因。

2026-10-13 后续：报告升级多组件Dashboard；报告服务端11项测试通过；列头Popover浏览器通过。Skill 6项测试、四个流程技能和脚本/引用文件Explorer验证完成。原生Harness和HTML呈现仍未完成。

2026-10-13 12:00后续：智能体创建/编辑独立路由浏览器通过；报告Select空字段与11种图表、真实数据刷新、保存恢复通过，生产构建通过。Harness原型已用真实HarnessAgent/Pi验证工具循环、文字收尾与虚拟工作区原生日志恢复（仓库native.test.ts），尚未替换线上chat路由，数据库/lease/sandbox/plan/goal未完成。

2026-10-13 后续执行层：`server/test/harness` 12项类型检查/实际SDK/真实数据库测试通过；原子lease/fence、消息与checkpoint同事务、虚拟文件快照校验完成。官方runtime工厂实现本地Pi与远程SDK创建/恢复接口，远程仅配置/构造测试，未用真实凭证执行。旧chat23项回归与服务端类型检查通过。详见 `docs/agent-runtime.md`；原生chat入口、Run状态事件、取消/继续、heartbeat、plan/goal、配置UI和远程验收仍未完成。

2026-10-13 原生入口：`/api/chat` 接入 HarnessAgent/Pi。13项原生基础设施测试、29项聊天测试通过；实际接口覆盖新实例续接、伪造UI历史不进入原生日志、重复/并发/旧分支拒绝、Run事件权限、具体工具错误、停止与四类超时、官方步骤暂停/继续。崩溃未提交检查点时不恢复旧快照重放工具。智能体环境配置浏览器验证通过，新增迁移已应用。`server/test/routes/chat.test.ts` 已从源码移出。plan/goal、AGENTS.md 编辑、Run完整界面、HTML呈现和远程真实运行仍待完成。


## 2026-10-13 智能体与字段交互整改

- [x] 编辑采用加宽配置布局与带图标的左侧垂直 Tab；创建两步 Stepper，共用基础信息与 Skill 组件，窄容器采用纵向表单布局。
- [x] Skill 仅显示已选且工作区启用项，独立搜索 Picker；切换面板/返回上一步保留草稿。
- [x] 智能体列表加入搜索、分离人设/模型/环境信息；列表名字与编辑入口进入独立路由。
- [x] 未修改禁用保存；保存时阻止重复提交/返回；加载失败显示重试，成员 API 不再把错误伪装成空列表。
- [x] 字段类型下拉和列头共用图标映射，新增列/列设置均覆盖。
- [x] 共用 Color Picker：10 个内置预设、HEX 3/6 位输入、校验和预览；自定义 HEX 按实际颜色显示并自动选择黑/白文字。
- [x] 列设置/新增列、智能体、自动化编辑、成员邀请和通用删除确认使用统一 Button 与操作图标。
- [x] 报告汇总数据改为 Popover，打开不会撑开图表。
- [x] 浏览器验证列表搜索/失败重试、宽屏垂直 Tab 图标与宽度、窄容器无横向溢出、创建/编辑/保存恢复与草稿、无修改禁用保存；字段图标、HEX 校验/保存刷新、单元格下拉颜色、预设颜色 dark/light、取消不改写数据库；成员邀请取消。类型检查与 client 生产构建通过。
- [ ] 全平台其余操作按钮和主题样式继续审查；不将本次局部整改标成全站完成。

原生执行补充：14 项 Harness、24 项聊天用例通过；删除未使用的旧 streamText 执行函数和 6 项重复测试。plan/goal 通过私有对话工具与数据库事务维护，Run 完成不自动代表 Goal 完成。内部 AGENTS.md 更新人设后在下一次原生运行生成，不再在工作区设置暴露单独编辑入口。

2026-10-13 13:31 UI 回归：上述流程使用独立测试数据库与实际 API，浏览器无页面异常。顺带移除未使用的旧 MembersPanel（包含过期智能体创建入口），避免同一功能维护两套流程。图表汇总 Popover、原生工具后文字回复、plan/goal 和对话刷新恢复同时保持通过。本次没有验收真实远程 Sandbox，也未将整个持续目标标为完成。

## 2026-10-13 成员/智能体统一与头像

- [x] 成员与智能体共用列表行、搜索、头像和操作布局；邀请成员采用标准表单与权限控制。
- [x] 成员离线 DiceBear Notionists / Croodles，切换样式与换一组；可上传 PNG/JPEG/WebP，居中裁切后保存私有图片，预览/取消/错误重试/刷新恢复。
- [x] 智能体独立 bloub React 头像：8形状、16表情、主题自动颜色及原版预设。只保存校验后的配置，不提供上传；取消不保存，创建Stepper和编辑共享草稿。
- [x] 头像同步列表、聊天选择器、用户侧栏与表格/表单人员选项；更新事件重新读取成员数据。
- [x] 独立数据库与实际API浏览器验证上述流程、非法配置、bot上传拒绝、dark/light和窄屏；没有外部头像请求和页面异常。
- [x] 保留上游bloub MIT许可及DiceBear样式署名/许可证，见 `docs/avatar-credits.md`。

## 2026-10-13 Pi 一 token 空回复修复

实际失败的原生日志中两轮终止均是 `length`，output=1、reasoning=1。Pi模型定义错误硬编码contextWindow=32000；官方Pi SDK会用上下文估算减去4096保留token，把超出窗口的输出预算压至1。

- [x] OpenRouter模型上下文和提供商输出上限从 `/models` 读取并缓存；模型目录失败在创建Run/保存用户输入前明确报错。自定义Pi端点上限通过环境配置。
- [x] 终步没有正文且没有unfinished turn时Run失败，已有工具/原生日志/消息原子保存；官方unfinished turn仍暂停并可继续。
- [x] 21项聊天路由回归通过，新增实际HarnessAgent/Pi长上下文工具后完整回复、输出预算8192、reasoning-only结束失败和历史恢复验证。7项SDK构造/原生循环/工作区回归通过，类型检查和client生产构建通过。
- SDK adapter当前不完整传递原始 `length` finish reason；此处不编造原因，空正文只报告没有正文。

2026-10-13 测试归档与交互回归：server 68项、shared formula、client10项通过；队列专用数据库迁移后15项（含SIGKILL/SIGTERM和专用Redis断线恢复）通过。测试类型检查和server/shared生产构建通过，src/dist不再含测试/队列fixture。浏览器实际通过独立自动化新建/编辑/运行记录/删除取消与旧链接，表单BuilderLayout标签/必填保存恢复、填写/紧凑布局，视图菜单键盘/Escape/删除；Dashboard连续拖拽与缩放52帧light/dark反馈和非整格/边缘坐标对齐，松手清理、保存刷新和窄屏不覆盖桌面位置。持续脚本归档client/test/browser，字段颜色/Popover与最新avatar回归也通过；日志/截图/帧轨迹为git忽略的运行产物，未使用用户数据库或重启3001/5173。

2026-10-13 成员/智能体局部样式回归：独立 `tabdo_agent_test`、API 3116 与现有 Vite，实际浏览器截图在 已按用户要求清理的本机截图目录。修复头像 Popover 高度裁剪及320px网格溢出；极浅/极深固定色使用算法对比衬底，未修改上游 bot geometry。外观菜单复用共享组件并验证 light/dark/system 与刷新。client 类型检查和生产构建通过；没有重启用户 API/Vite，没有实现或迁移延期的 HTML。

2026-10-13 Run 验收：`client/test/browser/run-recovery.mjs` 通过真实 HarnessAgent/Pi 和本地 HTTP 模型 fixture，在独立 `tabdo_agent_test` / API 3103 上验证同一浏览器流断开后的实际 running、重复发送禁用、服务器继续完成与终态消息原位恢复、Composer 持久停止、启动延迟时立即停止、刷新后的官方 continuation、历史事件/具体失败详情及窄屏/light/dark；每项已提交工具操作只执行一次。Run 公开投影隐藏 session/fence，历史记录不能继续。聊天数据库回归25项、client/server类型检查与client生产构建通过。未重启用户 API3001/Vite5173；服务端进程崩溃仍按缺少检查点拒绝重放处理，未验收远程Sandbox。

2026-10-13 平台操作样式续审：Settings、Skills 列表/详情、Reports 列表/Builder、Automations 列表/新建来源七页面，700×650 的 light/dark 实际截图在 已按用户要求清理的本机截图目录；归档 `platform-style` 浏览器 suite 通过。报告已有数据的刷新失败/重试、自动化失败不显示空列表、Skill 紧凑文件树和剪贴板成功/失败、Settings 单选主题及侧栏偏好刷新恢复均通过，无页面异常。`pnpm --filter @tabdo/client build`（包含类型检查）通过。新增 Toggle/ToggleGroup 使用官方 registry 源码和已安装 Radix，无运行时 CDN 与依赖变更。全局 CSS 仅保留主题变量、基础和必要第三方/共享 utility，营销插画变量有真实引用，保留；未声称营销全站浏览器验收。HTML 保持延期，未运行数据库迁移或重启用户 API/Vite。

报告操作按钮补充：保留 `.report-drag-handle` 的 Button 变体替换后，单独复用已归档 Dashboard 报告阶段，52 个 light/dark 连续拖拽/缩放帧（非整格、边缘）及保存/刷新/紧凑坐标保持通过。整套 builders 在表格视图 Escape 立即焦点断言处中断，尚未作为整套通过记录。


## 2026-10-13 视图设置与看板记录侧栏

- [x] 任意视图重命名，Popover编辑支持Enter提交、取消、Escape和失败保留；当前菜单独立于Tabs和新增入口，默认视图可见星标；视图/表格操作合并单ellipsis，分组复用图标/置顶/删除确认行为，嵌套图标Popover保持锚点。
- [x] 每表唯一默认视图，首次进入读取默认、实时刷新保留手选；父表锁和partial unique index保护并发，新建/删除默认确定性回退，最后视图不可删除。
- [x] 看板前置“显示设置”Popover配置分组、显示字段和顺序、隐藏空值、宽松/精简；各视图独立持久化。标题保留，Card Header/Content/Footer固定结构，Content字段名和值对齐，人员/日期页脚，同区域保序。
- [x] UI与AI共用schemas/commands，rename_view/set_default_view/update_board_view具有相同租户边界和配置验证；并发局部设置按行锁内最新配置合并，UI仅提交实际变化字段。
- [x] 看板点击/键盘打开共享记录Sheet，关联导航保留；真实字段草稿保存、取消、版本冲突保留、formula/rollup只读，数字原始输入支持负数/小数与失败保留。PATCH成功即更新版本和清草稿，刷新失败不误报保存失败；保存期间阻止重复和导航。
- [x] 480px标准非modal Sheet与AI宽屏并存；窄屏AI打开暂藏Sheet且保留草稿，关闭恢复。拖拽不触发点击，分组请求及异步移动/新增有过期响应保护。
- [x] 独立_agent_test应用0020并验证默认并发/删除回退、跨租户权限和设置合并；server70项（含原生Pi/聊天）及新增views浏览器通过，无初始未打开Sheet页面异常。

参考Notion官方[Board properties](https://www.notion.com/help/boards)和[View naming](https://www.notion.com/help/views-filters-and-sorts)：借鉴属性显示/顺序与独立视图设置；宽松/精简是本产品用户指定的两种密度，不等同Notion的三种卡片尺寸。无需新增图片preview或高级布局配置。

视图最终浏览器补验：合并菜单图标/置顶持久化及删除表格取消、计算字段只读、关联导航栈返回、checkbox真实保存、负数/小数与无效输入保留、宽屏AI/Sheet无重叠、窄屏切换草稿、独立拖拽手柄不开Sheet、MemberChip统一24px高度/16px文字行高均通过；原builders套52帧Dashboard回归继续通过。


2026-10-13 Pi journal 恢复独立证明：新增 `server/test/harness/journal-recovery.test.ts`，本地 fixture/独立会话，无数据库和用户内容。原样旧 opaque resume 配合同 filename、严格旧字节前缀扩展的最新完整 host journal，可由官方 createSession 开新 user turn；provider看到九个既有查询结果，工具计数仍九，未重放。已验证JSONL、最新prompt、9/9结果、末条toolResult。只证明完整只读查询的保守恢复，不标记自动crash recovery完成，不覆盖dangling工具或未知写操作。

2026-10-13 Sheet外部关闭补验：RelatedRecordPanel恢复Radix外部pointer默认dismiss，Escape正常；同步savingRef阻止保存中的外部pointer/Escape关闭，程序化focus转移不误丢草稿。实际views浏览器通过外部点击丢弃草稿、延迟真实PATCH中保护、关联Popover/导航栈、AI外部按钮关闭，以及⌘J宽屏并存/窄屏隐藏恢复草稿。未修改KanbanBoard。


## 2026-10-13 本轮收尾

- [x] 按用户要求移除Agent Chat执行历史入口与整块Popover；自动化运行日志保留。聊天仅保留当前状态、停止、必要的原生继续及消息内失败反馈，执行中刷新恢复仍正常。
- [x] API开发supervisor等待原生Run保存后重载，SIGTERM/SIGINT排空；真实7秒Run面对连续源码变更与停机2项通过。现存旧tsx watch尚未更换，完整保护在下一次正常启动生效；未重启用户服务。
- [x] 对一次服务中断的只读Pi会话进行保守维修：核对旧字节前缀、用户输入、九次查询完整闭合结果，保留opaque状态和原失败Run，未重放工具、未调用模型；恢复下一轮消息边界。仅通用证明入仓，用户数据维修备份留本机私有临时文件。
- [x] MCP/shared命令类型同步视图重命名、默认视图、看板设置，共用schemas；MCP不再手写重复CommandName列表。
- 验证：workspace源码/测试类型检查、shared/server/client生产构建、server73项/shared公式/client10项通过；真实views、kanban-drag及更新后的run-recovery浏览器通过。远程Sandbox真实执行仍未验收，HTML/Site保持用户指定的延期。

2026-10-13 最终工具与 Skill 自检：智能体编辑增加带图标的工具 Tab，创建更新为三个共享步骤；默认启用 Harness 内置与平台工具，可搜索和 toggle。真实 `agent-tools`、`avatars`、`platform-style` 浏览器通过，实际保存/取消/刷新恢复、草稿保留、错误重试和窄屏均正常；Switch 采用官方 registry 的 Radix 结构及语义 tokens。light/dark 截图目视检查在 已按用户要求清理的本机截图目录。工具目录与过滤另经团队只读交叉复核，没有发现阻塞缺陷。

最终全量：server80项、client10项、shared公式通过；整套 builders（独立自动化、表单、键盘菜单和52帧Dashboard拖拽/缩放）及最新 run-recovery 浏览器通过。生产/测试类型检查与全工作区构建通过。扫描 src 没有测试文件、原生系统确认或旧 streamText 执行入口。远程 Sandbox 真实运行仍因缺少本机凭证待验收；不标记持续目标全部完成。

远程验收收尾：再次 preflight 确认缺少 Vercel 凭证，退出2且没有创建资源；已请求在本机配置。显式验收现使用生产 report bundle，读取真实文档/引用/Python脚本，独立CSV聚合结果和停止恢复后的执行计数均设为必过门槛；脚本类型检查与宿主参数/JSON窄契约通过，不算远程通过。Skill 内置只读/删除错误去除不支持的复制建议，6项权限回归通过。

## 2026-10-13 品牌定位与登录页重设计

- 用户明确：tabdo.ai 对应 Table → Do → AI，以灵活数据为底座，Agent-first 与 AI 原生业务编排为主轴；不宣传多维表格、竞品风格或“一张表”。
- [x] 品牌方向与文案落地 `docs/brand/positioning.md`，更新 PRODUCT、README；首页按业务目标→AI组织数据和流程→执行→查看调整叙述，表单/看板/报告作为支撑能力。
- [x] 共享 BRAND_COPY 导出，统一首页、登录页文案、营销页脚与 SEO；修复首页先引用后缺少导出造成的浏览器 SyntaxError。client 类型检查通过，Vite brand 模块 HTTP200 且含导出与实际 slogan；真实 Chrome 首页和登录页均显示新 slogan，pageerror 为0。此验证不代表旧插画已重设计。
- [ ] 按品牌方向重做登录页左侧视觉及认证页布局，支持 dark/light。用户要求先定位再确定画图；当前只更正文案，插画尚未制作。
- 验收边界纠正：本地开发不需要 Vercel 凭证，远程 Vercel Sandbox 真运行仅为该可选环境的独立验收项，不能作为本地开发与登录页 review 的阻塞条件。


2026-10-13 品牌与认证页面收尾：用户进一步明确面向个人和小团队，CRM 只是案例，最终定位为“AI 原生工作空间”，主文案“让想法，动起来。”；首页、登录/注册、SEO、PRODUCT/README 与品牌文档已统一。认证布局与左侧品牌矢量图已重做，旧人物/纸张插画不再用于认证页；表单使用共享 Field、输入标签、加载反馈与重复提交保护，原认证流程保留。桌面深浅主题真实浏览器检查无页面异常。按用户要求清理 screenshots 及临时浏览器产物并加入忽略项，保留测试代码和验证记录；本轮不再新增截图。

2026-10-13 推理耗尽输出预算修复：只读核对实际原生结束原因，末轮length且output=reasoning=8192、text0；前轮正文也length，被旧逻辑误completed。官方Pi samplingParams显式使thinking off进入OpenRouter请求，默认输出预算16384并保留模型目录cap、nullable fallback修复；官方message_end观察末条assistant原始原因/usage，在metadata保存，length保留正文且明确标为未完成。真实native本机SSE覆盖reasoning-only/partial/normal stop，独立test DB验证失败持久化与下一输入续接，工具执行仍一次。未调用用户模型、未修改用户历史、不生成截图。

2026-10-13 Agent Run 额外干预审核整改：实际暂停是平台默认16步限制导致（16模型steps、13成功tools），非模型主动停止。已按先列清单再整改流程记录 `docs/agent-run-audit.md`。默认步骤和四类超时限制全部关闭，仅显式配置才启用；Pi官方continuation/input extension接受普通追问，真实新输入进入原生provider历史，不吞消息/不重放工具。自然stop无正文不再改判failed或合成助手总结；真实length/error/abort保留并标为系统提示，删除固定下一步口令。移除原生聊天重做、旧消息编辑、分支切换入口，保留复制/导出/用户停止，恢复文案不预设原任务方向；简化任务和机械查询指令。权限、租约、防重放、原生保存一致性保留。隔离测试DB和本机原生SSE：routes10项（含用户主动停止）、startup-boundary2项、output-limit2项通过；生产/测试server类型检查和client类型检查通过，17次工具往返自然完成、空正文真实工具持久化后普通追问不重放均验证。未调用用户模型、未改用户历史、不生成截图；Codex/Claude已暂停会话改方向与远程真实运行仍明确为能力边界。

2026-10-13 继续失败后的简化整改：只读确认实际会话具有完整 resume/journal，失败来自客户端在 HTTP 拒绝后保存两条未执行消息并推进 UI head，服务端又用 UI parent 拒绝原生续接。移除 UI parent 执行拦截，由服务端选择原生展示父节点；客户端 history 仅加载，旧 messages POST 兼容但不写，GET 使用真实接受的原生 head，历史残留不进入模型。请求只传最新用户消息、去除200条历史限制；删除所有 Harness 的固定继续口令，Pi官方输入扩展和 bridge 官方 accepted ACK steering 接收新输入。进度记录与取消轮询故障不再主动停止；真实租约/最终保存失败仍如实处理。模型目录不再作为执行前置门槛，2秒查询、真实旧缓存优先降级；删除 Plan/Goal 任意步骤数量、并行、关闭/替换等硬限制。

本轮验证：隔离测试DB与本机真实 Pi/SSE，routes7项、store7项、startup-boundary2项通过；新增真实 SQL 进度写入故障测试通过，工具一次、正常回复/会话持久化且无合成失败提示。模型目录4项、client11项及客户端/服务端生产与测试类型检查通过。HTTP拒绝残留两条消息后仍可普通续接，最新输入进入原生日志且工具不重放。未调用用户模型、未修改实际用户数据/历史、未新增截图或迁移。真实 Codex/Claude Sandbox 未验收；冷缓存未知模型上下文仍属配置降级边界。最新完整性/权限/租约/提交幂等保护保留，详见 docs/agent-run-audit.md 最后一节。

2026-10-13 合入远端国际化后的启动修复：保留远端16个提交，解决chat-persistence唯一import冲突；原生transport参数独立为无界面依赖模块。删除未使用的RUN_LABELS Proxy，类型/颜色翻译使用普通对象getter，报告类型使用普通getter返回对象/数组，消除React热更新Symbol异常及空数组反射失真；旧unit fixture适配翻译边界，client11项与client/server测试类型检查通过。MCP开发脚本保持原状；根dev先构建shared，server dev不再并行重复删除重建dist，消除MCP启动竞态；真实stdio initialize返回tabdo。未重启用户API/Vite。用户后续要求将工作区整理为apps/*与packages/*，继续推进。

2026-10-13 pnpm工作区目录规范化：应用移动为apps/{client,server,mcp}，公共契约为packages/shared；workspace globs、lock importers/link、Vite/Storybook/tsconfig、开发watch、根.env定位、浏览器fixture/产物忽略、Docker和当前文档均同步。包名/workspace:*依赖保持，锁定版本无升级。根build使用pnpm依赖图，shared先构建一次，MCP加入编译脚本；Docker选择server及其workspace依赖构建。原启动命令保持，开发server不重复删除shared产物。全工作区源码/测试类型检查、client11项/shared公式、迁移后4项真实原生聊天回归通过，MCP通过真实stdio initialize和tools/list（30项）。目录变化后原开发进程需要按新路径重新启动，未代用户重启API/Vite，未修改用户DB或调用真实模型。

开发协作规则：按用户要求，每个独立feature完成并检查通过就单独提交，避免积攒无关改动；持续任务按功能提交。

2026-10-13 表格横向滚动和关联单元格：表头与虚拟行共用滚动容器，保持纵向sticky并计入37px表头偏移；多关联显示首项与剩余数量，长标题收缩且计数完整，首项打开记录、数量打开原关联编辑器。客户端类型检查及独立数据库真实Chrome回归通过：18列80行、六组横纵位置、末行、25条关联仅预览20时仍准确显示+24，解除/恢复后关联完整。无截图、用户数据修改或用户服务重启。

2026-10-13 紧凑实时调色板：新增HSV面板/色相条和鲜明预设，256px弹层、112px面板、24px预设；拖动/预设/有效HEX实时生效，删除预览、确认/取消及操作说明。旧颜色token保留兼容，父列设置仍按原保存/取消。客户端类型检查、14项测试及隔离浏览器指针capture/键盘/HEX/连续预设/关闭保留/light-dark窄屏验证通过；未访问数据库或模型，没有截图，临时服务已清理。

待推进：按shadcn monorepo抽取@tabdo/ui和独立Storybook；分类图标选择器与组织主题入口对齐；核查原生模型输出预算被限制为1 token的原因。

2026-10-13 侧栏入口对齐：外观菜单与组织导航复用同一padding、gap、text-sm和20px图标槽，展开/折叠一致；设置入口改为实际齿轮图标。客户端类型检查通过。

2026-10-13 1-token预算修复：本机真实Pi SDK复现长输入在缺少context目录时被安全估算将16384压为1；改用官方provider samplingParams显式保留已配置输出预算、compat统一预算字段，继续尊重目录真实output cap，由provider报告实际context溢出。未知模型16384、目录cap2048、自定义Pi16384三个原生SSE场景通过；相关7项回归与服务端生产/测试类型检查通过。未读取用户prompt或真实Run、未调用用户模型或新增重试/续接拦截。

2026-10-13 分类图标选择器：144个Lucide图标，8分类与全部，中英文/图标名搜索；左右独立滚动、底排完整可见，保留原40个ID。类型检查和隔离浏览器320px窄/260px低高度、分类/搜索、失败重试、选取/默认重置通过，未调用API或截图。

2026-10-13 共享UI包：依照shadcn monorepo抽为packages/ui（@tabdo/ui源码exports），31组件、语义theme/Tailwind CSS与纯utils/date/color同包；app直接引用，六个翻译/主题/旧颜色适配器留app controls，无公共UI到app/API/i18n反向依赖。双方components.json统一配置，独立Storybook含33例、深浅主题toolbar，根pnpm storybook/build-storybook；工作区锁只改importers，外部版本/snapshots保持，Docker补UI manifest。全工作区类型检查、UI3项/client11项、客户端生产构建、独立Storybook构建与33例浏览器/六组真实交互通过，零JS/console错误。无截图/用户模型或数据库操作；临时6016已关闭。

2026-10-13 图标400整改：根因为服务端使用旧40项enum拒绝新增图标。按用户要求取消名称白名单，保存仅校验字符串/非空/合理长度；144项目录只服务选择器与已知图标renderer，前端从同一目录派生，未知名称正常保存并显示默认图标。真实隔离API验证两个新增图标、未知名称保存/读取、旧图标/nullreset、跨租户与格式错误；共享包构建及shared/server/client类型检查通过。未操作用户数据或重启服务。

2026-10-13 标准批量操作：新增9项统一batch_*工具，记录新增/更新/删除、字段新增/更新/删除、关联替换/添加/解除；AI Harness和MCP共用schema/描述，命令路由从共享COMMANDS读取，工具开关和表格刷新同步。每批1–100项原子事务，复用公式、关联、版本和自动化事件逻辑，保留真实租户权限；单条与批量写入锁序一致。行/关联工具返回精简摘要。明确一次性mock写入用batch_add_rows，持续未来事件才用create_automation，不新增用户意图regex拦截。8项rows/5项columns-relations新增真实DB测试及12项原关联回归通过，另真实Pi SDK写100条mock只调用批量工具一次、无自动化资源、正文回复通过；真实MCP stdio列出全部9项batch工具（总39项），shared/server/client/MCP类型检查通过。无用户数据、真实模型或用户服务操作。

当前推进：SDK统一提问卡片与原位tool-result续接，核对Skills/Tools/Plan/Goal和附件实际能力；新增用户要求的按字段类型筛选器，负责人/枚举/关联/数字/日期/勾选分别匹配输入控件和运算符。

2026-10-13 Harness SDK提问与能力对齐：使用官方askUserQuestions，单选/多选/自由文本/部分回答与拒绝卡片；标准tool-result续接同一Run/assistant，不重发用户输入、不重放工具。删除Run.status和warm handle恢复门禁，SDK原生状态决定续接；已验证真正跨进程恢复、回答保存后启动失败/取消再重试，以及浏览器刷新和HTTP503后明确重试。Skill保留原生包和按需文件读取；工具目录与开关包含canonical提问工具。当前三adapter真实拒绝ImagePart/FilePart，关闭自动注入的上传入口，服务端明确返回版本限制，避免静默丢弃。后端6项真实SDK针对性回归、附件2项、客户端12项、浏览器提问交互和生产/测试类型检查通过。核对清单见docs/sdk-alignment.md；Codex/Claude远程问题续接仍未实测，不能算远程验收。未调用用户模型、修改用户数据或重启用户服务。

2026-10-13 按字段类型筛选：负责人复用成员/智能体选择器并提交真实ID；单选/多选使用带颜色选项，关联用只读选取记录，数字保留负数/小数草稿并拒绝NaN/Infinity，日期用日期选择器，勾选明确选择true/false。切换字段或运算符清理旧值，空值条件隐藏输入；自动化条件复用同一套控件。公式按声明结果类型或已加载同质样本解析，保留未筛选样本避免零匹配后类型跳变；汇总日期/数字分别处理。服务端和自动化共享computed类型，计算错误不再导致SQL数值强转400或误匹配日期。隔离数据库真实浏览器覆盖所有上述类型与计算错误同行、shared针对性测试、生产/测试类型检查及客户端生产构建通过，无截图、用户数据修改或服务重启。另统一SQL与自动化的checkbox空值语义：普通、显式和auto公式的false/null为空、true非空；auto公式中的文本“false”保持非空，精准测试通过。

2026-10-14 shadcn CLI网络与monorepo入口：复现最新版4.21.4在HTTP/HTTPS代理与SOCKS all_proxy同时存在时docs/info read ECONNRESET；官方registry0.1.3优先SOCKS且HTTPS自定义connector未封装TLS，本机隔离SOCKS fixture观察到明文GET。仅在存在有效HTTP代理时，workspace入口为CLI子进程清除ALL_PROXY/all_proxy，保留地址/凭证/NO_PROXY，不改用户全局设置、不硬编码代理；固定官方CLI版本，根pnpm shadcn默认apps/client、shadcn:ui选择packages/ui。原components.json配置经真实CLI验证正确，无需改样式或组件；两个包docs select/input/button、info共享UI/CSS/utils解析均通过，node语法与版本检查、offline frozen install通过。锁文件保留已有包版本、既有workspace依赖与平台元数据，仅新增CLI闭包及其共享依赖必要非optional标记。说明与upstream修复后移除路径见docs/shadcn-cli.md；SOCKS-only环境不擅自绕过。未操作DB/模型、服务或截图。

2026-10-14 筛选控件尺寸与上下文：字段/运算符/所有类型值输入统一176×32，关联和人员选择器使用公共size=sm、日期填满值输入宽度；自动化条件复用相同尺寸，触发值/动作值使用compact控件并按上下文伸展宽度，常规表单使用36px/typeform保持原大尺寸。补公共DatePicker/表单选择器size接口，长名称/日期占位截断，保留原输入/选择行为。真实隔离filters浏览器逐类型量测三个控件宽高相等并回归筛选通过；无截图或用户数据修改。

2026-10-14 自动化创建交互：来源独立为紧凑第一步，搜索名称/描述、表格图标摘要、明确下一步；第二步显示来源并可返回，同来源保留全部Editor草稿、换来源重建配置且提前提示。已保存规则来源固定，source参数入口保留；加载错误明确重试、真实保存中禁用返回/取消且阻止重复提交、保存失败保留草稿。现有大builders仅更新对应入口选择器；新增独立浏览器完整证明搜索/键盘/草稿/换源/400加载与保存重试/数据库唯一真实规则/固定来源/中英/700px明暗布局，无截图。开发HMR可能干扰页刷新测试，因此最终在独立HMR-off Vite5126+API3124完成并清理，不重启用户服务；client类型检查通过。

自动化值上下文复核：修复原先把全部成员提前筛为智能体导致人员字段无法选择人的问题；人员条件/更新字段接收全部成员，仅执行智能体动作筛选智能体。相同浏览器流程验证人员选择、智能体默认项与实际保存的两个ID；类型检查和完整创建流程通过，隔离资源已清理。

2026-10-14 智能体配置与能力分组：去掉厚重外框，常规表单36px与成员一致、头像共享40px；编辑保留176px左侧带图标vertical line Tabs，窄屏图标导航，创建使用同一组字段和步骤导航。工具按当前Harness实际目录归并文件/命令/检索/交互与表格/表单/报告/自动化/计划/技能等能力，一组一个开关，具体API折叠只读；已有逐工具配置显示部分开启且不重置，创建切换Harness保留各自原生草稿与共享平台设置。修复Radix隐藏Select空事件清除默认模型使下一步失效。实际核对Pi/Codex/Claude工具元数据；隔离agent-tools浏览器完整创建/编辑/保存/取消/失败重试/目录重试/跨Harness草稿/mixed状态/键盘Tabs/明暗/700与320px布局通过，资源已清理，无截图、模型或用户数据操作。公共Tabs新增line变体与三个Story；客户端生产构建、UI类型检查和独立Storybook构建通过。

2026-10-14 一级页面规范：表格列表、自动化、报告、成员、智能体、技能与设置使用统一1024px内容最大宽度，标题与内容居中对齐；表格详情、看板、报告画布和对话保持工作区宽度。列表共用每页20项分页，搜索回第一页、末页删除回退、加载/错误重试一致；报告/自动化继续服务端按页读取，其余全量目录仅在列表界面分页，不改变选择器和侧栏数据。两份隔离真实浏览器各21条目录/报告/规则证明按页替换、完整搜索、实际删除末页回退、HTTP错误保留真实旧页/重试目标、忽略abort的旧响应不能覆盖新页、limit参数400；1600px时四页头/内容精准同宽1024与同left，700px滚动可达分页、明暗无横溢。client类型与server构建通过，资源已清理，无截图/用户数据/模型操作。已纠正并行交付顺序造成的分页hook缺模块，公共hook/控件已真实落地，本机Vite三模块HTTP200；后续先交付公共模块再接引用。

2026-10-14 自动化运行记录Sheet：移除编辑页内联日志，使用公共Radix右侧Sheet、标准遮罩/关闭/Esc，日志错误与加载独立在Sheet中，打开和关闭不改表单位置或草稿；只在打开时读取和5秒刷新，关闭立即停轮询，旧请求结果不写入已关闭UI。保留已有显式重放动作，未增加Agent Run干预。精准隔离浏览器实际480px/空状态/表单y不变/真实轮询与关闭后5.5秒计数不增/遮罩与Esc/400重试/700和320px关闭可达全部通过；公共Sheet非modal调用由Radix保持无Overlay，新增默认/非modal两个Story，UI类型检查、Storybook和客户端生产构建通过。无截图、用户数据或模型操作，资源已清理。

用户新增继续推进：移除智能体设置里的Harness内置开关/目录及平台额外计划目标；各列表改为主区域整项导航，标题不专门下划线，独立快捷操作不触发导航。

2026-10-14 自动化类型值补齐：WHEN比较值复用表格筛选类型控件，关联/多选保留完整数组；执行智能体写回使用同一表单类型控件，排除公式/汇总列并在换列时清空旧值。IF继续176×32，触发/动作按上下文伸展，人员选择复用已加载的全部成员。隔离浏览器真实保存回读关联两ID、人员ID、数字、布尔、日期、多选数组通过，client类型检查和生产构建通过，无截图、用户数据或模型操作。

2026-10-14 Harness能力收敛：智能体仅配置平台表格、表单、报告、自动化与技能读取5类；删除Harness原生目录/开关和各Harness原生草稿，原生工具、提问与计划能力交由SDK。删除平台create_goal/update_goal/update_plan/get_task_state、指令、task-state API、聊天入口与ORM定义，历史迁移和物理数据不动。旧已知native/task禁用配置兼容清理，平台mixed设置保留，未知/重复名称仍拒绝。官方Pi SDK2项、隔离路由4项、store6项，shared/server类型与构建、client生产构建、agent-tools浏览器保存/取消/错误重试/跨Harness/明暗窄屏通过，无用户DB/模型或服务操作。现行文档同步。

2026-10-14 列表整项交互：表格、自动化、报告、智能体与技能主区域使用原生Link点击进入对应详情/编辑，标题移除下划线；菜单、删除、开关为独立点击区域，键盘Enter和新标签语义保留。成员主行在已有权限范围打开原头像编辑Popover，与快捷按钮共用受控状态，不虚构详情路由。隔离array-list浏览器实际主区域/键盘导航、各菜单与删除不导航、Skill开关持久保存、成员取消/Esc、标题无下划线及分页/搜索/末页回退/1024与700布局通过，client生产构建通过，无截图/用户数据/模型操作。

2026-10-14 持续新增需求已记录 docs/roadmap.md：文件存储/单多文件字段进行中；随后研究并实现集成（先AgentMail）、Webhook收件触发、完整数据动作、通用“智能体+任务描述”动作与定时触发；自动化卡片按来源/触发/主要动作展示核心差异。用户休息期间持续推进，独立功能检查后提交推送。

2026-10-14 自动化两步居中：来源选择与创建配置在可用内容区使用纵向auto margin；空间不足时margin归零、表单不收缩，沿原页面滚动容器从顶部滚动。仅创建布局调整，已保存规则编辑布局不变；client类型检查通过。新增Skill代码编辑器与全部功能完成后品牌案例要求记录于docs/roadmap.md。

2026-10-14 文件字段与存储：本地目录与标准S3 adapter共用上传/受认证下载/metadata接口，真实字段归属、租户、单多文件和请求/文件大小校验；行写入与batch复用相同事务验证。表格、Sheet、表单、看板复用首文件+数量显示、上传进度、引用移除和失败重试。组合回归抓到后台刷新卸载未保存FileEditor，改为同身份同query刷新保留行缓存、重新取分页游标，不同身份/查询仍清空；确定性阻塞真实HTTP证明未保存IDs保留并重试不重传。共享3项、存储adapter3项、路由实际DB1组、完整files浏览器及客户端生产构建通过；server/MCP类型及server构建通过。S3测试使用官方AWS SDK与本机SigV4服务，无用户凭证/模型/DB。部署需迁移0021，文件移除只解除引用，实体清理不在本功能范围。

2026-10-14 Skill代码编辑器：公共UI采用CodeMirror6，支持Markdown/Python/JSON/JS/TS/YAML、行号、搜索、缩进/撤销及语义主题，补Storybook并按需加载。SkillExplorer内置只读；工作区管理者保留多文件草稿，完整bundle+expectedVersion保存，失败保留/重试、取消恢复原值。真实隔离浏览器验证只读键盘/搜索、多文件切换、缩进撤销、400失败与版本回读、700/320布局通过；UI/client类型、Storybook与客户端生产构建通过，无用户Skill改动/截图。自动化两步居中另外经1600×1200中心误差<2px、1200×600从顶部正常滚动且保存可见证明。
