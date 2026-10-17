import type { DocsPage, DocsSection } from "./types";

export const docsSections: DocsSection[] = [
  { id: "welcome", title: "欢迎", description: "tabdo 是什么，如何开始", audience: "both" },
  { id: "agents", title: "智能体", description: "创建、配置和使用工作区智能体", audience: "agents" },
  { id: "humans", title: "人类入门", description: "工作区指南与主要功能", audience: "humans" },
  { id: "concepts", title: "概念", description: "表格、成员、视图", audience: "both" },
  { id: "reference", title: "参考", description: "数据 API 与鉴权", audience: "ref" },
];

export const docsPages: DocsPage[] = [
  {
    slug: "welcome",
    sectionId: "welcome",
    title: "欢迎",
    description: "把个人计划或小组项目告诉 tabdo，让 AI 整理信息并推进下一步。",
    body: [
      {
        type: "p",
        text: "把想整理的资料、计划中的旅行或正在推进的小组项目告诉 tabdo。AI 可以把已有信息整理成计划和记录，并帮你完成具体更新；你可以在表格、看板或表单中查看结果、补充内容并调整下一步。",
      },
      {
        type: "callout",
        tone: "info",
        text: "在 tabdo 中使用智能体无需单独配置 API Key。需要从自己的应用访问表格数据时，工作区 owner/admin 可在「设置 → API Key」创建按表授权的数据 Key。",
      },
      { type: "h2", text: "开始使用" },
      {
        type: "cards",
        items: [
          {
            title: "使用智能体",
            description: "创建智能体、选择可用模型和运行方式，并按需编辑配置。",
            href: "/docs/agent-auth",
            badge: "智能体",
          },
          {
            title: "开始使用",
            description: "从一个目标开始，完成首张表和记录，再查看与调整结果。",
            href: "/docs/human-quickstart",
            badge: "人类",
          },
        ],
      },
      { type: "h2", text: "从想法到下一步" },
      { type: "ol", items: [
        "描述要完成的事，并提供已有信息，例如旅行日期、预算，或小组项目的任务和负责人。",
        "检查 AI 整理出的字段与记录，按需要补充、修改或调整状态；表格和看板便于查看不同部分。",
        "继续添加记录或安排下一步。需要收集信息、跟进变化或回顾进展时，再使用表单、自动化或报告。",
      ] },
      { type: "callout", tone: "info", text: "AI 整理和执行后，你仍可以查看并修改表格中的结果。可用功能取决于当前工作区配置与权限。" },
    ],
  },
  {
    slug: "how-it-works",
    sectionId: "welcome",
    title: "工作原理",
    description: "描述目标、整理已有信息、查看结果，再决定要做的下一步。",
    body: [
      { type: "ol", items: [
        "说出想完成的事，并给出已经掌握的信息，例如行程日期、预算，或项目任务。",
        "让 AI 将信息整理成可查看的计划和记录；检查字段与内容，按需要补充、筛选或调整状态。",
        "通过表格、看板或表单继续跟进。完成更新后查看结果，再决定接下来要推进什么。",
      ] },
      { type: "cards", items: [
        { title: "开始使用", description: "从工作区设置到第一张表和第一条记录。", href: "/docs/human-quickstart", badge: "指南" },
        { title: "表格、字段与记录", description: "查看数据如何组织，以及如何继续编辑。", href: "/docs/tables", badge: "数据" },
      ] },
    ],
  },


  {
    slug: "harness",
    sectionId: "agents",
    title: "选择模型与运行方式",
    description: "为新对话选择可用模型、本地或 Sandbox 运行方式和提供商。",
    body: [
      { type: "ol", items: [
        "打开 /app/agents，创建或编辑智能体。选择助手、可用模型，以及「本地工作区」或 Sandbox 运行方式。可选项会因助手和工作区而异。",
        "选择 Sandbox 时，只能选择界面标记为可用的提供商。当前 E2B 仅适用于 Pi；Railway 暂不适用于 Codex 和 Claude Code。若选项不可用，请改选其他可用提供商，或联系工作区管理员。",
        "本地工作区会以其所在环境的权限执行命令，仅适用于受信任的开发环境或专用容器。",
        "如要使用列表之外的模型，可选择自定义模型并按页面提示填写模型 ID。填写名称和人设，说明智能体应如何协助你。",
        "创建后可以编辑模型、运行方式、提供商、人设、技能和工具。创建时选定的助手类型不能在编辑时更换；需要使用其他类型时，请新建智能体。更改运行方式或提供商后，请新建对话以使用新环境。已有对话不会迁移；若提示运行环境已变更，请按提示新建对话。",
      ] },
      { type: "callout", tone: "info", text: "不可用的提供商不会被静默替换。若助手、模型或运行环境无法选择或启动，请联系工作区管理员检查可用设置。自定义模型 ID 必须与所选服务兼容。" },
      { type: "callout", tone: "warn", text: "Railway 环境在每轮结束后仍会继续运行，可能持续产生费用，直至空闲超时或被销毁。环境过期后无法恢复原对话；请在可用环境中开始新对话。" },
      {
        type: "cards",
        items: [
          { title: "创建与管理智能体", description: "查看创建权限、填写信息和编辑智能体的步骤。", href: "/docs/agent-auth", badge: "指南" },
        ],
      },
    ],
  },
  {
    slug: "agent-auth",
    sectionId: "agents",
    title: "创建与管理智能体",
    description: "创建智能体、选择可用模型和运行环境，并按工作区权限编辑配置。",
    body: [
      { type: "p", text: "只有当前工作区的 owner 或 admin 可以创建或编辑智能体。智能体会出现在 /app/agents 列表中；选择智能体即可开始对话，或打开编辑来调整设置。" },
      { type: "ol", items: [
        "进入 /app/agents，点击创建智能体，填写名称和人设。人设可说明你希望它怎样协助整理资料或推进计划。",
        "选择界面提供的助手、可用模型、本地或 Sandbox 运行方式；需要 Sandbox 时再选一个可用提供商。按需要挑选技能和工具，完成页面步骤并保存。更改运行方式或提供商后，请新建对话以使用新环境；若已有对话提示运行环境已变更，请按提示新建对话。",
        "之后可从智能体列表打开编辑，更改名称、人设、模型、运行方式、技能和工具。创建后助手类型不能更换；需要使用其他类型时新建智能体。",
      ] },
      { type: "callout", tone: "info", text: "如果没有创建或编辑按钮，你可能没有当前工作区所需的 owner/admin 权限。若某个模型或运行方式无法选择或启动，请联系工作区管理员。产品内使用智能体无需创建 API Key。" },
      {
        type: "cards",
        items: [
          { title: "选择模型与运行方式", description: "查看可用选项和不可用时的处理方法。", href: "/docs/harness", badge: "参考" },
          { title: "工作区成员", description: "查看角色权限与邀请成员的步骤。", href: "/docs/members", badge: "成员" },
        ],
      },
    ],
  },
  {
    slug: "human-quickstart",
    sectionId: "humans",
    title: "新手入门",
    description: "从选择工作区和智能体，到整理数据、添加记录并查看结果。",
    body: [
      {
        type: "ol",
        items: [
          "在 /signup 注册。新账号会自动创建或选中一个工作区；加入团队时可使用邀请链接。进入 /app 后，先确认侧栏显示的是要操作的工作区。",
          "在 /app/agents 选择可用智能体，或请工作区 owner/admin 创建。若没有可用智能体或模型，请联系管理员检查工作区选项；模型和运行方式见「选择模型与运行方式」。",
          "在 /app 与智能体描述目标，并提供示例信息。比如：‘帮我整理一个虚构的两天杭州周末计划，建立景点、日期、预算和状态字段。’检查生成的表和字段；也可以在「表格」页新建空表。",
          "打开生成的表格，点击空白行或添加记录入口，填写景点、日期、预算和状态。需要时添加附件字段并上传文件，或添加关联字段连接另一张表。",
          "在表格页顶部的视图切换器选择或新建表格、看板、表单视图；通过筛选和排序缩小记录范围。更新记录后，在当前视图或关联表中检查结果。",
        ],
      },
      {
        type: "callout",
        tone: "info",
        text: "阅读示例时请使用自己的账号和虚构示例数据。",
      },
      {
        type: "cards",
        items: [
          { title: "表格、字段与记录", description: "了解附件上传、关联记录、汇总与公式。", href: "/docs/tables", badge: "数据" },
          { title: "视图与看板", description: "创建视图、配置筛选排序，并查看记录。", href: "/docs/views", badge: "视图" },
          { title: "表单", description: "设计同一张表上的填报界面。", href: "/docs/forms", badge: "收集" },
          { title: "日历与预约", description: "设置服务人员排班、查看空档并管理预约。", href: "/docs/calendar-booking", badge: "日历" },
          { title: "自动化与定时任务", description: "用表格事件、外部事件或时间计划触发操作。", href: "/docs/automations", badge: "行动" },
          { title: "报告", description: "把表格数据汇总成指标与图表。", href: "/docs/reports", badge: "洞察" },
          { title: "站点", description: "编辑、预览并发布简单的网站页面。", href: "/docs/sites", badge: "发布" },
        ],
      },
    ],
  },
  {
    slug: "api-quickstart",
    sectionId: "humans",
    title: "HTTP API",
    description: "通过 REST、GraphQL 与 SDK 按逐表授权读取并修改记录。",
    body: [
      {
        type: "code",
        lang: "bash",
        code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"

curl -s "$TABDO_API_URL/api/tables" \\
  -H "Authorization: Bearer $TABDO_API_KEY"`,
      },
      {
        type: "p",
        text: "在「设置 → API Key」创建数据 Key；仅工作区 owner/admin 可管理。按表分别授予读取、新增、更新和删除权限。授权适用于该表中的全部记录；新表默认未授权，写权限也不包含读取。更改权限或删除 Key 会影响后续请求。完整 Key 只显示一次，请妥善保存。",
      },
      { type: "h2", text: "最小数据流程" },
      { type: "p", text: "先读取 GET /api/tables 或 GET /api/tables/:tableId 返回的表和字段元数据，保存 table.id、column.id 与 select 字段 options[].id。不要把字段名称或选项标签当作写入标识。以下示例中的 Key、ID 和 URL 均为虚构占位值。" },
      { type: "code", lang: "bash", code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"

# 1. 发现表、字段和选项 ID
curl -s "$TABDO_API_URL/api/tables" \\
  -H "Authorization: Bearer $TABDO_API_KEY"

# 2. 读取第一页；默认 50 条，最大 100 条
curl -s "$TABDO_API_URL/api/tables/tbl_example/rows?limit=50" \\
  -H "Authorization: Bearer $TABDO_API_KEY"

# 3. 继续下一页：用响应中的 nextCursor 替换占位值
curl -sG "$TABDO_API_URL/api/tables/tbl_example/rows" \\
  --data-urlencode "limit=50" \\
  --data-urlencode "cursor=PASTE_NEXT_CURSOR" \\
  -H "Authorization: Bearer $TABDO_API_KEY"

# 4. 新增。cells 键为字段 ID；select 值为选项 ID
curl -s -X POST "$TABDO_API_URL/api/tables/tbl_example/rows" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"cells":{"col_title":"Example task","col_status":"opt_todo"}}'

# 5. 更新。expectedVersion 应取自已读行的 version
curl -s -X PATCH "$TABDO_API_URL/api/tables/tbl_example/rows/row_example" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"cells":{"col_title":"Reviewed task"},"expectedVersion":3}'

# 6. 删除
curl -s -X DELETE "$TABDO_API_URL/api/tables/tbl_example/rows/row_example" \\
  -H "Authorization: Bearer $TABDO_API_KEY"` },
      { type: "table", headers: ["操作", "代表性成功响应"], rows: [
        ["GET rows", "{ rows: [{ id, tableId, version, cells, files, createdAt, updatedAt }], nextCursor, hasMore, totalMatched, limit }"],
        ["POST row (201)", "{ id, createdAt }"],
        ["PATCH row (200)", "{ id, updatedAt, version }"],
        ["DELETE row (200)", "{ id }"],
      ] },
      { type: "callout", tone: "warn", text: "如果 expectedVersion 过期，REST 返回 409 和 { error: \"Record changed; reload before updating\" }。重新读取行并用新 version 决定是否重试；只有明确接受最后写入覆盖时才省略 expectedVersion。只授予必需的逐表权限，读权限与写权限彼此独立。" },
      { type: "cards", items: [
        { title: "REST API", description: "完整路由、查询与响应细节。", href: "/docs/rest", badge: "REST" },
        { title: "GraphQL", description: "GraphQL 查询和变更参考。", href: "/docs/graphql", badge: "GraphQL" },
        { title: "TypeScript SDK", description: "通过 @tabdo/sdk 调用同一数据 API。", href: "/docs/sdk", badge: "SDK" },
        { title: "日历预约 API", description: "日历权限、空档查询、预约与智能体提醒。", href: "/docs/calendar-booking", badge: "日历" },
      ] },
    ],
  },
  {
    slug: "architecture",
    sectionId: "concepts",
    title: "数据访问与权限",
    description: "区分在产品中使用工作区与从应用访问表格数据的权限。",
    body: [
      {
        type: "p",
        text: "登录 tabdo 后，你可以在自己有权限的工作区中查看和编辑数据、使用智能体并管理项目。工作区角色决定谁可以邀请成员、管理智能体或创建数据 Key。",
      },
      {
        type: "callout",
        text: "如果要从自己的应用读取或修改表格数据，请让工作区 owner/admin 在「设置 → API Key」创建数据 Key，并为每张表单独选择操作权限。API Key 只访问已授权的表格和记录，不会继承创建者的其他权限，也不能修改表结构或管理工作区。",
      },
      { type: "cards", items: [
        { title: "工作区成员", description: "了解角色权限和邀请方式。", href: "/docs/members", badge: "成员" },
        { title: "HTTP API", description: "查看数据 Key 的创建入口与表格 API 用法。", href: "/docs/api-quickstart", badge: "API" },
      ] },
    ],
  },
  {
    slug: "tables",
    sectionId: "concepts",
    title: "表格、字段与行",
    description: "创建字段、录入记录，并使用附件、关联、汇总和公式。",
    body: [
      { type: "h2", text: "创建和编辑" },
      { type: "ol", items: [
        "在 /app/tables 新建表，或在 /app 对话中描述目标，让已配置的智能体创建表和字段。",
        "进入表格后，用列标题菜单添加字段、修改名称或配置；在行内点击单元格填写或修改记录。选择字段类型后，按字段配置输入值。",
        "添加单选或多选字段时，先设置用户可选的选项。人员字段可从当前工作区成员中选择。",
      ] },
      {
        type: "table",
        headers: ["字段类型", "用途"],
        rows: [
          ["文本", "填写名称、备注或其他文字。"],
          ["数字", "填写数值，可用于数值排序、筛选和计算。"],
          ["单选", "从自定义选项中选择一项。"],
          ["多选", "从自定义选项中选择一项或多项。"],
          ["附件", "为记录上传一个或多个文件。"],
          ["日期", "选择或输入日期。"],
          ["复选框", "标记记录的开启或关闭状态。"],
          ["人员", "选择工作区中的成员或智能体。"],
          ["关联", "将记录连接到另一张表中的一条或多条记录。"],
          ["汇总", "汇总关联记录中的值；结果为只读。"],
          ["公式", "根据同表的其他字段计算只读结果。"],
        ],
      },
      { type: "h2", text: "上传附件" },
      { type: "ol", items: [
        "添加 file 字段后，点击记录中的附件单元格并选择上传；上传完成后文件名会显示在单元格中，点击文件名可下载。",
        "要限制为一个文件，打开列设置并关闭‘多个文件’；默认允许多个。文件大小和上传数量受工作区限制；超出限制时减少文件数量或选择较小文件后重试。",
      ] },
      { type: "h2", text: "关联记录与汇总" },
      { type: "ol", items: [
        "添加‘关联’字段，选择目标表，并选择每条记录可关联一条或多条；可选填写反向字段名称。编辑单元格后搜索并勾选目标记录，点击已关联标签可打开目标记录继续编辑。",
        "添加‘汇总’字段，选择本表已有的关联字段，再选计算方式。数量无需目标字段；求和、平均、最小、最大使用数字字段；最早、最晚使用日期字段。",
        "汇总值随关系数据计算并显示为只读；无关联时数量与求和为 0，其他汇总为空。关联字段本身不能排序；关系列与汇总列不能互相改类型，删除关联或目标字段前需先处理依赖字段。",
      ] },
      { type: "h2", text: "公式" },
      { type: "p", text: "在列设置中把字段类型设为公式，输入表达式并选择结果类型。用 {列名} 引用同表字段，例如 {预算} * 2；支持 + - * /、&、比较运算，以及 IF、AND、OR、NOT、CONCAT、LEN、ABS、ROUND、EMPTY、VALUE、TEXT。公式自动计算且不能直接编辑；不能引用关联字段或汇总字段，也不能形成循环引用。" },
      {
        type: "callout",
        tone: "warn",
        text: "只有有权访问工作区的成员才能查看和下载附件。通过 API 添加附件时，请先在 tabdo 中上传文件。",
      },
      { type: "cards", items: [
        { title: "使用记录正文", description: "为记录启用正文、编辑长文并查看版本历史。", href: "/docs/record-documents", badge: "正文" },
        { title: "正文 API", description: "通过 REST、GraphQL 或 MCP 读取和更新正文。", href: "/docs/document-api", badge: "API" },
      ] },
    ],
  },
  {
    slug: "record-documents",
    sectionId: "humans",
    title: "使用记录正文",
    description: "为记录添加独立正文，用可视化编辑器写作、插图和恢复历史。",
    body: [
      { type: "p", text: "记录正文适合存放长文和图片，不会占用表格字段，也不会随表格行列表读取。表格继续保存标题、状态等属性，正文单独保存。" },
      { type: "ol", items: [
        "打开表格并打开一条记录，在记录详情中选择「正文」。如果记录还没有正文，选择「启用正文」开始编辑。",
        "在正文编辑器中输入文字，使用标题、列表、引用、代码块和链接等格式。使用「上传图片」添加图片；粘贴的外部图片不会自动上传。编辑器会显示保存中、已保存、未保存、保存失败或版本冲突状态。",
        "遇到版本冲突时，当前浏览器标签页会保留草稿。使用「查看服务器版本」比较内容，或导出本地草稿；确认后再加载服务器版本并继续编辑。若浏览器无法保留草稿，请保持当前标签页打开并重试保存。",
        "选择「历史」查看先前版本。打开某个版本可先预览；选择恢复会把内容保存为新版本，原历史版本不会被覆盖。",
        "在工作区已连接且获授权的 tabdo 智能体或 MCP 客户端中，可按需读取、创建或替换记录正文；图片和历史读取也需要对应权限。通过 REST 或 GraphQL 接入时，见「正文 API」。",
      ] },
      { type: "h2", text: "格式、图片与保存限制" },
      { type: "ul", items: [
        "正文使用受限格式：段落、三级标题、无序/有序列表、引用、代码块、分隔线、换行、加粗、斜体、删除线、行内代码、安全链接和图片。链接只支持完整的 http、https 或 mailto 地址。",
        "正文最多 64 KiB 序列化 JSON、4,000 个节点、12 层和 20 张被引用图片。图片支持 PNG、JPEG、WebP、GIF；每张最多 5 MiB，每篇正文最多上传 40 个文件、总计 50 MiB。",
        "正文草稿保存在当前浏览器标签页。未保存草稿不是跨设备备份；关闭标签页前确认已保存，冲突时先导出需要保留的草稿。",
      ] },
      { type: "cards", items: [
        { title: "正文 API", description: "查看授权、读写示例、历史和图片接口。", href: "/docs/document-api", badge: "API" },
        { title: "发布博客", description: "把明确选择的记录正文发布为博客文章。", href: "/docs/blogging", badge: "博客" },
      ] },
    ],
  },
  {
    slug: "members",
    sectionId: "concepts",
    title: "工作区成员",
    description: "查看成员角色，邀请同事并了解管理权限。",
    body: [
      { type: "ol", items: [
        "打开 /app/members 查看当前工作区的成员及其角色。",
        "owner/admin 可点击邀请成员，输入同事邮箱并发送邀请。受邀者接受后会以 member 身份加入工作区。",
        "owner/admin 可管理成员、智能体和 API Key；member 可使用工作区已授权的功能。若需要更高权限，请联系工作区 owner/admin。",
        "成员可在自己的目录项中更新头像；owner/admin 也可以为工作区成员更新头像。",
      ] },
      { type: "table", headers: ["角色", "可执行的管理操作"], rows: [
        ["owner", "管理工作区、成员、智能体和 API Key"],
        ["admin", "管理成员、智能体和 API Key"],
        ["member", "使用工作区已授权的功能"],
      ] },
      { type: "cards", items: [
        { title: "创建与管理智能体", description: "了解谁可以创建智能体以及如何配置。", href: "/docs/agent-auth", badge: "智能体" },
        { title: "数据访问与权限", description: "为外部应用设置逐表数据权限。", href: "/docs/architecture", badge: "权限" },
      ] },
    ],
  },
  {
    slug: "views",
    sectionId: "concepts",
    title: "视图、筛选与看板",
    description: "新建表格、看板和表单视图，用筛选与排序查看记录。",
    body: [
      { type: "ol", items: [
        "打开 /app/tables 中的一张表，使用顶部视图标签在现有视图间切换。点击加号，选择表格、看板或表单来新建视图。",
        "在表格视图中点击列标题排序；打开筛选控件，选择字段、条件和值，可添加多条条件并选择全部满足或任一满足。再次打开视图可调整条件。",
        "切换到看板视图后，在看板设置中选择用于分列的 select 字段；拖动卡片到另一列即可更新该记录的状态。可按当前状态列筛选记录。",
        "点击视图菜单可重命名、设为默认或删除视图；每张表至少保留一个视图。视图显示同一批记录，不会复制数据。",
      ] },
      {
        type: "callout",
        tone: "info",
        text: "关联字段可用于筛选但不支持排序；公式与汇总值为只读计算结果。表单视图的设计和填报步骤见「表单」。",
      },
    ],
  },
  {
    slug: "forms",
    sectionId: "humans",
    title: "表单",
    description: "设计同一张表上的填报视图并检查提交记录。",
    body: [
      { type: "ol", items: [
        "打开目标表，点击视图切换器旁的加号并选择表单。表单视图与表格、看板共用同一组字段和记录。",
        "在设计模式中拖动字段调整顺序，选择字段后修改标签、说明、必填、隐藏或只读设置；使用顶部选项切换 classic / focus 布局和主题。",
        "切换到填报模式，按表单填写并提交。成功提示出现后回到表格视图，确认新记录已经写入同一张表；编辑模式可修改当前记录。",
      ] },
      { type: "ul", items: [
        "可编辑表单标题、说明、提交按钮文案、成功提示和字段顺序；字段选项仍与表格列共用。",
        "公式和汇总字段只显示计算值，不能通过表单填写；隐藏字段不显示，必填规则在提交时校验。文件和关联字段使用对应的上传或记录选择控件。",
        "当前表单在登录后的表格页面中使用；不提供公开表单链接或独立发布入口。表单不是独立数据表，删除或修改字段会影响同表其他视图。",
      ] },
    ],
  },
  {
    slug: "calendar-booking",
    sectionId: "humans",
    title: "日历与预约",
    description: "为服务人员设置工作时间和临时休息，查询空档，并通过日历或 API 管理预约。",
    body: [
      { type: "p", text: "日历用于安排工作区内的服务预约。你可以为不同服务建立多个日历，添加服务人员、设置其工作时间和临时不可用时段，再由成员、智能体或获权的外部应用创建和维护预约。服务人员是预约负责人；它与执行操作的 AI 智能体是不同对象。" },
      { type: "h2", text: "在日历中设置排班" },
      { type: "ol", items: [
        "打开应用中的「日历」，选择已有日历或新建日历。为日历选择名称和显示时区。",
        "进入人员与排班设置，添加服务人员并选择其时区。需要时可关联一位当前工作区成员；避免为同一人重复创建身份。",
        "为服务人员设置每周工作时段。时段按所选时区重复；如需临时休息，按日期添加不可用时段，之后可编辑或撤销。",
        "在日历中查看预约。新建预约时选择服务人员、时长和可用时间；也可以先查询未来七天的空档，再选择一个时段填写预约标题。",
        "打开预约详情可查看、改期或取消预约。改期和取消会按当前版本检查；发生冲突时，原预约保留。",
      ] },
      { type: "h2", text: "提醒与定时计划" },
      { type: "ul", items: [
        "有权限的成员可在预约中设置由指定工作区智能体执行的开始前或结束时提醒。提醒详情会显示真实执行状态；它不是邮件或短信通知。",
        "开始前提醒超过预约开始时间后会跳过。预约改期或取消后，尚未接受的旧提醒会失效；已开始执行的智能体操作不保证能撤回。",
        "日历也可叠加查看工作区定时任务的预计时间和已记录的运行。预计时间只是计划预览，不表示任务已执行或占用了预约时段。要编辑计划，请打开对应定时任务。",
      ] },
      { type: "h2", text: "通过 REST API 接入" },
      { type: "p", text: "工作区 owner/admin 可在「设置 → API Key」创建 Key，并在对应日历上单独选择权限。预约详情读取、空档读取、新建、改期、取消、日历管理和触发智能体提醒是彼此独立的授权；详情读取不包含空档读取，新建也不包含详情读取。设置提醒同时需要预约更新权和触发智能体权。定时任务投影还需要单独授予对应任务的读取权限。只勾选集成所需权限。新 Key 默认没有日历授权。完整 Key 只显示一次。下面的主机、Key 与 UUID 均为虚构占位值。" },
      { type: "code", lang: "bash", code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"
export CALENDAR_ID="00000000-0000-4000-8000-000000000001"
export PERSON_ID="00000000-0000-4000-8000-000000000002"

# 查询未来七天、每次30分钟的完整空档
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/availability/query" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"personId":"'"$PERSON_ID"'","rangeStart":"2026-10-19T00:00:00Z","rangeEnd":"2026-10-26T00:00:00Z","durationMinutes":30,"stepMinutes":30}'

# 创建预约；每次写入使用新的幂等键，遇到网络中断时以原键和原请求重试
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"personId":"'"$PERSON_ID"'","title":"示例预约","time":{"start":"2026-10-20T09:00:00+08:00","end":"2026-10-20T09:30:00+08:00","timeZone":"Asia/Shanghai"},"idempotencyKey":"booking-create-demo-001"}'` },
      { type: "p", text: "空档结果包含完整标记和时区。查询只是当时的快照；创建时系统会重新检查人员排班、临时休息和已占用时间。时间请传带 UTC offset 的 RFC 3339 时刻，并提供 IANA 时区。成功写入会返回预约 ID、版本、修订号和状态。" },
      { type: "h2", text: "统一命令入口与 GraphQL" },
      { type: "p", text: "也可以把同一操作发送到 POST /api/commands，请求体使用 {\"command\": \"queryAvailability\", \"input\": {…}} 或 {\"command\": \"createBooking\", \"input\": {…}}。REST、GraphQL 与此入口使用相同的日历权限和预约校验；写入可把幂等键放在请求体，也可通过 Idempotency-Key 请求头传入。" },
      { type: "table", headers: ["操作", "REST 路径"], rows: [
        ["列出日历（GET）", "/api/calendars"],
        ["列出 / 添加服务人员（GET / POST）", "/api/calendars/:calendarId/people"],
        ["读取 / 替换每周工作时间（GET / POST）", "/api/calendars/:calendarId/people/:personId/hours"],
        ["查询日期临时休息（POST）", "/api/calendars/:calendarId/people/:personId/exceptions/query"],
        ["添加 / 编辑临时休息（POST）", "/api/calendars/:calendarId/people/:personId/exceptions"],
        ["撤销临时休息（POST）", "/api/calendars/:calendarId/people/:personId/exceptions/:exceptionId/remove"],
        ["查询空档（POST）", "/api/calendars/:calendarId/availability/query"],
        ["查询预约（POST）", "/api/calendars/:calendarId/bookings/query"],
        ["读取预约（GET）", "/api/calendars/:calendarId/bookings/:bookingId"],
        ["创建预约（POST）", "/api/calendars/:calendarId/bookings"],
        ["改期（POST）", "/api/calendars/:calendarId/bookings/:bookingId/reschedule"],
        ["取消（POST）", "/api/calendars/:calendarId/bookings/:bookingId/cancel"],
        ["批量创建 / 改期 / 取消（POST）", "/api/calendars/:calendarId/bookings/batch"],
        ["设置 / 读取提醒（POST / GET）", "/api/calendars/:calendarId/bookings/:bookingId/reminders"],
        ["查询定时任务时间（POST）", "/api/schedules/occurrences/query"],
      ] },
      { type: "p", text: "API Key 可列出已授权的日历，但不能新建日历。请由当前工作区 owner/admin 先在应用中创建日历，再到「设置 → API Key」为 Key 授权。" },
      { type: "p", text: "批量路径接受 1–100 项创建、改期或取消操作，并作为一个整体应用。任一项校验失败或发生冲突，整批都会回滚。" },
      { type: "code", lang: "bash", code: `# 改期：expectedVersion 取自最近读取的预约
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings/BOOKING_ID/reschedule" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"time":{"start":"2026-10-21T10:00:00+08:00","end":"2026-10-21T10:30:00+08:00","timeZone":"Asia/Shanghai"},"expectedVersion":1,"idempotencyKey":"booking-reschedule-demo-001"}'

# 只有已确认预约可以设置提醒。上面的改期成功后返回版本 2。
# 设置提醒需要预约更新权与「触发智能体」权；空 reminders 可撤销未接受的提醒
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings/BOOKING_ID/reminders" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expectedVersion":2,"idempotencyKey":"booking-reminder-demo-001","reminders":[{"kind":"before_start","offsetMinutes":60,"agentUserId":"agent-user-demo","prompt":"准备这次预约所需的信息。","maxLatenessMinutes":60}]}'

# 设置提醒后返回版本 3；使用该版本取消仍处于已确认状态的预约
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings/BOOKING_ID/cancel" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expectedVersion":3,"idempotencyKey":"booking-cancel-demo-001"}'` },
      { type: "code", lang: "graphql", code: `query FindSlots($input: JSON!) {
  queryAvailability(input: $input)
}` },
      { type: "code", lang: "bash", code: `curl -s -X POST "$TABDO_API_URL/api/graphql" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"query":"query FindSlots($input: JSON!) { queryAvailability(input: $input) }","variables":{"input":{"calendarId":"'"$CALENDAR_ID"'","personId":"'"$PERSON_ID"'","rangeStart":"2026-10-19T00:00:00Z","rangeEnd":"2026-10-26T00:00:00Z","durationMinutes":30,"stepMinutes":30}}}'` },
      { type: "p", text: "写入可使用 createBooking(input: $input)。GraphQL 端点为 POST /api/graphql，请求头使用 Authorization: Bearer <API Key>。" },
      { type: "h2", text: "提醒和 MCP 工具" },
      { type: "p", text: "在已经连接且获权的 Tabdo MCP 客户端中，可使用 query_availability、create_booking、reschedule_booking、cancel_booking 等日历工具。管理排班时使用 create_calendar_person、set_working_hours 和 set_availability_exception。提醒使用 set_booking_reminders 与 list_booking_reminders；查询定时计划投影使用 query_scheduled_occurrences。日历工具遵循目标日历的授权；定时任务投影还需单独拥有所选任务的读取权限。" },
      { type: "p", text: "设置提醒时传入预约当前 expectedVersion、幂等键及 0–10 项规则。before_start 的 offsetMinutes 为距开始的分钟数；at_end 使用 0。每项指定要执行的工作区智能体和任务说明。读取记录会返回配置与执行状态；运行链接仅对有权查看该对话的用户显示。" },
      { type: "h2", text: "范围、权限与排错" },
      { type: "ul", items: [
        "普通成员可依其工作区身份查看和管理预约；日历、服务人员、工作时间和临时休息设置仅 owner/admin 可管理。API Key 只访问明确授权的日历，不能通过创建预约来读取客户详情；日历权限也不会自动授予定时任务权限。",
        "预约和服务人员按工作区隔离；系统不会汇总其他工作区的忙闲。单个服务人员同一时段只能接一项预约。当前支持已确认和已取消状态，不支持预约系列、访客自助预约、支付或外部日历同步。",
        "空档结果只包含可约时段，不会返回预约标题或客户详情。读取预约详情需要单独的读取授权。",
        "预约查询范围最长 93 天、最多 500 项；空档查询最长 31 天、最多 5000 个时段。结果没有游标分页；超出查询预算会明确返回错误，不会静默截断并把遗漏时间当成空档。",
        "改期、取消与排班修改需要提交读取到的 expectedVersion。收到 VERSION_CONFLICT 时重新读取并确认最新预约或排班后再操作；收到 RESOURCE_CONFLICT 或 OUTSIDE_AVAILABILITY 时重新查询空档。",
        "创建和其他写入均需幂等键。同一请求因网络中断重试时，复用原输入和原幂等键；不要用相同键发送不同内容。已取消预约不能恢复，可另建预约。",
        "若收到 FORBIDDEN，请 owner/admin 检查该 Key 对目标日历是否有对应授权；若收到 QUERY_LIMIT，请缩小日期范围。归档前须先处理未来预约，历史记录会保留。",
      ] },
      { type: "cards", items: [
        { title: "自动化与定时任务", description: "创建定时任务并查看运行记录。", href: "/docs/automations", badge: "自动化" },
        { title: "HTTP API", description: "了解 API Key 与 REST、GraphQL 接入基础。", href: "/docs/api-quickstart", badge: "API" },
      ] },
    ],
  },
  {
    slug: "automations",
    sectionId: "humans",
    title: "自动化与定时任务",
    description: "从表格变化、Webhook、邮件或时间计划触发智能体和数据操作。",
    body: [
      { type: "h2", text: "事件自动化" },
      { type: "ol", items: [
        "打开 /app/automations，点击新建；或从表格的自动化入口开始。选择来源：一张表、已连接的 AgentMail 收件箱，或已创建的 Webhook 接收端点。",
        "表格来源可选择新增记录、字段变更或进入某个单选状态作为触发条件，并设置字段条件；邮件和 Webhook 来源可设置事件条件。",
        "添加至少一个操作，例如更新字段或运行已创建的智能体。命名并保存，确认规则处于启用状态。",
        "回到自动化列表或打开规则查看运行记录和结果；失败记录会显示错误，修正规则后可继续观察后续运行。",
      ] },
      { type: "h2", text: "定时任务" },
      { type: "ol", items: [
        "打开 /app/schedules 并新建任务，填写名称、选择智能体和任务提示词。",
        "选择每天、每周或输入 Cron 表达式，设置时区，启用并保存。保存后在任务详情查看运行记录；打开某次运行可查看对应对话结果。",
      ] },
      { type: "callout", tone: "info", text: "自动化的来源类型创建后不可更改；需要更换来源时请新建规则。定时任务会在设定时间运行所选智能体；若智能体不可用，本次运行可能失败。可通过运行记录查看结果和错误。" },
    ],
  },
  {
    slug: "integrations",
    sectionId: "humans",
    title: "集成来源：AgentMail 与 Webhook",
    description: "配置邮件或 HTTP 事件来源，并在自动化中查看处理结果。",
    body: [
      { type: "ol", items: [
        "打开 /app/settings 的 AgentMail 或 Webhook 设置。管理集成需要工作区管理员权限；先创建一个来源，再到 /app/automations 建立对应自动化。",
        "AgentMail：添加连接名称和服务 API Key，测试连接，加载收件箱并选择要订阅的收件箱，完成后复制生成的接收地址。收到新邮件可触发自动化。",
        "Webhook：创建接收端点并保存生成的 URL 与令牌；将事件发送到该 URL，再在自动化来源中选择该端点。URL 可再次查看，创建时显示的令牌只提供一次，请妥善保存。",
        "在集成设置查看启用状态和最近错误；在自动化规则中查看运行记录及处理结果。连接凭证可以更新，端点和连接也可以停用或删除。",
      ] },
      { type: "callout", tone: "warn", text: "目前可添加的事件来源是 AgentMail 和入站 Webhook。请勿公开 AgentMail API Key、Webhook 令牌或专用接收地址。" },
      { type: "cards", items: [
        { title: "自动化与定时任务", description: "将邮件或 Webhook 事件连到数据更新或智能体操作。", href: "/docs/automations", badge: "后续步骤" },
      ] },
    ],
  },
  {
    slug: "reports",
    sectionId: "humans",
    title: "报告",
    description: "用指标、图表和说明文字汇总工作区表格。",
    body: [
      { type: "ol", items: [
        "打开 /app/reports，选择新建报告并填写名称和说明。",
        "添加指标、图表或文字组件。指标选择来源表和计数、求和或平均值；图表选择来源表、分组字段、指标和图表类型；文字组件用于补充说明。",
        "在设计和预览模式间切换，调整组件标题、宽度和位置；保存后返回报告列表，再次打开即可查看汇总结果。数据变化后报告会刷新。",
      ] },
      { type: "ul", items: [
        "图表可用类型包括柱形、横向柱形、折线、面积、饼、环形、雷达、径向、散点、漏斗和矩形树图。",
        "报告汇总工作区表格；求和与平均需要数字字段。报告仅供登录工作区的成员查看，没有公开分享链接。",
        "若图表分组数据超过系统展示上限，图表会提示结果已截断；遇到空值或不兼容字段时，调整来源字段或指标设置。",
      ] },
    ],
  },
  {
    slug: "sites",
    sectionId: "humans",
    title: "站点",
    description: "编辑 HTML、CSS 和 JavaScript 文件，预览并发布站点版本。",
    body: [
      { type: "ol", items: [
        "打开 /app/sites 并创建站点。系统提供 index.html、styles.css、app.js 和 tabdo-config.js 起始文件。",
        "在站点编辑器中编辑网站文件，并使用预览检查草稿。可添加 HTML、CSS、JS、MJS、JSON、SVG、TXT 或 MD 文件；保存后会生成新版本。",
        "发布已保存版本后，从站点详情复制公开地址并打开检查；修改后再次保存并发布新版本。站点历史可查看旧版本并恢复；可随时撤下已发布版本。",
        "如需读取或提交表格数据，在编辑器选择连接数据，粘贴单独创建的 tab_ API Key。只授予该站点必需表格与操作权限，保存后用预览验证。",
      ] },
      { type: "callout", tone: "warn", text: "站点编辑器可直接编辑网站文件；每个站点最多 50 个文件，文件类型见上方列表。发布时使用已保存的版本。tab_ Key 会随站点前端代码提供，不能存放高权限凭证；Key 只应授予必要的逐表数据权限。" },
      { type: "cards", items: [
        { title: "发布博客", description: "从正文记录中选择文章、预览并发布博客。", href: "/docs/blogging", badge: "博客" },
        { title: "HTTP API 与数据访问 Key", description: "了解 tab_ Key 的逐表权限和访问边界。", href: "/docs/api-quickstart", badge: "安全" },
      ] },
    ],
  },
  {
    slug: "blogging",
    sectionId: "humans",
    title: "发布博客",
    description: "从表格正文中选择文章，检查预览后发布和更新博客。",
    body: [
      { type: "p", text: "博客把你选中的记录正文整理成可公开阅读的文章。每次构建和发布都是固定版本；你可以先预览，再决定是否让读者访问。" },
      { type: "ol", items: [
        "在工作区打开「站点」，新建博客并选择一张内容表。先在表格中为文章记录启用正文，再用可视化正文编辑器写作、插入图片并等待保存状态显示已保存。正文历史可用于查看和恢复先前版本。",
        "在博客设置中映射标题和 URL slug；按需映射摘要、作者、日期、封面、分类和标签。逐篇选择要发布的记录，并逐项选择正文图片和封面。未选中的记录、关联记录和附件不会加入博客。",
        "保存配置后构建博客。查看构建结果和预览链接；预览链接在 10 分钟后过期，任何持有链接的人都可访问。预览不进入搜索索引；你也可以提前撤销所有预览链接。",
        "检查无误后发布构建版本。发布后复制博客地址分享给读者。继续编辑正文或博客设置不会自动改动线上文章；发现待发布更改时，重新构建、预览并发布，线上内容才会更新。",
        "要撤下一篇文章，选择该文章并确认撤回；要停止整个博客，选择撤下博客。也可以恢复内部历史配置作为新草稿，再重新构建并发布。",
      ] },
      { type: "h2", text: "发布内容与访问范围" },
      { type: "ul", items: [
        "每篇正文的受限 JSON 内容最多 64 KiB（按完整序列化 JSON 字节计算），最多 4,000 个节点、12 层和 20 张图片。博客生成的全部 HTML 另有 4 MiB 总预算。每个博客最多选择 20 篇文章；图片资源最多 60 个、每个最多 5 MiB、总计最多 30 MiB，仅支持 PNG、JPEG、WebP 和 GIF。",
        "公开内容包括已映射并选择的文章字段、正文和选中的图片。作者显示为公开姓名，不包含邮箱或内部成员 ID；不要在公开字段、正文或链接中放入秘密或私人资料。",
        "博客发布的是内容快照。源记录或正文后续变化不会同步到线上；重新构建前请确认所选记录、图片和公开字段仍正确。",
        "撤回会阻止博客旧版本中的文章和图片继续通过博客地址访问；已被读者下载、复制或缓存到其他位置的副本无法远程收回。删除来源前，先按需要撤回相应文章。",
        "删除博客前必须先撤下整站。博客历史版本和暂存上传可能在站点删除前保留；每个博客最多保留 100 个历史版本，达到上限后请新建博客继续发布。",
      ] },
      { type: "h2", text: "权限与排错" },
      { type: "ul", items: [
        "工作区成员需有权查看并编辑所选记录和正文。通过 API 连接时，owner/admin 在「设置 → API Key」为内容表单独授予博客读取、配置、构建、发布或恢复权限；只授予实际需要的权限。",
        "若正文没有出现在文章中，请确认已启用正文并等待保存完成。出现版本冲突时，编辑器会保留当前标签页中的草稿，并提供查看服务器版本、导出草稿或导出后加载服务器版本的选项；先比较两份内容，再决定如何继续。历史版本可先预览，再恢复为新版本。构建提示来源已变化时，重新读取记录、核对内容并重新构建。",
        "若 slug 重复或格式无效，请为每篇文章设置唯一的小写英文、数字和连字符 slug。若无法发布或预览，请检查 Key 的对应权限、构建版本和待发布更改；过期预览需要重新生成。",
      ] },
      { type: "cards", items: [
        { title: "博客 API", description: "通过 REST、GraphQL 或可用的 MCP 工具读取和管理博客。", href: "/docs/blog-api", badge: "API" },
        { title: "使用记录正文", description: "了解正文编辑器、自动保存状态、冲突草稿和历史恢复。", href: "/docs/record-documents", badge: "正文" },
      ] },
    ],
  },

  {
    slug: "rest",
    sectionId: "reference",
    title: "数据 REST API",
    description: "tab_ Key 的表元数据、分页读取和记录 CRUD 路径。",
    body: [
      {
        type: "table",
        headers: ["HTTP 路径", "用途与授权"],
        rows: [
          ["GET /api/tables", "列出可访问表与字段元数据；受表级授权过滤"],
          ["GET /api/tables/:tableId", "读取表元数据与字段"],
          ["GET /api/tables/:tableId/rows?limit=&cursor=&includeTotal=", "读取一页记录；默认 50、最大 100，需 read grant"],
          ["POST /api/tables/:tableId/rows/query", "按 JSON filters、filterLogic、sort、cursor、limit 查询；需 read grant"],
          ["GET /api/tables/:tableId/rows/:rowId", "读取单条记录；需 read grant"],
          ["POST /api/tables/:tableId/rows", "{ cells: { columnId: value } } 新增；需 create grant"],
          ["PATCH /api/tables/:tableId/rows/:rowId", "{ cells, expectedVersion? } 更新；需 update grant"],
          ["DELETE /api/tables/:tableId/rows/:rowId", "删除记录；需 delete grant"],
        ],
      },
      { type: "h2", text: "请求与响应" },
      { type: "p", text: "所有数据路由使用 Authorization: Bearer tab_…，JSON 写请求需 Content-Type: application/json。读页面响应包含 rows、nextCursor、hasMore、totalMatched 和 limit；未请求 includeTotal=true 时 totalMatched 为 null。REST 成功直接返回资源数据，不包在 { ok, result } 中。" },
      { type: "code", lang: "json", code: `// POST /api/tables/tbl_example/rows
{ "cells": { "col_title": "New task", "col_status": "opt_todo" } }

// PATCH /api/tables/tbl_example/rows/row_example
{ "cells": { "col_title": "Updated task" }, "expectedVersion": 3 }

// stale version: HTTP 409
{ "error": "Record changed; reload before updating" }` },
      { type: "ul", items: [
        "cells 只接受 API 可写字段：text、number、date、checkbox、select、multi_select。select 值使用字段元数据的 options[].id，不使用标签。删除带有关联记录的行时，可能还需要目标表的 update 权限以移除反向关联。",
        "请求体上限 128 KiB；每个 Key 默认每分钟最多 120 次读取、20 次写入。限流依赖服务可用，不可用时拒绝请求。",
        "常见状态码：400 输入错误、401 Key 无效、403 操作无授权、404 表或记录不可见、409 版本冲突、413 请求体过大、429 超限、500 服务器错误、503 限流服务不可用。错误体为 { error: string }。",
      ] },
      { type: "cards", items: [
        { title: "HTTP API 入门", description: "查看从发现表到记录 CRUD 的完整流程。", href: "/docs/api-quickstart", badge: "指南" },
        { title: "GraphQL", description: "查询、分页与受限变更。", href: "/docs/graphql", badge: "GraphQL" },
      ] },
    ],
  },
  {
    slug: "graphql",
    sectionId: "reference",
    title: "GraphQL API",
    description: "通过固定 GraphQL Schema 读取表和记录，并执行受限记录变更。",
    body: [
      { type: "p", text: "GraphQL 端点为 POST /api/graphql，也接受带 query 参数的 GET。使用 Authorization: Bearer tab_…；兼容请求头 X-Tabdo-Key 仍可用。所有请求都使用 Authorization 请求头中的 tab_ Key。" },
      { type: "code", lang: "graphql", code: `query Browse($tableId: ID!, $limit: Int!, $cursor: String) {
  table(id: $tableId) {
    id
    name
    columns { id name type options { id label color } readable writable }
    rows(options: { limit: $limit, cursor: $cursor }) {
      rows { id version cells createdAt updatedAt }
      nextCursor
      hasMore
      totalMatched
    }
  }
}` },
      { type: "code", lang: "json", code: `{
  "query": "query Browse($tableId: ID!, $limit: Int!, $cursor: String) { table(id: $tableId) { id name columns { id name type options { id label color } readable writable } rows(options: { limit: $limit, cursor: $cursor }) { rows { id version cells createdAt updatedAt } nextCursor hasMore totalMatched } } }",
  "variables": { "tableId": "tbl_example", "limit": 50, "cursor": null }
}` },
      { type: "p", text: "查询 tables 或 table(id)、columns、rows(options) 与 row(id)。rows 每页默认 50，最大 100；把返回的 nextCursor 传回 options.cursor。数据位于标准 { data } 响应中。" },
      { type: "h2", text: "记录变更" },
      { type: "code", lang: "graphql", code: `mutation UpdateTask($tableId: ID!, $rowId: ID!, $cells: JSON!, $version: Int) {
  updateRow(tableId: $tableId, rowId: $rowId, cells: $cells, expectedVersion: $version) {
    id updatedAt version
  }
}` },
      { type: "p", text: "Mutation 还包括 createRow(tableId,cells) 与 deleteRow(tableId,rowId)。一次操作最多包含一个 mutation。cells 使用字段 ID；select/multi_select 的值用字段 options 中的 ID。create、update、delete 分别要求对应表级授权。" },
      { type: "code", lang: "json", code: `{
  "data": { "updateRow": { "id": "row_example", "updatedAt": "2026-01-02T03:06:00.000Z", "version": 4 } }
}` },
      { type: "h2", text: "错误与限制" },
      { type: "p", text: "GraphQL 语法与字段错误返回 { errors: [{ message, extensions: { code } }] }；常见 code 包括 UNAUTHENTICATED、FORBIDDEN、NOT_FOUND、BAD_USER_INPUT、CONFLICT、RATE_LIMITED、SERVICE_UNAVAILABLE 和 QUERY_TOO_COMPLEX。发生 CONFLICT 时重新读取记录，用最新 version 判断后再更新。" },
      { type: "ul", items: [
        "请求体最大 128 KiB；每个 Key 默认每分钟 120 次读取、20 次写入。",
        "查询深度最大 16，根字段最多 20 个，展开后的选择字段最多 1000 个；单次操作最多 30 次行解析器调用、预算总计最多 1000 行，且不支持批量变更。",
        "GraphQL 查询和变更遵循与 REST 相同的逐表授权和可写字段范围。",
      ] },
      { type: "cards", items: [{ title: "REST API", description: "使用 HTTP 路径与 JSON 请求体完成数据访问。", href: "/docs/rest", badge: "REST" }, { title: "SDK", description: "TypeScript 客户端封装 GraphQL 和常见表操作。", href: "/docs/sdk", badge: "SDK" }] },
    ],
  },
  {
    slug: "sdk",
    sectionId: "reference",
    title: "JavaScript / TypeScript SDK",
    description: "通过 @tabdo/sdk 访问 tab_ 授权的数据 API。",
    body: [
      { type: "p", text: "从 npm 安装公开的 @tabdo/sdk 包，并使用 createClient 连接你的 tabdo 地址和 tab_ 数据访问 Key。SDK 用于访问表格数据，不使用浏览器登录会话。" },
      { type: "code", lang: "bash", code: `npm install @tabdo/sdk` },
      { type: "code", lang: "typescript", code: `import { createClient } from "@tabdo/sdk";

const client = createClient({
  url: process.env.TABDO_API_URL!,
  key: process.env.TABDO_API_KEY!,
});

const tables = await client.tables();
const table = client.table(tables[0].id);
const columns = await table.columns();
const page = await table.list({ limit: 50 });

const created = await table.create({
  col_title: "Example task",
  col_status: "opt_todo", // use options[].id from column metadata
});

const row = await table.get(created.id);
if (row) {
  await table.update(row.id, { col_title: "Reviewed task" }, { expectedVersion: row.version });
  await table.delete(row.id);
}` },
      { type: "ul", items: [
        "client.tables() 列出可访问表；client.table(id).columns() 获取字段元数据。table.list(options, { signal }) 返回 rows 与 nextCursor，可把游标传入下一次 list。默认 limit 50，最大 100。",
        "table.get(id) 读取单行；table.create(cells)、table.update(id,cells,{ expectedVersion })、table.delete(id) 分别执行记录操作。写入键是字段 ID，选项值是 option ID。",
        "client.graphql<T>(query, variables, { operationName, signal }) 可执行 GraphQL。请求失败抛出 TabdoApiError，包含 code、status 与 errors；SDK 不会自动重试变更。",
      ] },
      { type: "callout", tone: "info", text: "不要把高权限 Key 嵌入公开网页；浏览器代码会暴露 Key。私密集成请将 Key 保存在环境变量中；公开站点应使用仅具所需逐表权限的专用 Key。" },
      { type: "cards", items: [{ title: "API 入门", description: "查看完整 REST 流程和权限说明。", href: "/docs/api-quickstart", badge: "指南" }, { title: "GraphQL", description: "查看 GraphQL Schema 与限制。", href: "/docs/graphql", badge: "GraphQL" }] },
    ],
  },
  {
    slug: "blog-api",
    sectionId: "reference",
    title: "博客 API",
    description: "使用专用博客权限，通过 REST、GraphQL 或 MCP 管理博客快照。",
    body: [
      { type: "p", text: "博客命令可通过 API Key 的 REST 命令入口和 GraphQL 使用。博客权限按内容表单独授予；旧的数据读写权限或正文权限不会自动获得博客配置、构建或发布权限。博客相关的 npm SDK 方法尚未在公开版本提供。" },
      { type: "h2", text: "创建访问 Key" },
      { type: "ol", items: [
        "请工作区 owner/admin 打开「设置 → API Key」并创建专用 Key。仅添加需要访问的内容表及博客权限：canRead 读取来源和配置，canConfigure 保存博客设置，canBuild 构建和预览，canPublish 授权该 Key 发布或撤回，canRestore 恢复历史配置。",
        "将完整 Key 存放在服务端密钥管理或环境变量中，不放在浏览器、公开网页、博客正文或 URL 中。完整 Key 只显示一次；删除 Key 可撤销后续访问。",
        "博客 API 的写命令都要提供 1–200 字符的幂等键。可通过 Idempotency-Key 请求头提供；不要为同一请求的重试生成新值。相同 Key 重放会返回原结果；相同 Key 用于不同请求会返回冲突。",
      ] },
      { type: "h2", text: "REST 命令入口" },
      { type: "p", text: "向 POST /api/commands 发送 JSON，使用 Authorization: Bearer tab_…。每个请求包含 command 和 input；写操作应附带 Idempotency-Key。以下是只读示例，使用虚构 ID 和占位 Key：" },
      { type: "code", lang: "bash", code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"

curl -s -X POST "$TABDO_API_URL/api/commands" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"getBlogSources","input":{"tableId":"00000000-0000-4000-8000-000000000001","limit":20}}'` },
      { type: "p", text: "创建博客时调用 saveBlog。以下配置使用虚构 UUID；将字段 ID、表 ID 和记录 ID 替换为 getBlogSources 与字段元数据返回的值。REST 命令成功响应为 { ok, command, result }。BlogDetail 的站点 ID 字段名是 id：从 saveBlog 读取时，REST 使用 result.id、GraphQL 使用 data.saveBlog.id；从 getBlog 读取时，REST 使用 result.id、GraphQL 使用 data.getBlog.id。" },
      { type: "code", lang: "json", code: `{
  "command": "saveBlog",
  "input": {
    "name": "Field Notes",
    "idempotencyKey": "save-blog-example-1",
    "config": {
      "tableId": "00000000-0000-4000-8000-000000000001",
      "authorName": "Tabdo Team",
      "description": "Notes and updates",
      "language": "en",
      "mapping": {
        "title": "00000000-0000-4000-8000-000000000011",
        "slug": "00000000-0000-4000-8000-000000000012"
      },
      "articles": [{
        "rowId": "00000000-0000-4000-8000-000000000021",
        "imageIds": []
      }]
    }
  }
}` },
      { type: "p", text: "使用 saveBlog 成功结果的 result.id（GraphQL 为 data.saveBlog.id）作为 siteId，并用其 version 调用 buildBlog。构建成功后，从结果的 result.id（GraphQL 为 data.buildBlog.id）取 siteId，从 result.revisionId 取 buildId；publishBlog 的 expectedVersion 和 expectedPublishedRevisionId 也取自这份构建结果。首次发布的 expectedPublishedRevisionId 为 null；更新发布内容前重新读取并确认当前线上版本。" },
      { type: "code", lang: "json", code: `{
  "command": "buildBlog",
  "input": {
    "siteId": "00000000-0000-4000-8000-000000000002",
    "expectedVersion": 1,
    "idempotencyKey": "build-blog-example-1"
  }
}` },
      { type: "code", lang: "json", code: `{
  "command": "publishBlog",
  "input": {
    "siteId": "00000000-0000-4000-8000-000000000002",
    "expectedVersion": 2,
    "expectedPublishedRevisionId": null,
    "buildId": "00000000-0000-4000-8000-000000000003",
    "idempotencyKey": "publish-blog-example-1"
  }
}` },
      { type: "p", text: "getBlogSources 返回可选文章字段、正文版本和可明确选择的图片；limit 最大为 50，可用 nextAfterId 继续分页。getBlog 读取配置、当前构建、已发布文章、历史版本和 pendingChanges。saveBlog 保存模板与显式文章列表；buildBlog 从当前来源生成固定快照；createBlogPreview 返回 10 分钟分享链接；publishBlog 发布指定 buildId；withdrawBlogArticle 撤回单篇；unpublishBlog 撤下整站；restoreBlogRevision 将历史配置恢复成新草稿。博客 REST 请求体上限为 128 KiB，具体博客内容和图片预算见博客使用指南。" },
      { type: "h2", text: "GraphQL" },
      { type: "p", text: "GraphQL 入口为 POST /api/graphql，同样使用 Authorization: Bearer tab_… 和专用博客权限。每个命令以 JSON input 作为参数；读取命令放在 query，写命令放在 mutation。对 REST 和 GraphQL 写操作使用相同的幂等键与版本前提。" },
      { type: "code", lang: "graphql", code: `query ReadBlog($input: JSON!) {
  getBlog(input: $input)
}` },
      { type: "code", lang: "json", code: `{
  "query": "query ReadBlog($input: JSON!) { getBlog(input: $input) }",
  "variables": { "input": { "siteId": "00000000-0000-4000-8000-000000000002" } }
}` },
      { type: "p", text: "写命令使用 Idempotency-Key 请求头；GraphQL 单次请求体上限为 128 KiB。GraphQL 返回标准 { data } 或 { errors }。常见错误包括 FORBIDDEN（缺少权限）、NOT_FOUND（对象不存在或不可见）、VERSION_CONFLICT（配置或发布版本已变化）、SOURCE_CHANGED（来源变化，需要重新构建）、IDEMPOTENCY_MISMATCH（幂等键被不同请求复用）和 LIMIT_EXCEEDED（超过博客预算）。发生版本冲突时重新调用 getBlog 并核对后再继续。" },
      { type: "h2", text: "MCP 与公开阅读" },
      { type: "p", text: "已连接 tabdo MCP 的客户端可使用 get_blog_sources、get_blog、save_blog、build_blog、create_blog_preview、revoke_blog_previews、publish_blog、withdraw_blog_article、unpublish_blog 和 restore_blog_revision 工具。MCP 调用遵循同一组内容表博客权限；发布权限只应交给受信任的集成。" },
      { type: "p", text: "已发布博客无需 Key 即可公开读取：GET /s/{siteId}/（即 getBlog 返回的 publicUrl）可访问文章列表；文章、分页、分类和选中图片使用该地址下的子路径。未发布内容、撤下文章的旧路径以及已撤下博客不可公开读取。预览 URL 是任何持链接者均可访问的短时链接，不要将其当作私有登录预览。" },
      { type: "callout", tone: "warn", text: "不要将可发布的 Key 交给浏览器或不受信任的自动化。保存、构建和发布是不同操作；只有明确授权的 Key 才能发布，重新构建不会自动更新线上内容。" },
      { type: "cards", items: [
        { title: "发布博客", description: "查看从正文写作到发布和撤回的完整步骤。", href: "/docs/blogging", badge: "指南" },
        { title: "API Key", description: "了解 Key 的创建、逐表授权和使用边界。", href: "/docs/auth", badge: "权限" },
      ] },
    ],
  },
  {
    slug: "document-api",
    sectionId: "reference",
    title: "正文 API",
    description: "通过 REST、GraphQL 或 MCP 按需读取、创建、替换和恢复记录正文。",
    body: [
      { type: "p", text: "正文接口按需访问一条记录的正文，不会把正文混进表格行查询。API Key 需要单独的正文权限；表格读写授权、博客权限和正文授权彼此独立。" },
      { type: "h2", text: "为 Key 配置最小权限" },
      { type: "ol", items: [
        "请工作区 owner/admin 在「设置 → API Key」为目标内容表配置正文权限。canRead 读取当前正文、图片和安全渲染；canCreate 创建正文；canUpdate 替换正文；canReadHistory 读取历史；canRestore 恢复历史（还需 canReadHistory）；canUpload 上传图片。",
        "只授予调用方所需操作。创建权限不会隐含正文读取或历史权限；正文权限也不会授予表格 CRUD、博客发布或其他工作区权限。",
        "请求使用 Authorization: Bearer tab_…；不要把 Key 放进 URL 或公开网页。所有写命令都需 1–200 字符的 idempotencyKey，也可通过 Idempotency-Key 请求头传入；相同请求重试时复用原值。",
      ] },
      { type: "h2", text: "REST 命令示例" },
      { type: "p", text: "POST /api/commands 接受 { command, input } 并返回 { ok, command, result }。下面先读取正文，再展示创建和替换的命令形状；将示例 UUID 换成 Key 已获授权的表与记录 ID。createDocument 只返回版本回执，不隐含读取权限；创建后如需正文内容，再单独调用 getDocument。" },
      { type: "code", lang: "bash", code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"

# Read; result is null if this row has no body yet
curl -s -X POST "$TABDO_API_URL/api/commands" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"getDocument","input":{"tableId":"00000000-0000-4000-8000-000000000001","rowId":"00000000-0000-4000-8000-000000000002"}}'

# Create on a row that does not have a body
curl -s -X POST "$TABDO_API_URL/api/commands" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: create-body-example-1" \\
  -d '{"command":"createDocument","input":{"tableId":"00000000-0000-4000-8000-000000000001","rowId":"00000000-0000-4000-8000-000000000002","idempotencyKey":"create-body-example-1","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"A first draft."}]}]}}}'

# Replace after reading the current version
curl -s -X POST "$TABDO_API_URL/api/commands" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: replace-body-example-1" \\
  -d '{"command":"replaceDocument","input":{"tableId":"00000000-0000-4000-8000-000000000001","rowId":"00000000-0000-4000-8000-000000000002","expectedVersion":1,"idempotencyKey":"replace-body-example-1","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"An updated draft."}]}]}}}'` },
      { type: "p", text: "REST 成功回执位于 result；getDocument 返回 { id, tableId, rowId, version, content, updatedAt } 或 null。替换时使用刚读到的 version 作为 expectedVersion；过期版本返回 409 VERSION_CONFLICT，先重读并比较草稿，不要覆盖新版本。写请求幂等键长度为 1–200；普通 REST 请求体上限为 128 KiB，单独上传正文图片的请求可使用 8 MiB 请求体预算。" },
      { type: "h2", text: "REST 路径与 GraphQL" },
      { type: "table", headers: ["操作", "REST 路径", "最低正文权限"], rows: [
        ["读取/创建/替换", "GET/POST/PUT /api/tables/{tableId}/rows/{rowId}/document", "canRead / canCreate / canUpdate"],
        ["列出历史/读取历史版本", "GET /api/tables/{tableId}/rows/{rowId}/document/revisions?limit=&beforeVersion=；GET /api/tables/{tableId}/rows/{rowId}/document/revisions/{version}", "canReadHistory"],
        ["恢复历史", "POST /api/tables/{tableId}/rows/{rowId}/document/restore", "canRestore + canReadHistory"],
        ["安全渲染", "GET /api/tables/{tableId}/rows/{rowId}/document/render?version=", "canRead；读取旧版本另需 canReadHistory"],
        ["上传/读取图片", "POST /api/tables/{tableId}/rows/{rowId}/document/images；GET /api/tables/{tableId}/rows/{rowId}/document/images/{fileId}", "canUpload / canRead"],
      ] },
      { type: "p", text: "GraphQL 地址为 POST /api/graphql。以 getDocument(input: JSON!) 读取；createDocument、replaceDocument、restoreDocumentRevision、uploadDocumentImage 等写命令使用 mutation。请求带 Authorization: Bearer tab_…；变更传 Idempotency-Key，并在 input 中提供同一个 idempotencyKey。普通 GraphQL 请求体上限 128 KiB；单独的 uploadDocumentImage mutation 可使用 8 MiB 请求体预算。" },
      { type: "code", lang: "graphql", code: `query ReadBody($input: JSON!) {
  getDocument(input: $input)
}

mutation ReplaceBody($input: JSON!) {
  replaceDocument(input: $input)
}` },
      { type: "code", lang: "json", code: `{
  "query": "query ReadBody($input: JSON!) { getDocument(input: $input) }",
  "variables": { "input": { "tableId": "00000000-0000-4000-8000-000000000001", "rowId": "00000000-0000-4000-8000-000000000002" } }
}` },
      { type: "code", lang: "json", code: `{
  "query": "mutation ReplaceBody($input: JSON!) { replaceDocument(input: $input) }",
  "variables": { "input": {
    "tableId": "00000000-0000-4000-8000-000000000001",
    "rowId": "00000000-0000-4000-8000-000000000002",
    "expectedVersion": 1,
    "idempotencyKey": "replace-body-example-2",
    "content": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "An updated draft." }] }] }
  } }
}` },
      { type: "h2", text: "图片、历史和内容预算" },
      { type: "ul", items: [
        "内容是 schemaVersion 1 的受限 JSON，不接收任意 HTML。支持段落、heading level 1–3、列表、引用、codeBlock、分隔线、换行、图片，以及 bold、italic、strike、code 和安全链接标记。链接仅限完整 http、https、mailto URL；未知节点、属性和不正确结构会被拒绝。",
        "完整序列化正文 JSON 最多 64 KiB，最多 4,000 个节点、12 层和 20 张被引用图片。单张图片最多 5 MiB；每篇正文最多上传 40 个图片文件、累计 50 MiB。",
        "先调用 uploadDocumentImage，base64 不带 data URL 前缀，并提供当前 expectedVersion、文件名、PNG/JPEG/WebP/GIF MIME 类型和幂等键。响应中的 fileId 可放入图片节点 attrs.fileId，alt 文本放入 attrs.alt，再调用 replaceDocument 保存正文。图片属于该正文，不能跨记录引用。",
        "getDocumentImage 只返回当前获权正文中的图片 base64。renderDocument 返回安全 HTML 和私有图片清单；其中相对图片路径不是公开下载链接。不要把私有文件 URL、Key 或 token 写进内容。",
        "listDocumentRevisions 默认返回 20 条，最多 50 条；用 nextBeforeVersion 读取更早历史。getDocumentRevision 读取指定版本；restoreDocumentRevision 传历史 version、当前 expectedVersion 和新幂等键，恢复结果会成为新版本。",
      ] },
      { type: "h2", text: "MCP 工具与错误" },
      { type: "p", text: "已连接 tabdo MCP 的客户端可使用 get_document、create_document、replace_document、list_document_revisions、get_document_revision、restore_document_revision、render_document、upload_document_image 和 get_document_image。读取示例为 get_document({ tableId, rowId })；替换时提供 tableId、rowId、当前 expectedVersion、受限 JSON content 和 idempotencyKey。工具使用相同的表级正文权限和版本检查；仅提供所需工具与授权。" },
      { type: "p", text: "常见错误：FORBIDDEN 表示缺少该操作权限；NOT_FOUND 表示正文/图片不存在或不在授权范围；VERSION_CONFLICT 表示正文已更新；IDEMPOTENCY_MISMATCH 表示同一重试键用于了不同输入；BAD_INPUT 或 ATTACHMENT_LIMIT 表示内容结构或图片预算不符合限制。发生版本冲突时先读取新版本并比较本地草稿。" },
      { type: "cards", items: [
        { title: "使用记录正文", description: "查看编辑、冲突草稿、图片和历史恢复步骤。", href: "/docs/record-documents", badge: "指南" },
        { title: "发布博客", description: "选择并显式发布记录正文快照。", href: "/docs/blogging", badge: "博客" },
      ] },
    ],
  },
  {
    slug: "auth",
    sectionId: "reference",
    title: "鉴权",
    description: "在 tabdo 中使用登录账号；访问已授权的表格数据时使用 tab_ Key。",
    body: [
      {
        type: "ul",
        items: [
          "登录账号：使用 tabdo 账号访问工作区功能。",
          "数据访问 Key：工作区 owner/admin 在「设置 → API Key」创建 Authorization: Bearer tab_…；只对逐表勾选的记录读取、新增、更新、删除权限生效。",
          "tab_ Key 不授予修改表结构、管理工作区或运行智能体的权限；不支持的操作会被拒绝。",
        ],
      },
    ],
  },
];
