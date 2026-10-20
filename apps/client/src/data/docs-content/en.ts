import type { DocsPage, DocsSection } from "./types";

export const docsSections: DocsSection[] = [
  { id: "welcome", title: "Welcome", description: "What tabdo is and how to start", audience: "both" },
  { id: "agents", title: "AI agents", description: "Create, configure, and use workspace agents", audience: "agents" },
  { id: "humans", title: "Setup for Humans", description: "Workspace guides and product features", audience: "humans" },
  { id: "concepts", title: "Concepts", description: "Tables, members, views", audience: "both" },
  { id: "reference", title: "References", description: "Data APIs and authentication", audience: "ref" },
];

export const docsPages: DocsPage[] = [
  {
    slug: "welcome",
    sectionId: "welcome",
    title: "Welcome",
    description: "Bring tabdo a personal plan or small team project; let AI organize information and move it forward.",
    body: [
      {
        type: "p",
        text: "Bring tabdo the information you want to organize, a trip you are planning, or a small team project you are moving forward. AI can turn what you already know into a plan and records, then help make updates. Review the result in a table, board, or form, add details, and adjust the next step.",
      },
      {
        type: "callout",
        tone: "info",
        text: "You do not need a separate API key to use agents in tabdo. To access table data from your own application, a workspace owner or admin can create a per-table data key under Settings → API Key.",
      },
      { type: "h2", text: "Get started" },
      {
        type: "cards",
        items: [
          {
            title: "Use AI agents",
            description: "Create an agent, choose an available model and run mode, and update its settings.",
            href: "/docs/agent-auth",
            badge: "Agents",
          },
          {
            title: "Get started",
            description: "Start with a goal, make a first table and record, then review and adjust the result.",
            href: "/docs/human-quickstart",
            badge: "Humans",
          },
        ],
      },
      { type: "h2", text: "From an idea to the next step" },
      { type: "ol", items: [
        "Describe what you want to do and share what you know, such as travel dates and budget or tasks and owners for a team project.",
        "Review the fields and records AI organizes. Add details, make changes, or update status; tables and boards help you see different parts of the work.",
        "Add records or plan the next action. Use a form, automation, or report when you need to collect information, follow changes, or review progress.",
      ] },
      { type: "callout", tone: "info", text: "You can review and change table results after AI organizes information or makes updates. Available features depend on your workspace setup and permissions." },
    ],
  },
  {
    slug: "how-it-works",
    sectionId: "welcome",
    title: "How it works",
    description: "Describe a goal, organize what you know, review the result, and choose what to do next.",
    body: [
      { type: "ol", items: [
        "Describe what you want to do and share the information you already have, such as trip dates, budget, or project tasks.",
        "Ask AI to organize it into a plan and records you can review. Check the fields and details, then add information, filter, or update status as needed.",
        "Keep working in a table, board, or form. Review the results after updates and choose what to move forward next.",
      ] },
      { type: "cards", items: [
        { title: "Getting started", description: "Go from workspace setup to your first table and record.", href: "/docs/human-quickstart", badge: "Guide" },
        { title: "Tables, columns, and records", description: "See how information is organized and edited.", href: "/docs/tables", badge: "Data" },
      ] },
    ],
  },


  {
    slug: "harness",
    sectionId: "agents",
    title: "Choose a model and run mode",
    description: "Choose an available model, Local or Sandbox mode, and a provider for a new conversation.",
    body: [
      { type: "ol", items: [
        "Open /app/agents and create or edit an agent. Choose an assistant, an available model, and either Local or Sandbox mode. The choices can differ by assistant and workspace.",
        "If you choose Sandbox, select a provider that is marked available. E2B is currently available with Pi; Railway is unavailable with Codex and Claude Code. If an option is disabled, choose another available provider or ask a workspace admin.",
        "Local runs commands with the permissions of its environment. Use it only in a trusted development environment or a dedicated container.",
        "To use a model not listed, choose the custom model option and enter its model ID as prompted. Use a name and persona to identify the agent and describe how it should help.",
        "After creation, you can edit its model, mode, provider, persona, skills, and tools. The selected assistant type cannot be changed while editing; create another agent to use a different type. After changing the mode or provider, start a new conversation to use the new environment. Existing conversations are not migrated; if you see an environment-changed message, follow it and start a new conversation.",
      ] },
      { type: "callout", tone: "info", text: "A provider that is unavailable will not be replaced silently. If the assistant, model, or environment cannot be selected or started, ask a workspace admin to check the available settings. A custom model ID must be supported by the selected service." },
      { type: "callout", tone: "warn", text: "Railway environments keep running and may continue to incur charges after a turn, until the idle timeout or destruction. After an environment expires, its conversation cannot resume; start a new conversation in an available environment." },
      {
        type: "cards",
        items: [
          { title: "Create and manage agents", description: "See who can create agents and how to edit their settings.", href: "/docs/agent-auth", badge: "Guide" },
        ],
      },
    ],
  },
  {
    slug: "agent-auth",
    sectionId: "agents",
    title: "Create and manage agents",
    description: "Create agents, choose an available model and environment, and edit settings with the right workspace permissions.",
    body: [
      { type: "p", text: "Only a workspace owner or admin can create or edit agents. Agents appear in the /app/agents list: select one to start a conversation, or open its settings to make changes." },
      { type: "ol", items: [
        "Go to /app/agents and select Create agent. Enter a name and persona describing how you want the agent to help organize information or move a plan forward.",
        "Choose an assistant, available model, Local or Sandbox mode, and an available Sandbox provider when needed. Select available skills and tools as needed, then complete the steps on the page and save. After changing the mode or provider, start a new conversation to use the new environment. If an existing conversation reports that its environment has changed, follow the prompt and start a new conversation.",
        "To make changes later, open the agent from the list and edit its name, persona, model, run mode, skills, or tools. The assistant type cannot be changed after creation; create another agent to use a different type.",
      ] },
      { type: "callout", tone: "info", text: "If you do not see the create or edit controls, you may not have the required owner/admin permission. If a model or run mode cannot be selected or started, ask a workspace admin to check available settings. Using agents in tabdo does not require creating an API key." },
      {
        type: "cards",
        items: [
          { title: "Choose a model and run mode", description: "Review available options and what to do if one is unavailable.", href: "/docs/harness", badge: "Reference" },
          { title: "Workspace members", description: "Learn about role permissions and inviting members.", href: "/docs/members", badge: "Members" },
          { title: "Connect an AI client with MCP", description: "Connect securely to the remote MCP endpoint with an API key.", href: "/docs/mcp", badge: "MCP" },
        ],
      },
    ],
  },
  {
    slug: "mcp",
    sectionId: "agents",
    title: "Connect an AI client with MCP",
    description: "Connect a remote MCP client to tabdo over HTTPS with a scoped API key.",
    body: [
      { type: "p", text: "Connect an MCP client to tabdo without installing or running a local service. The remote endpoint is https://tabdo.dev/mcp and uses Streamable HTTP. Every request must include an API key in the Authorization header." },
      { type: "h2", text: "Create and protect an API key" },
      { type: "ol", items: [
        "In tabdo, open Settings → API Key and create a key with only the permissions your integration needs. A workspace owner or admin can manage keys.",
        "Copy the key when it is shown and keep it in your MCP client's secure settings. The full key is shown once; do not put it in a shared file, browser code, or a public repository.",
        "In your MCP client, add a remote HTTP server at https://tabdo.dev/mcp and set the Authorization header to Bearer followed by your key.",
      ] },
      { type: "h2", text: "Connect from Cursor" },
      { type: "ol", items: [
        "Create or open ~/.cursor/mcp.json for a personal server, or .cursor/mcp.json in a project for a project server. Keep a real key out of shared project files.",
        "Add the following remote server entry, replacing the placeholder with your key, then save and restart Cursor.",
        "In Customize → MCPs, confirm tabdo is enabled. In chat, check that tabdo tools appear in the tools list; Cursor's Output panel → MCP Logs can help diagnose connection failures.",
      ] },
      { type: "code", lang: "json", code: `{"mcpServers":{"tabdo":{"url":"https://tabdo.dev/mcp","headers":{"Authorization":"Bearer tab_replace_with_your_key"}}}}` },
      { type: "p", text: "Cursor setup reference: https://prod.cursor.com/help/customization/mcp (MCP integrations)." },
      { type: "h2", text: "Connect from Codex" },
      { type: "ol", items: [
        "Set TABDO_MCP_KEY in your shell environment to the API key, and keep it available in the environment used to launch Codex. Avoid placing the value in a shared repository file.",
        "Run codex mcp add tabdo --url https://tabdo.dev/mcp --bearer-token-env-var TABDO_MCP_KEY.",
        "Run codex mcp list, then open Codex and use /mcp to confirm the server is listed and its tools are available.",
      ] },
      { type: "code", lang: "bash", code: `export TABDO_MCP_KEY="tab_replace_with_your_key"\ncodex mcp add tabdo --url https://tabdo.dev/mcp --bearer-token-env-var TABDO_MCP_KEY` },
      { type: "p", text: "Codex stores this connection in ~/.codex/config.toml by default. Setup reference: https://learn.chatgpt.com/docs/extend/mcp." },
      { type: "h2", text: "Connect from Claude Code" },
      { type: "ol", items: [
        "In a terminal where Claude Code is available, run the command below and replace the placeholder with your API key. This adds the server to your local Claude Code configuration.",
        "Run claude mcp list, then open Claude Code and run /mcp. Confirm tabdo is connected; a failed status may mean the URL or Bearer key needs attention.",
      ] },
      { type: "code", lang: "bash", code: `claude mcp add --transport http tabdo https://tabdo.dev/mcp \\\n  --header "Authorization: Bearer tab_replace_with_your_key"` },
      { type: "p", text: "Claude Code setup reference: https://code.claude.com/docs/en/mcp." },
      { type: "h2", text: "Connect from Claude web or Desktop" },
      { type: "ol", items: [
        "For Pro or Max, open Customize → Connectors → + Add → Add custom connector. For a Team or Enterprise organization, an owner or primary owner may need to add the connector under Organization settings → Connectors first.",
        "Enter a name and https://tabdo.dev/mcp as the remote MCP server URL. Choose No sign in, then add the request header Authorization with value Bearer followed by your API key. Finish adding the connector, then enable it for the conversation from Connectors and confirm its tools are available.",
        "No sign in means no OAuth flow; it does not make this endpoint anonymous. The static Bearer key is still required. Claude's connector availability and organization controls depend on your plan.",
        "This is Claude's remote connector flow. Claude Desktop's local MCP configuration is a separate setup and is not needed for this HTTPS connection.",
      ] },
      { type: "p", text: "Claude remote connector reference: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp." },
      { type: "h2", text: "Connect Grok Bot" },
      { type: "p", text: "Grok Bot can use connectors attached to a task. Where custom MCP connectors are available through your Grok account, use the connection details above: server URL https://tabdo.dev/mcp and Authorization header Bearer followed by your API key. Once the connector is available to Grok Bot, attach it to a task with @. Official documentation describes Bot connectors under Connect apps and custom MCP connectors in Grok Connectors; the exact options can depend on account availability. Do not use Grok Build instructions as Grok Bot setup." },
      { type: "p", text: "Grok Bot connector reference: https://docs.x.ai/grok-bot/computer-and-apps. Custom MCP connector reference: https://docs.x.ai/grok/connectors." },
      { type: "h2", text: "Choose a key that matches the work" },
      { type: "p", text: "The connection exposes tools for table and record access, views, relations, automations, calendars, documents, and blogs. The available tool list does not mean every key can run every tool. A tab_ data key is limited by its configured resource grants; for example, it cannot manage workspace members or create tables and columns. Some member- or schema-level commands require an agt_ agent key and its workspace permissions. Grant only what the integration needs." },
      { type: "p", text: "For legacy agt_ agent keys, an optional X-Workspace-Id header selects a workspace the agent can access. A tab_ key follows its existing resource grants across workspaces; if you send X-Workspace-Id, it must belong to the key's organization. Leave the header out unless your client needs a workspace selector." },
      { type: "h2", text: "Troubleshoot a connection" },
      { type: "table", headers: ["Result", "What to check"], rows: [
        ["401 Unauthorized", "Add Authorization: Bearer <API key>; check that the key is current and has not been revoked."],
        ["403 Forbidden", "The key lacks access to the requested resource, or the selected workspace is outside its organization."],
        ["Tool returns an error", "Check the key's resource permissions and the inputs required by that tool."],
        ["Client asks for OAuth", "OAuth is not provided by this endpoint. Use a client that supports remote HTTP MCP with a static Authorization header."],
      ] },
      { type: "callout", tone: "info", text: "The endpoint uses stateless Streamable HTTP. It does not require a local process or OAuth sign-in. Keep the key private and revoke it in Settings → API Key if it is exposed." },
    ],
  },
  {
    slug: "human-quickstart",
    sectionId: "humans",
    title: "Getting started",
    description: "Choose a workspace and agent, organize information, add records, and review results.",
    body: [
      {
        type: "ol",
        items: [
          "Sign up at /signup. A new account automatically creates or selects a workspace; use an invitation link to join a team. After opening /app, confirm the sidebar shows the workspace you want to use.",
          "At /app/agents, choose an available agent, or ask a workspace owner/admin to create one. If no agent or model is available, ask an admin to review the workspace options; see Choose a model and run mode.",
          "Describe your goal and provide sample information in /app. For example: ‘Organize a fictional two-day weekend in Hangzhou. Create columns for places, dates, budget, and status.’ Review the generated table and columns, or create an empty table from the Tables page.",
          "Open the table, use the blank row or add-record control to enter places, dates, budget, and status. Add a file column to upload an attachment, or a relation column to connect another table.",
          "Use the view switcher at the top of the table to select or add a grid, board, or form view. Filter and sort records when needed. After changing a record, check the result in the current view or related table.",
        ],
      },
      {
        type: "callout",
        tone: "info",
        text: "Use your own account and fictional sample data when following these examples.",
      },
      {
        type: "cards",
        items: [
          { title: "Tables, columns, and records", description: "Learn about file uploads, related records, rollups, and formulas.", href: "/docs/tables", badge: "Data" },
          { title: "Views and boards", description: "Create views, configure filters and sorts, and review records.", href: "/docs/views", badge: "Views" },
          { title: "Forms", description: "Design a data entry view over the same table.", href: "/docs/forms", badge: "Collect" },
          { title: "Calendars and events", description: "Create events for workspace members and agents, and view scheduled plans.", href: "/docs/calendar-booking", badge: "Calendar" },
          { title: "Table calendar views", description: "Display date records as all-day calendar items.", href: "/docs/table-calendar", badge: "Views" },
          { title: "Automations and scheduled tasks", description: "Trigger actions from table events, external events, or a schedule.", href: "/docs/automations", badge: "Actions" },
          { title: "Reports", description: "Summarize table data with metrics and charts.", href: "/docs/reports", badge: "Insights" },
          { title: "Sites", description: "Edit, preview, and publish a simple website.", href: "/docs/sites", badge: "Publish" },
        ],
      },
    ],
  },
  {
    slug: "api-quickstart",
    sectionId: "humans",
    title: "HTTP API",
    description: "Use REST, GraphQL, and the SDK to access records with per-table grants.",
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
        text: "Create tab_ keys under Settings → API Key; only workspace owners/admins can manage them. Choose read, create, update, and delete permissions independently for each table. A key can access records only in tables you authorize; new tables are not added automatically, and write permission does not imply read access. Changes take effect on the next request, and deleting a key revokes access. The full key is shown only once. Use it with table REST, GraphQL, or @tabdo/sdk. A data key cannot change table structure, manage the workspace, or run agents.",
      },
      { type: "h2", text: "Minimal data flow" },
      { type: "p", text: "Start with GET /api/tables or GET /api/tables/:tableId to discover tables and column metadata. Keep table.id, column.id, and options[].id for select fields. Use IDs, not column names or option labels, in write requests. Keys, IDs, and host names below are fictional placeholders." },
      { type: "code", lang: "bash", code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"

# 1. Discover tables, columns, and option IDs
curl -s "$TABDO_API_URL/api/tables" \\
  -H "Authorization: Bearer $TABDO_API_KEY"

# 2. Read the first page; default 50 rows, maximum 100
curl -s "$TABDO_API_URL/api/tables/tbl_example/rows?limit=50" \\
  -H "Authorization: Bearer $TABDO_API_KEY"

# 3. Continue: replace the placeholder with the response's nextCursor
curl -sG "$TABDO_API_URL/api/tables/tbl_example/rows" \\
  --data-urlencode "limit=50" \\
  --data-urlencode "cursor=PASTE_NEXT_CURSOR" \\
  -H "Authorization: Bearer $TABDO_API_KEY"

# 4. Create. cells keys are column IDs; select values are option IDs
curl -s -X POST "$TABDO_API_URL/api/tables/tbl_example/rows" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"cells":{"col_title":"Example task","col_status":"opt_todo"}}'

# 5. Update. expectedVersion should come from the row you read
curl -s -X PATCH "$TABDO_API_URL/api/tables/tbl_example/rows/row_example" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"cells":{"col_title":"Reviewed task"},"expectedVersion":3}'

# 6. Delete
curl -s -X DELETE "$TABDO_API_URL/api/tables/tbl_example/rows/row_example" \\
  -H "Authorization: Bearer $TABDO_API_KEY"` },
      { type: "table", headers: ["Operation", "Representative success response"], rows: [
        ["GET rows", "{ rows: [{ id, tableId, version, cells, files, createdAt, updatedAt }], nextCursor, hasMore, totalMatched, limit }"],
        ["POST row (201)", "{ id, createdAt }"],
        ["PATCH row (200)", "{ id, updatedAt, version }"],
        ["DELETE row (200)", "{ id }"],
      ] },
      { type: "callout", tone: "warn", text: "If expectedVersion is stale, REST returns 409 with { error: \"Record changed; reload before updating\" }. Re-read the record and decide whether to retry with the latest version; omit expectedVersion only when last-write-wins is intentional. Grant read and write permissions independently, and only as needed." },
      { type: "cards", items: [
        { title: "REST API", description: "Full routes, queries, and response details.", href: "/docs/rest", badge: "REST" },
        { title: "GraphQL", description: "GraphQL query and mutation reference.", href: "/docs/graphql", badge: "GraphQL" },
        { title: "TypeScript SDK", description: "Call the same data API with @tabdo/sdk.", href: "/docs/sdk", badge: "SDK" },
        { title: "Calendar events API", description: "Calendar grants, member events, scheduled plans, and agent reminders.", href: "/docs/calendar-booking", badge: "Calendar" },
        { title: "Calendar event subscriptions API", description: "Subscribe to calendar changes and verify signed deliveries.", href: "/docs/calendar-events", badge: "API" },
        { title: "Table calendar API", description: "Map date columns and query all-day records.", href: "/docs/table-calendar", badge: "API" },
      ] },
    ],
  },
  {
    slug: "architecture",
    sectionId: "concepts",
    title: "Data access and permissions",
    description: "Use your account for workspace features and a tab_ key for authorized table data.",
    body: [
      {
        type: "p",
        text: "Use tabdo while signed in to view and edit information in workspaces available to you. Your workspace role determines whether you can invite members, manage agents, or create data access keys.",
      },
      {
        type: "callout",
        text: "To connect your own application, ask a workspace owner or admin to create a data key under Settings → API Key and grant only the operations needed for each table. The key does not inherit the creator’s other permissions and cannot change table structure or manage the workspace.",
      },
    ],
  },
  {
    slug: "tables",
    sectionId: "concepts",
    title: "Tables, columns & rows",
    description: "Create columns, enter records, and use files, relations, rollups, and formulas.",
    body: [
      { type: "h2", text: "Create and edit" },
      { type: "ol", items: [
        "Create a table at /app/tables, or describe your goal in /app and ask a configured agent to create a table and its columns.",
        "In the table, use a column header menu to add a column, rename it, or edit its settings. Click a cell in a row to enter or update a record. Choose a column type and fill in the value it expects.",
        "For Select and Multi-select columns, add the options people can choose from. A person column selects a member of the current workspace.",
      ] },
      {
        type: "table",
        headers: ["Column type", "What it is for"],
        rows: [
          ["Text", "Enter names, notes, or other text."],
          ["Number", "Enter a number; use it for numeric sorting, filtering, and calculations."],
          ["Select", "Choose one option from a list you define."],
          ["Multi-select", "Choose one or more options from a list you define."],
          ["File", "Upload and attach one or more files to a record."],
          ["Date", "Choose or enter a date."],
          ["Checkbox", "Mark a record as on or off."],
          ["Person", "Choose a person or agent in the workspace."],
          ["Relation", "Link a record to one or more records in another table."],
          ["Rollup", "Summarize values from related records; the result is read-only."],
          ["Formula", "Calculate a read-only value from other fields in the same table."],
        ],
      },
      { type: "h2", text: "Upload files" },
      { type: "ol", items: [
        "Add a file column, click a file cell, and choose files to upload. When the upload finishes, the file name appears in the cell; click it to download.",
        "To allow only one file, open the column settings and turn off Multiple files; multiple files are allowed by default. File size and upload count are subject to the limits shown by your workspace. If an upload exceeds a limit, choose fewer or smaller files and try again.",
      ] },
      { type: "h2", text: "Relate records and calculate rollups" },
      { type: "ol", items: [
        "Add a Relation column, choose a target table, and set whether each record can link to one or many records. You can add an optional inverse column. Edit a cell to search for and select target records; click a relation label to open and edit that record.",
        "Add a Rollup column, choose an existing relation column, and select a calculation. Count needs no target column. Sum, average, min, and max use a number column; earliest and latest use a date column.",
        "Rollups are calculated and read-only. With no related records, count and sum are 0 and other calculations are empty. Relation columns cannot be sorted. Relation and rollup columns cannot be converted to each other or to another type; remove dependent columns before deleting a relation or target column.",
      ] },
      { type: "h2", text: "Formulas" },
      { type: "p", text: "In column settings, change the type to Formula, enter an expression, and choose a result type. Use {Column name} to reference a column in the same table; for example, {Budget} * 2. Supported operators include + - * /, &, and comparisons; functions include IF, AND, OR, NOT, CONCAT, LEN, ABS, ROUND, EMPTY, VALUE, and TEXT. Formulas are recalculated and read-only. They cannot reference relation or rollup columns or contain circular references." },
      {
        type: "callout",
        tone: "warn",
        text: "Files can be viewed and downloaded only by workspace members with access. To add a file through an API, upload it in tabdo first.",
      },
      { type: "cards", items: [
        { title: "Use record bodies", description: "Edit a record title, properties, and current body directly.", href: "/docs/record-documents", badge: "Body" },
        { title: "Document API", description: "Read and update bodies with REST, GraphQL, or MCP.", href: "/docs/document-api", badge: "API" },
        { title: "Table calendar views", description: "Display date records as all-day items and edit the original rows.", href: "/docs/table-calendar", badge: "View" },
      ] },
    ],
  },
  {
    slug: "record-documents",
    sectionId: "humans",
    title: "Use record bodies",
    description: "Edit a record title, properties, and current body, with save status and conflict drafts.",
    body: [
      { type: "p", text: "Opening a record shows a wide, centered editing window with its title, properties, and body on one page. Click the title, a property value, or the body to edit it directly. When there are three or fewer regular properties, all are shown. With more than three, the first three appear by default; choose “Show all properties (N more)” to expand the rest, or “Collapse properties” to return to the shorter view. The body is separate from table fields and is not loaded with the table row list. Custom fields such as Content and their values remain ordinary properties; tabdo does not move them into the body or overwrite them." },
      { type: "ol", items: [
        "Open a record from a table or board to edit its title, properties, and body. A body is created when you first save body content; opening a record alone does not create one.",
        "Click the body to write. On wide desktop screens, the full toolbar appears in one row above the body. On narrow screens, common formatting controls stay visible, with structure, insert, and style actions grouped in separate menus. You can also type / at the start of a paragraph and use the keyboard to choose a command. The slash menu includes paragraphs, headings, lists, quotes, code, images, dividers, and alignment. Use the toolbar to add links or choose an image. Pasted external images are not uploaded automatically. The page shows the save status for the title, properties, and body.",
        "Properties and body save separately, so one part can save while another fails. A failed save keeps the affected draft and offers a retry. When you close a record, switch records, return from a blog article to its list, or switch workspaces, tabdo waits for saves; if a save still fails, you can keep editing or leave while retaining the draft. Watch for the unsaved warning before refreshing or closing the browser tab.",
        "If the body changed elsewhere, a save conflict keeps your draft in the current browser tab. View the current server content, return to your draft, or export the draft and load the current content before continuing. Conflict protection prevents newer content from being overwritten; it does not provide older body versions to browse or restore.",
        "Authorized tabdo agents, MCP clients, and API callers can read, create, or replace the current body; image operations require the matching body permissions. For REST or GraphQL access, see Document API.",
      ] },
      { type: "h2", text: "Formatting, images, and limits" },
      { type: "ul", items: [
        "Supported formatting includes paragraphs and level 1–3 headings (with left, center, right, or justified alignment), bullet and numbered lists, quotes, code blocks, horizontal rules, line breaks, bold, italic, underline, strike, inline code, safe links, text color, highlights, and images. Links must be full http, https, or mailto URLs. The toolbar offers nine preset text and highlight colors.",
        "A body is limited to 64 KiB of serialized JSON, 4,000 nodes, 12 levels, and 20 referenced images. Supported image types are PNG, JPEG, WebP, and GIF. Each image can be up to 5 MiB; a body can have up to 40 uploaded image files and 50 MiB total.",
        "Unsaved property and body drafts stay in the current browser tab. They are not a cross-device backup; confirm changes are saved before closing the tab, and export a draft you need to keep during a conflict.",
      ] },
      { type: "cards", items: [
        { title: "Document API", description: "Review current body permissions, read/write examples, conflict checks, and image routes.", href: "/docs/document-api", badge: "API" },
        { title: "Publish a blog", description: "Write in a blog, then select articles to preview and publish.", href: "/docs/blogging", badge: "Blog" },
      ] },
    ],
  },
  {
    slug: "members",
    sectionId: "concepts",
    title: "Members: humans & agents",
    description: "See who can invite members and manage workspace settings.",
    body: [
      {
        type: "ul",
        items: [
          "Open /app/members to see people and agents in your workspace and their roles.",
          "Owners and admins can invite people by email. Invitees join as members after accepting.",
          "Owners can manage the workspace, members, agents, and API keys. Admins can manage members, agents, and API keys. Members can use features available to them.",
          "Contact a workspace owner or admin if you need additional access.",
        ],
      },
    ],
  },
  {
    slug: "views",
    sectionId: "concepts",
    title: "Views, filters & board",
    description: "Create grid, board, and form views; filter, sort, and review records.",
    body: [
      { type: "ol", items: [
        "Open a table from /app/tables and switch between its view tabs. Click the plus beside the view switcher and choose Grid, Board, or Form to add a view.",
        "In a grid view, click a column heading to sort. Open the filter control, choose a column, condition, and value, then add more conditions and choose whether all or any should match. Reopen the view to adjust its conditions.",
        "In a board view, open board settings and choose a select column for board lanes. Drag a card to another lane to update that record's status. You can filter records by their current lane.",
        "Use a view menu to rename it, make it the default, or delete it. Each table must keep at least one view. Views show the same records; they do not duplicate the data.",
      ] },
      { type: "callout", tone: "info", text: "Relation columns can be filtered but not sorted; formulas and rollups are read-only calculated values. See Forms for form design and data entry steps." },
    ],
  },
  {
    slug: "forms",
    sectionId: "humans",
    title: "Forms",
    description: "Design a data entry view and review submissions in the same table.",
    body: [
      { type: "ol", items: [
        "Open a table, click the plus beside the view switcher, and choose Form. The form shares the table's columns and records with its grid and board views.",
        "In design mode, drag fields to reorder them. Select a field to edit its label, help text, required, hidden, or read-only settings. Use the top controls to choose Classic or Focus layout and a theme.",
        "Switch to fill mode, complete the form, and submit it. After the success message, return to the grid and confirm the new record is in the same table. Edit mode can update the current record.",
      ] },
      { type: "ul", items: [
        "You can edit the form title, description, submit button label, success message, and field order. Field options are shared with the table column. Formula and rollup fields display calculated values and cannot be entered; hidden fields are not shown, and required fields are validated on submission. File and relation columns use their upload and record picker controls.",
        "Forms are currently used inside the signed-in table page. There is no public form link or separate publishing flow. A form is not a separate data store; changing or deleting a column affects other views of the table too.",
      ] },
    ],
  },
  {
    slug: "calendar-booking",
    sectionId: "humans",
    title: "Calendars and events",
    description: "Create and manage events for workspace members and agents in the calendar or through the API.",
    body: [
      { type: "p", text: "Use calendars to organize events for people and agents in your workspace. You can create multiple calendars, choose an active workspace member or agent for each event, and check overlapping events across calendars. You do not need to add separate people or configure working hours before creating an event." },
      { type: "h2", text: "Create and manage calendar events" },
      { type: "ol", items: [
        "Open Calendar in the app. Switch calendars from the list beside the schedule; on a narrow screen, first choose Calendars. Use the plus beside the list title to create a calendar. Enter its name and display time zone in the dialog. Use the calendar’s more menu to edit it in the same dialog.",
        "Click New event in the toolbar, or select an empty date or time in the month, week, or day view. You can also drag across a time range. The event dialog opens with the selected time filled in; choose a member or agent, enter a title and duration, then save. The app checks overlapping events across the workspace calendars.",
        "Select an event to change its title, time, or member/agent, or to cancel it. Dragging or resizing an event changes its time. If a change conflicts with another event, the original event stays in place.",
      ] },
      { type: "h2", text: "Reminders and scheduled plans" },
      { type: "ul", items: [
        "Members with permission can set an existing workspace agent to run before an event starts or at its end. Event details show the actual run status. These are agent actions, not email or text-message notifications.",
        "A before-start reminder is skipped after the event starts. Rescheduling or cancelling invalidates reminders that have not been accepted. An agent action that has already started cannot always be recalled.",
        "Scheduled plans appear on the calendar by default, alongside events. Predicted times are previews and recorded points show runs; neither reserves event time. Select a plan point to review it, or open the scheduled plan to edit its rule. Plan visibility requires separate read access to each selected plan.",
      ] },
      { type: "h2", text: "Connect with the REST API" },
      { type: "p", text: "A workspace owner/admin can create a key under Settings → API Key and grant access to each calendar separately. Event detail, create, update, cancel, calendar management, and triggering an agent reminder are separate grants. Create access does not include event detail. Reading the member directory requires at least one of calendar read, create, update, or manage access. Reminder setup requires both event update and trigger-agent access. Scheduled plan projections use separate per-plan read grants. Select only the permissions an integration needs. New keys have no calendar grants by default. The full key is shown once. The host, key, and UUIDs below are fictional placeholders." },
      { type: "code", lang: "bash", code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"
export CALENDAR_ID="00000000-0000-4000-8000-000000000001"

# List active workspace members and agents available for events (maximum 500)
curl -s -X POST "$TABDO_API_URL/api/commands" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"listCalendarMembers","input":{"calendarId":"'"$CALENDAR_ID"'"}}'

# Create an event. Use a new idempotency key for each write; on a network retry,
# resend the original request with the same key.
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"userId":"workspace-user-demo","title":"Project check-in","time":{"start":"2026-10-20T09:00:00+08:00","end":"2026-10-20T09:30:00+08:00","timeZone":"Asia/Shanghai"},"idempotencyKey":"calendar-event-create-demo-001"}'` },
      { type: "p", text: "Use the selected member’s or agent’s userId. Event times require RFC 3339 instants with a UTC offset and an IANA time zone; the calendar display time zone is used by default in the app. A successful write returns the event ID, version, revision, and status. The same createBooking command can be sent through GraphQL or the MCP tool create_booking." },
      { type: "h2", text: "Unified command endpoint and GraphQL" },
      { type: "p", text: "The member directory is available as listCalendarMembers through POST /api/commands and GraphQL, or as list_calendar_members in a connected, authorized MCP client. Results include userId, name, and kind (human or agent), up to 500 entries. The same command and grant checks apply across these entry points. Calendar routes and command names retain booking/person identifiers for compatibility; ordinary events use userId and do not need staff setup. Create requests use exactly one of userId or legacy personId. Updates can change the title; userId can change the member only for events created with userId." },
      { type: "table", headers: ["Operation", "REST path"], rows: [
        ["List calendars (GET)", "/api/calendars"],
        ["Legacy: list / add people (GET / POST)", "/api/calendars/:calendarId/people"],
        ["Legacy: read / replace working hours (GET / POST)", "/api/calendars/:calendarId/people/:personId/hours"],
        ["Legacy: list unavailable time (POST)", "/api/calendars/:calendarId/people/:personId/exceptions/query"],
        ["Legacy: add / edit unavailable time (POST)", "/api/calendars/:calendarId/people/:personId/exceptions"],
        ["Legacy: remove unavailable time (POST)", "/api/calendars/:calendarId/people/:personId/exceptions/:exceptionId/remove"],
        ["Legacy personId availability (POST)", "/api/calendars/:calendarId/availability/query"],
        ["Query events (POST)", "/api/calendars/:calendarId/bookings/query"],
        ["Get an event (GET)", "/api/calendars/:calendarId/bookings/:bookingId"],
        ["Create an event (POST)", "/api/calendars/:calendarId/bookings"],
        ["Update an event (POST)", "/api/calendars/:calendarId/bookings/:bookingId/reschedule"],
        ["Cancel an event (POST)", "/api/calendars/:calendarId/bookings/:bookingId/cancel"],
        ["Batch event writes (POST)", "/api/calendars/:calendarId/bookings/batch"],
        ["Set / read reminders (POST / GET)", "/api/calendars/:calendarId/bookings/:bookingId/reminders"],
        ["Query scheduled task times (POST)", "/api/schedules/occurrences/query"],
      ] },
      { type: "p", text: "API keys can list calendars they have been granted, but cannot create a calendar. A current workspace owner/admin must create it in the app first, then grant the key access under Settings → API Key. The people, working-hours, unavailable-time, and availability routes above remain available for legacy personId bookings; they are not a setup step for ordinary events." },
      { type: "p", text: "Use userId rather than personId when creating a new event. Event queries can filter by userId; personId remains available for legacy records. Legacy personId bookings keep their working-hours and time-off checks. All events still check for overlapping time across the workspace calendars. The batch route accepts 1–100 event create, update, or cancel operations and applies them together; if one operation fails validation or conflicts, the batch is rolled back." },
      { type: "code", lang: "bash", code: `# Update an event. Use the latest version you have read.
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings/BOOKING_ID/reschedule" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"time":{"start":"2026-10-21T10:00:00+08:00","end":"2026-10-21T10:30:00+08:00","timeZone":"Asia/Shanghai"},"expectedVersion":1,"idempotencyKey":"booking-reschedule-demo-001"}'

# Only confirmed events can have reminders. The update above returns version 2.
# Reminder setup requires booking update and the "trigger agent" grant. An empty
# reminders array removes reminders that have not been accepted.
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings/BOOKING_ID/reminders" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expectedVersion":2,"idempotencyKey":"booking-reminder-demo-001","reminders":[{"kind":"before_start","offsetMinutes":60,"agentUserId":"agent-user-demo","prompt":"Prepare the information needed for this booking.","maxLatenessMinutes":60}]}'

# Reminder setup returns version 3. Cancel the still-confirmed event using it.
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings/BOOKING_ID/cancel" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expectedVersion":3,"idempotencyKey":"booking-cancel-demo-001"}'` },
      { type: "code", lang: "graphql", code: `query Members($input: JSON!) {
  listCalendarMembers(input: $input)
}` },
      { type: "p", text: "For GraphQL, use listCalendarMembers(input: $input) to read active members and agents, and createBooking(input: $input) to create an event with userId. The new listCalendarMembers method is not yet in the currently published @tabdo/sdk package; use REST, GraphQL, or an authorized MCP connection until it is released. The endpoint is POST /api/graphql; send the key in the Authorization: Bearer <API key> header." },
      { type: "h2", text: "Reminders and MCP tools" },
      { type: "p", text: "In a connected Tabdo MCP client with the required grants, use list_calendar_members to choose an active human member or agent, then create_booking with its userId. Use reschedule_booking and cancel_booking to manage events. The legacy query_availability, create_calendar_person, set_working_hours, and set_availability_exception tools remain for personId bookings that use working-hour rules. Configure and review reminders with set_booking_reminders and list_booking_reminders; query scheduled-plan projections with query_scheduled_occurrences. Calendar tools follow the grants for their target calendar; scheduled plans require separate read access to the selected plans." },
      { type: "p", text: "To set reminders, provide the event’s current expectedVersion, an idempotency key, and up to 10 reminder rules. For before_start, offsetMinutes is the number of minutes before the start; at_end uses 0. Each rule names an existing workspace agent and its prompt. The result shows reminder configuration and actual run status. A run link is shown only to someone allowed to view that conversation." },
      { type: "h2", text: "Limits, permissions, and troubleshooting" },
      { type: "ul", items: [
        "Workspace members can view and manage events according to their workspace access. Only owners/admins can manage calendars. API keys only access calendars you grant; creating an event does not grant access to event details. Calendar grants do not grant access to scheduled plans.",
        "Events are isolated by workspace, but overlaps are checked across calendars in the same workspace. One member or agent can have only one event at a time. Events can be confirmed or cancelled. Recurring events, guest self-service, payments, and external calendar sync are not available.",
        "The member directory returns active human members and agents, up to 500 entries, as a complete list. A workspace with more than 500 active members returns QUERY_LIMIT. A key needs calendar read, create, update, or manage access to read the directory.",
        "Legacy personId bookings continue to use working hours and time-off rules. Their old person and schedule APIs remain available; new userId events do not use those rules. Historical events keep their original person and schedule behavior.",
        "Event queries cover up to 93 days and 500 items. Results do not use a cursor; exceeding a query budget returns an explicit error rather than silently truncating results.",
        "Updating, cancelling, and schedule changes require the current expectedVersion. On VERSION_CONFLICT, reload the event or plan and review the latest version. On RESOURCE_CONFLICT, choose another time. OUTSIDE_AVAILABILITY applies to legacy personId bookings; query availability again for those bookings.",
        "Writes require an idempotency key. If a request is interrupted, retry the same input with the same key; do not reuse a key for different data. A cancelled event cannot be restored, but you can create another event.",
        "If you receive FORBIDDEN, ask an owner/admin to check that the key has the required grant for the target calendar. If you receive QUERY_LIMIT, narrow the date range or select fewer scheduled plans. Future events must be resolved before a calendar can be archived; history is retained.",
      ] },
      { type: "cards", items: [
        { title: "Automations and scheduled tasks", description: "Create scheduled tasks and review their run history.", href: "/docs/automations", badge: "Automation" },
        { title: "Calendar event subscriptions", description: "Receive calendar changes and inspect delivery status.", href: "/docs/calendar-events", badge: "API" },
        { title: "Table calendar views", description: "View dated table records without creating bookings.", href: "/docs/table-calendar", badge: "View" },
        { title: "HTTP API", description: "Learn API key basics and REST and GraphQL access.", href: "/docs/api-quickstart", badge: "API" },
      ] },
    ],
  },
  {
    slug: "table-calendar",
    sectionId: "humans",
    title: "Table calendar views",
    description: "Map date columns to an all-day calendar and view or edit the original records.",
    body: [
      { type: "p", text: "A table calendar view arranges existing records by date. It is useful for plans, content, and other dated items. It remains a view of the original table: records and dates stay in the table. It does not create calendar events, check member availability, or prevent overlapping dates." },
      { type: "h2", text: "Create and configure a view" },
      { type: "ol", items: [
        "Open a table, click the plus beside the view switcher, and choose Calendar view.",
        "In mapping settings, choose the required start date column. You can also map an end date, a text title, and a person column. Hidden columns are not offered.",
        "If you map an end date, choose whether the end day is included. After saving, records appear in the all-day area on their mapped dates. Select a record to open the original row; Enter and Space can also open it from the calendar.",
        "Change the displayed date range as needed. Drag a record to change its mapped dates in the original row; select a record to open it. If a version conflict occurs, review the latest row before deciding whether to try again.",
      ] },
      { type: "p", text: "A connected, authorized MCP client can also use create_calendar_view and update_calendar_view to configure the mapping, and query_calendar_view to read the projection. Creation takes a table ID, an optional name, and a config with startColumnId (required), endColumnId, titleColumnId, personColumnId, and endMode (inclusive or exclusive). Pass column IDs, not column names. API keys cannot create or update view configuration." },
      { type: "code", lang: "json", code: `{
  "tableId": "00000000-0000-4000-8000-000000000001",
  "name": "Task calendar",
  "config": {
    "startColumnId": "00000000-0000-4000-8000-000000000002",
    "endColumnId": null,
    "titleColumnId": "00000000-0000-4000-8000-000000000003",
    "personColumnId": null,
    "endMode": "inclusive"
  }
}` },
      { type: "h2", text: "Query through the API" },
      { type: "p", text: "REST, GraphQL, and POST /api/commands can query the same calendar projection. The key, host, and IDs below are fictional placeholders. Ask a workspace owner/admin to create a data key and grant read access to the target table. The key can query mapped records, but that read grant cannot create or update view configuration." },
      { type: "code", lang: "bash", code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"
export VIEW_ID="00000000-0000-4000-8000-000000000001"

# The start date is inclusive and the end date is exclusive
curl -s -X POST "$TABDO_API_URL/api/views/$VIEW_ID/calendar/query" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"rangeStart":"2026-10-01","rangeEnd":"2026-11-01","limit":100}'` },
      { type: "code", lang: "graphql", code: `query Calendar($input: JSON!) {
  queryCalendarView(input: $input)
}` },
      { type: "p", text: "The response includes items, hasMore, nextCursor, limit, and diagnostics. Each item contains only rowId, version, start, end, title, and person. The end is always the next exclusive date. The response does not include the entire row or infer a title from an unmapped field." },
      { type: "code", lang: "json", code: `{
  "items": [
    { "rowId": "row_example", "version": 3, "start": "2026-10-20", "end": "2026-10-22", "title": "Review preparation", "person": "Alex" }
  ],
  "nextCursor": null,
  "hasMore": false,
  "limit": 100,
  "diagnostics": { "mapping": [], "emptyStart": 0, "invalidStart": 0, "invalidEnd": 0, "reversed": 0 }
}` },
      { type: "h2", text: "Fields, ranges, and permissions" },
      { type: "ul", items: [
        "Date columns are stored as YYYY-MM-DD, without a time or time zone. A start date is required; an end date is optional. Without an end date, a record occupies one day. The default treats the end day as inclusive; choose exclusive when the end day should not appear as occupied. The API always returns an exclusive end.",
        "The calendar shows records that overlap the requested date range. rangeStart is inclusive and rangeEnd is exclusive. The page size defaults to 100 and is capped at 200; use the cursor to continue. A cursor is tied to its view configuration and date range. Start a new query after changing either.",
        "Calculated columns cannot be mapped as dates. If a column is hidden, deleted, or changed to an incompatible type, the view shows a mapping diagnostic. Repair the mapping to continue. diagnostics counts empty start dates, invalid dates, and end dates earlier than the start to help find records that are not shown.",
        "A table read grant on an API key allows calendar projection queries; it does not grant view management. Results do not include full row contents. To edit an original row, grant table update access separately and use the existing row API with the latest version. Table calendar views do not create calendar events or provide event conflict checks, staff schedules, availability, or event states.",
      ] },
      { type: "cards", items: [
        { title: "Tables, columns & rows", description: "Learn about date columns and editing original records.", href: "/docs/tables", badge: "Data" },
        { title: "Calendars and events", description: "Create events for workspace members and agents.", href: "/docs/calendar-booking", badge: "Events" },
      ] },
    ],
  },
  {
    slug: "calendar-events",
    sectionId: "humans",
    title: "Calendar outbound event subscriptions API",
    description: "Subscribe to calendar changes, verify signed deliveries, and handle retries.",
    body: [
      { type: "p", text: "Outbound event subscriptions send calendar changes from a granted calendar to your HTTPS receiver. The app shows calendar bookings as events, while existing subscription event types such as booking.created and person.updated retain their names for compatibility. Use subscriptions to let your own application know when something changes in tabdo. They are not two-way sync with Google, Outlook, or another calendar, and they do not send email or text messages." },
      { type: "h2", text: "Set up permissions and a receiver" },
      { type: "ol", items: [
        "Create or edit an API key under Settings → API Key. An owner/admin grants subscription, delivery-read, and subscription-management permissions separately for the target calendar. Creating a subscription also requires read access to that calendar. New keys have none of these grants by default.",
        "Prepare a publicly reachable HTTPS receiver on the standard port 443. The URL cannot include a username, password, or fragment. Your receiver must retain the original request bytes to verify the signature.",
        "Create a subscription with POST /api/calendars/{calendarId}/subscriptions. Choose a name, receiver URL, and event types. The successful response displays a signing secret once; save it securely because its plaintext cannot be read again.",
      ] },
      { type: "code", lang: "bash", code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"
export CALENDAR_ID="00000000-0000-4000-8000-000000000001"

curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/subscriptions" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Booking receiver","endpoint":"https://receiver.example.com/events","eventTypes":["booking.created","booking.rescheduled","booking.cancelled"],"idempotencyKey":"calendar-subscription-demo-001"}'` },
      { type: "p", text: "The response contains the subscription configuration and a secret returned only on this creation. If you did not save it, rotate the secret and save the new value. Secrets are not returned by list or history calls or by replaying an idempotent response." },
      { type: "h2", text: "Verify the signature and process events" },
      { type: "p", text: "Each delivery includes X-Tabdo-Event-Id, X-Tabdo-Delivery-Id, and X-Tabdo-Signature headers. The signature format is t=<Unix seconds>,v1=<hex>; v1 is HMAC-SHA256(secret, timestamp + '.' + raw request body). Calculate the signature over the original body before parsing JSON. Enforce an acceptable timestamp window and compare signatures in constant time." },
      { type: "code", lang: "json", code: `{
  "protocol": 1,
  "eventId": "00000000-0000-4000-8000-000000000010",
  "workspaceId": "00000000-0000-4000-8000-000000000011",
  "calendarId": "00000000-0000-4000-8000-000000000001",
  "type": "booking.created",
  "aggregateId": "00000000-0000-4000-8000-000000000012",
  "aggregateVersion": 1,
  "occurredAt": "2026-10-20T01:00:00.000Z",
  "deliveryId": "00000000-0000-4000-8000-000000000013"
}` },
      { type: "p", text: "Events include only event, calendar, workspace, and target-record IDs, type, version, and occurrence time. They do not include an event title, customer details, member or agent name, or reminder prompt. Use a separately authorized calendar API to read details. Deduplicate by deliveryId or eventId and process possible out-of-order events by aggregateVersion. Versions may have gaps when you filter event types." },
      { type: "h2", text: "Manage subscriptions and deliveries" },
      { type: "table", headers: ["Operation", "REST path", "Permission"], rows: [
        ["Create subscription (POST)", "/api/calendars/:calendarId/subscriptions", "Subscribe + calendar read"],
        ["List subscriptions (POST)", "/api/calendars/:calendarId/subscriptions/query", "Subscribe"],
        ["Read / update (GET / PATCH)", "/api/calendars/:calendarId/subscriptions/:subscriptionId", "Subscribe / manage subscription"],
        ["Pause / resume (PATCH)", "/api/calendars/:calendarId/subscriptions/:subscriptionId", "Manage subscription"],
        ["Rotate secret (POST)", "/api/calendars/:calendarId/subscriptions/:subscriptionId/rotate-secret", "Manage subscription"],
        ["Revoke (POST)", "/api/calendars/:calendarId/subscriptions/:subscriptionId/revoke", "Manage subscription"],
        ["Query deliveries (POST)", "/api/calendars/:calendarId/subscriptions/:subscriptionId/deliveries/query", "Read deliveries"],
        ["Read delivery and attempts (GET)", "/api/calendars/:calendarId/subscriptions/:subscriptionId/deliveries/:deliveryId", "Read deliveries"],
        ["Retry a failed delivery (POST)", "/api/calendars/:calendarId/subscriptions/:subscriptionId/deliveries/:deliveryId/retry", "Manage subscription + calendar read + subscribe"],
      ] },
      { type: "code", lang: "bash", code: `# Explicitly retry a deadletter delivery for the current active subscription version
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/subscriptions/$SUBSCRIPTION_ID/deliveries/$DELIVERY_ID/retry" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expectedVersion":1,"idempotencyKey":"calendar-delivery-retry-001"}'

# Pause: send the full configuration, current subscription version, and idempotency key
curl -s -X PATCH "$TABDO_API_URL/api/calendars/$CALENDAR_ID/subscriptions/$SUBSCRIPTION_ID" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Booking receiver","endpoint":"https://receiver.example.com/events","eventTypes":["booking.created","booking.rescheduled","booking.cancelled"],"status":"paused","expectedVersion":1,"idempotencyKey":"calendar-subscription-pause-001"}'

# Revoke permanently, using the latest version
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/subscriptions/$SUBSCRIPTION_ID/revoke" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expectedVersion":2,"idempotencyKey":"calendar-subscription-revoke-001"}'

` },
      { type: "p", text: "An API key can access only the subscriptions it created. Provide an idempotency key for writes such as create, update, revoke, rotate, and retry. Update, revoke, rotate, and retry also require the latest expectedVersion. Creating a subscription requires subscribe and calendar-read grants; retry also requires manage-subscription. Delivery-history access is a separate grant; subscription management does not include it automatically. POST /api/commands accepts the matching command names, such as createCalendarSubscription, updateCalendarSubscription, revokeCalendarSubscription, rotateCalendarSubscriptionSecret, and listCalendarDeliveries. GraphQL queries are listCalendarSubscriptions, getCalendarSubscription, listCalendarDeliveries, and getCalendarDelivery; mutations are createCalendarSubscription, updateCalendarSubscription, revokeCalendarSubscription, rotateCalendarSubscriptionSecret, and retryCalendarDelivery. Each takes a JSON input. A connected, authorized MCP client can use the snake_case calendar subscription tools. The new JavaScript SDK methods have not been published to npm/CDN; use REST, GraphQL, or an already configured MCP connection." },
      { type: "h2", text: "Delivery status, limits, and troubleshooting" },
      { type: "ul", items: [
        "Supported events are booking.created, booking.rescheduled, booking.cancelled, booking.reminders_changed, calendar.updated, calendar.archived, person.created, person.updated, person.archived, working_hours.updated, availability_exception.created, availability_exception.updated, and availability_exception.removed. Booking events go to subscriptions on their calendar; shared staff and schedule changes may notify related calendars in the workspace.",
        "Deliveries may be duplicated or arrive out of order, so receivers must deduplicate them. The service makes a limited number of automatic retries. After retries are exhausted, the status is deadletter; inspect each attempt and explicitly retry if appropriate. A retry keeps the original eventId and deliveryId and does not run the booking action again.",
        "Delivery records can be pending, delivering, succeeded, deadletter, or skipped. Details list each attempt, completion time, and HTTP status; they do not expose the receiver response body or signing secret.",
        "Events are not backfilled while a subscription is paused. Updating its configuration, rotating its secret, or revoking it skips unfinished deliveries for the old configuration. Resuming does not replay events from the paused period. A request already processed by your receiver cannot be recalled.",
        "A calendar can have up to 100 non-revoked subscriptions. Lists default to 25 items per page and allow up to 100; continue with nextCursor. The receiver URL must resolve publicly to an HTTPS service. Private-network addresses, IP literals, and redirects are not supported.",
        "If create or retry returns FORBIDDEN, ask an owner/admin to check that the key has both subscribe and calendar-read grants; retry also needs manage-subscription. Querying delivery history requires the separate delivery-read grant. If a secret is lost, rotate it and save the new one. For deadletter deliveries, check receiver availability and the HTTP status before retrying a delivery for the current active subscription version.",
      ] },
      { type: "cards", items: [
        { title: "Calendars and events", description: "Create events for workspace members and agents.", href: "/docs/calendar-booking", badge: "Calendar" },
        { title: "HTTP API", description: "Learn API key, REST, and GraphQL basics.", href: "/docs/api-quickstart", badge: "API" },
      ] },
    ],
  },
  {
    slug: "automations",
    sectionId: "humans",
    title: "Automations and scheduled tasks",
    description: "Trigger agent and data actions from table changes, webhooks, email, or a schedule.",
    body: [
      { type: "h2", text: "Event automations" },
      { type: "ol", items: [
        "Open /app/automations and create a rule, or start from a table's automation entry. Choose a source: a table, a connected AgentMail inbox, or a Webhook endpoint.",
        "For a table source, choose a trigger such as record created, field changed, or entering a single-select status, then add field conditions. For email and Webhook sources, configure event conditions.",
        "Add at least one action, such as updating a field or running an existing agent. Name the rule, save it, and confirm it is enabled.",
        "Return to the automation list or open the rule to review its run history and results. Failed runs show an error; update the rule and review later runs.",
      ] },
      { type: "h2", text: "Scheduled tasks" },
      { type: "ol", items: [
        "Open /app/schedules and create a task. Enter a name, choose an agent, and write the task prompt.",
        "Choose a daily or weekly schedule, or enter a Cron expression. Set the time zone, enable the task, and save. View run history in the task detail; open a run to see its conversation result.",
      ] },
      { type: "callout", tone: "info", text: "An automation’s source type cannot be changed after creation; create a new rule to use another source. A scheduled task runs the selected agent at the chosen times. Runs may fail if that agent is unavailable. Use the run history to review results and errors." },
    ],
  },
  {
    slug: "integrations",
    sectionId: "humans",
    title: "Event sources: AgentMail and Webhook",
    description: "Configure email or HTTP event sources and review their automation results.",
    body: [
      { type: "ol", items: [
        "Open AgentMail or Webhook settings under /app/settings. Workspace administrators manage integrations. Create a source first, then create a matching rule under /app/automations.",
        "AgentMail: enter a connection name and service API key, test the connection, load inboxes, select the inboxes to subscribe to, and finish setup. Copy the generated receive URL. New email can trigger an automation.",
        "Webhook: create a receive endpoint and save its generated URL and token. Send events to that URL, then select the endpoint as the automation source. The URL can be viewed again; its token is shown only at creation, so store it securely.",
        "Review the integration's enabled state and recent errors in settings. Review automation runs and their results in the matching rule. You can update connection credentials, disable a source, or delete a connection or endpoint.",
      ] },
      { type: "callout", tone: "warn", text: "The configured external sources currently include AgentMail and generic inbound Webhooks; this does not mean other email, calendar, or third-party app integrations are supported. Do not publish API keys, Webhook tokens, or private receive URLs." },
      { type: "cards", items: [
        { title: "Automations and scheduled tasks", description: "Connect email or Webhook events to data updates or agent actions.", href: "/docs/automations", badge: "Next step" },
      ] },
    ],
  },
  {
    slug: "reports",
    sectionId: "humans",
    title: "Reports",
    description: "Summarize workspace tables with metrics, charts, and text.",
    body: [
      { type: "ol", items: [
        "Open /app/reports, create a report, and enter its name and description.",
        "Add a metric, chart, or text widget. A metric uses a source table and count, sum, or average. A chart uses a source table, grouping column, metric, and chart type. Use a text widget for notes.",
        "Switch between design and preview, adjust widget titles, widths, and positions, then save. Open the report from the report list to review results. Reports refresh when their source data changes.",
      ] },
      { type: "ul", items: [
        "Chart types include bar, horizontal bar, line, area, pie, donut, radar, radial, scatter, funnel, and treemap.",
        "Reports aggregate workspace table data. Sum and average require a numeric field. Reports are visible to signed-in workspace members; they do not have a public sharing link.",
        "If a chart has more groups than the display limit, it indicates that results were truncated. If a widget has no data or an incompatible field, adjust its source, grouping, or metric.",
      ] },
    ],
  },
  {
    slug: "sites",
    sectionId: "humans",
    title: "Sites",
    description: "Edit HTML, CSS, and JavaScript files, preview changes, and publish a site version.",
    body: [
      { type: "ol", items: [
        "Open /app/sites and create a site. It starts with index.html, styles.css, app.js, and tabdo-config.js files.",
        "Edit the website files in the site editor and use Preview to inspect your draft. You can add HTML, CSS, JS, MJS, JSON, SVG, TXT, or MD files. Save to create a new version.",
        "Publish a saved version, then copy the public URL from the site details and open it to review. After edits, save and publish another version. Site history lets you inspect and restore an earlier version; you can unpublish the current version.",
        "To read or submit table data, choose Connect data in the editor and paste a separately created tab_ API key. Grant the site only the table and operations it needs, then verify the result in Preview.",
      ] },
      { type: "callout", tone: "warn", text: "The site editor lets you edit website files directly. Each site can contain up to 50 files, using the file types listed above. Publish a saved version. A tab_ key is delivered with the site front-end code, so do not put a high-privilege credential there; grant only the required per-table data access." },
      { type: "cards", items: [
        { title: "Publish a blog", description: "Write in a blog, then select articles to preview and publish.", href: "/docs/blogging", badge: "Blog" },
        { title: "HTTP API and data access keys", description: "Learn about tab_ key permissions and access boundaries.", href: "/docs/api-quickstart", badge: "Security" },
      ] },
    ],
  },
  {
    slug: "blogging",
    sectionId: "humans",
    title: "Publish a blog",
    description: "Write directly in a blog, then select articles to preview, publish, and update.",
    body: [
      { type: "p", text: "A blog turns the articles you explicitly select into public content. Create a blog and write its titles and bodies on the blog page. Each build and publication is a fixed version. Saving a draft does not make it public; preview it first, then decide whether readers can access it." },
      { type: "ol", items: [
        "Open Sites in your workspace and create a blog by entering a name; a description is optional. tabdo prepares the blog content and fields needed for writing. To keep using an existing content table, expand Advanced: bind an existing content table and select its table and fields.",
        "In the blog, choose New article to enter a title and edit its body on the same page. On wide desktop screens, the full toolbar appears in one row above the body. On narrow screens, common formatting controls stay visible, with structure, insert, and style actions grouped in separate menus. You can also type / at the start of a paragraph and use the keyboard to choose a command. The slash menu includes paragraphs, headings, lists, quotes, code, images, dividers, and alignment. Use the toolbar to add links or choose an image. Open an existing article there to continue writing. Its record window shows the same title, properties, and current body. Only the current body is available; older body versions cannot be browsed or restored.",
        "An article URL slug is generated automatically; an existing non-empty slug stays as it is. You can adjust mappings or a slug in advanced settings. New articles and saved edits are not automatically added to the publication list. Select each article you want to publish, then explicitly choose its body images and cover. Unselected records, related records, and attachments are not added to the blog.",
        "Save the settings and build the blog. Review the build and its preview link. Anyone with the link can open the preview for 10 minutes. Previews are excluded from search indexing; you can revoke all preview links earlier.",
        "After reviewing the preview, publish that build. Copy the blog address from its details and share it with readers. Editing a document or blog setting does not automatically change the live articles. To update them, build again, review the new preview, and publish the new version.",
        "To remove one article, choose and confirm its withdrawal. To stop the entire blog, unpublish it. You can also restore an earlier blog configuration as a new draft, then build and publish it again.",
      ] },
      { type: "h2", text: "Content and access" },
      { type: "ul", items: [
        "A document body is limited to 64 KiB of serialized JSON, 4,000 nodes, 12 levels, and 20 referenced images. Generated HTML across a blog has a separate 4 MiB total budget. A blog can include up to 20 selected articles and up to 60 image assets, each up to 5 MiB and 30 MiB total. Supported image types are PNG, JPEG, WebP, and GIF.",
        "Public content includes the mapped fields, selected articles, their document bodies, and selected images. Author names are public; email addresses and internal member IDs are not included. Do not put secrets or private information in public fields, document content, or links.",
        "A published blog is a snapshot. Changes to source records or documents do not update it. Before building again, confirm the selected records, images, and public fields are still correct.",
        "Withdrawing an article blocks its old blog paths and images. Readers may still have copies they downloaded, copied, or cached elsewhere; those copies cannot be recalled remotely. Withdraw an article before deleting its source when needed.",
        "Unpublish the whole blog before deleting it. Blog configuration history and staged uploads may remain until the site is deleted. A blog retains at most 100 revisions; create another blog to continue after reaching that limit.",
      ] },
      { type: "h2", text: "Permissions and troubleshooting" },
      { type: "ul", items: [
        "Workspace members need permission to read and edit the selected records and documents. For API access, a workspace owner or admin grants blog read, configure, build, publish, or restore permissions separately for the content table. Grant only what is needed.",
        "If a title or body has not saved, check the page status and retry. When closing the article, returning to the blog article list, or switching workspaces, tabdo waits for saves and lets you keep editing or leave while retaining a draft if a save fails. On a body conflict, the current tab keeps the draft; view the current server content or export the draft and load the current content before continuing. If a build reports changed sources, reload the records, review them, and build again.",
        "If a slug does not meet the blog requirements, adjust it in advanced settings; new articles receive a valid unique slug automatically. If publishing or previewing fails, check the key's permission, the build version, and pending changes. Create a new preview if the old link expired.",
      ] },
      { type: "cards", items: [
        { title: "Blog API", description: "Read and manage blogs with REST, GraphQL, or available MCP tools.", href: "/docs/blog-api", badge: "API" },
        { title: "Use record bodies", description: "Edit a record title, properties, and current body directly.", href: "/docs/record-documents", badge: "Body" },
      ] },
    ],
  },

  {
    slug: "rest",
    sectionId: "reference",
    title: "Data REST API",
    description: "Table metadata, paginated reads, and record CRUD routes for tab_ keys.",
    body: [
      {
        type: "table",
        headers: ["HTTP route", "Purpose and grant"],
        rows: [
          ["GET /api/tables", "List accessible tables and column metadata; filtered by table grants"],
          ["GET /api/tables/:tableId", "Read table metadata and columns"],
          ["GET /api/tables/:tableId/rows?limit=&cursor=&includeTotal=", "Read a page; default 50, max 100; requires read grant"],
          ["POST /api/tables/:tableId/rows/query", "Query JSON filters, filterLogic, sort, cursor, limit; requires read grant"],
          ["GET /api/tables/:tableId/rows/:rowId", "Read one record; requires read grant"],
          ["POST /api/tables/:tableId/rows", "{ cells: { columnId: value } } create; requires create grant"],
          ["PATCH /api/tables/:tableId/rows/:rowId", "{ cells, expectedVersion? } update; requires update grant"],
          ["DELETE /api/tables/:tableId/rows/:rowId", "Delete a record; requires delete grant"],
        ],
      },
      { type: "h2", text: "Requests and responses" },
      { type: "p", text: "All data routes use Authorization: Bearer tab_…. JSON writes require Content-Type: application/json. A page response contains rows, nextCursor, hasMore, totalMatched, and limit; totalMatched is null unless includeTotal=true. REST returns resource data directly, not an { ok, result } envelope." },
      { type: "code", lang: "json", code: `// POST /api/tables/tbl_example/rows
{ "cells": { "col_title": "New task", "col_status": "opt_todo" } }

// PATCH /api/tables/tbl_example/rows/row_example
{ "cells": { "col_title": "Updated task" }, "expectedVersion": 3 }

// stale version: HTTP 409
{ "error": "Record changed; reload before updating" }` },
      { type: "ul", items: [
        "cells accepts writable API types only: text, number, date, checkbox, select, and multi_select. Use options[].id from field metadata for select values, not the label. Deleting a row with linked records may also require update permission on the target table to remove inverse links.",
        "Request bodies are limited to 128 KiB. Each key defaults to 120 reads and 20 writes per minute. If you exceed the rate limit, wait before sending more requests. Requests may be temporarily rejected if the limit cannot be checked.",
        "Common status codes: 400 invalid input, 401 invalid key, 403 denied operation, 404 hidden or missing table/record, 409 version conflict, 413 oversized body, 429 rate limited, 500 server error, 503 rate-limit service unavailable. Error body: { error: string }.",
      ] },
      { type: "cards", items: [
        { title: "HTTP API quickstart", description: "Follow the flow from table discovery to record CRUD.", href: "/docs/api-quickstart", badge: "Guide" },
        { title: "GraphQL", description: "Queries, pagination, and restricted mutations.", href: "/docs/graphql", badge: "GraphQL" },
      ] },
    ],
  },
  {
    slug: "graphql",
    sectionId: "reference",
    title: "GraphQL API",
    description: "Read tables and records and perform restricted record mutations with the fixed GraphQL schema.",
    body: [
      { type: "p", text: "The GraphQL endpoint is POST /api/graphql and also accepts GET with a query parameter. Use Authorization: Bearer tab_…. The compatibility header X-Tabdo-Key is also accepted. Send the key in the Authorization header with each request." },
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
      { type: "p", text: "Query tables or table(id), columns, rows(options), and row(id). rows defaults to 50 records per page and caps at 100; pass the returned nextCursor as options.cursor for the next page. Data is returned in the standard { data } envelope." },
      { type: "h2", text: "Record mutations" },
      { type: "code", lang: "graphql", code: `mutation UpdateTask($tableId: ID!, $rowId: ID!, $cells: JSON!, $version: Int) {
  updateRow(tableId: $tableId, rowId: $rowId, cells: $cells, expectedVersion: $version) {
    id updatedAt version
  }
}` },
      { type: "p", text: "Mutations also include createRow(tableId,cells) and deleteRow(tableId,rowId). An operation can contain at most one mutation. Use column IDs in cells and option IDs from field metadata for select and multi_select values. Each mutation requires its matching per-table grant." },
      { type: "code", lang: "json", code: `{
  "data": { "updateRow": { "id": "row_example", "updatedAt": "2026-01-02T03:06:00.000Z", "version": 4 } }
}` },
      { type: "h2", text: "Errors and limits" },
      { type: "p", text: "GraphQL syntax and field errors return { errors: [{ message, extensions: { code } }] }. Common codes include UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, BAD_USER_INPUT, CONFLICT, RATE_LIMITED, SERVICE_UNAVAILABLE, and QUERY_TOO_COMPLEX. On CONFLICT, read the record again and decide whether to update with its current version." },
      { type: "ul", items: [
        "Request bodies are limited to 128 KiB; each key defaults to 120 reads and 20 writes per minute.",
        "Maximum query depth is 16, root fields 20, and expanded selection fields 1,000. Each operation allows at most 30 row resolver calls and a total budget of 1,000 rows. Batched mutations are not supported.",
        "GraphQL queries and changes follow the same per-table permissions and writable field limits as REST.",
      ] },
      { type: "cards", items: [{ title: "REST API", description: "Use HTTP routes and JSON bodies for data access.", href: "/docs/rest", badge: "REST" }, { title: "SDK", description: "Use the TypeScript client for GraphQL and common table operations.", href: "/docs/sdk", badge: "SDK" }] },
    ],
  },
  {
    slug: "sdk",
    sectionId: "reference",
    title: "JavaScript / TypeScript SDK",
    description: "Access tab_ authorized data APIs with @tabdo/sdk.",
    body: [
      { type: "p", text: "Install the public @tabdo/sdk package from npm and use createClient with your tabdo URL and a tab_ data access key. The published 0.1.1 release provides table data methods and does not use your signed-in browser session. Use client.graphql for the Document API, or use REST or an authorized MCP connection. Document key grants are separate from table permissions." },
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
        "client.tables() lists accessible tables; client.table(id).columns() returns column metadata. table.list(options, { signal }) returns rows and nextCursor; pass the cursor to list the next page. Default limit is 50, maximum 100.",
        "table.get(id) reads one row. table.create(cells), table.update(id,cells,{ expectedVersion }), and table.delete(id) perform record operations. Write keys are column IDs and select values are option IDs.",
        "client.graphql<T>(query, variables, { operationName, signal }) runs GraphQL. Failures throw TabdoApiError with code, status, and errors; mutations are not retried automatically.",
      ] },
      { type: "callout", tone: "info", text: "Do not embed a high-privilege key in a public website; browser code exposes its key. Keep keys in environment variables for private integrations; for a public site, use a dedicated key with only the required table permissions." },
      { type: "cards", items: [{ title: "API quickstart", description: "Follow the complete REST flow and permissions guide.", href: "/docs/api-quickstart", badge: "Guide" }, { title: "GraphQL", description: "Read the GraphQL schema and limits.", href: "/docs/graphql", badge: "GraphQL" }, { title: "Document API", description: "Read about current body access, permissions, and conflict checks.", href: "/docs/document-api", badge: "Body" }] },
    ],
  },
  {
    slug: "blog-api",
    sectionId: "reference",
    title: "Blog API",
    description: "Manage blog snapshots with dedicated blog permissions using REST, GraphQL, or MCP.",
    body: [
      { type: "p", text: "Use blog commands through the REST command endpoint, GraphQL, or an authorized tabdo MCP connection. Blog permissions are granted separately for each content table; existing data or document permissions do not grant blog configuration, build, or publishing access. createBlog requires a signed-in member session and cannot use an API key. The published @tabdo/sdk 0.1.1 release does not include any blog commands; use REST, GraphQL, or MCP for API access." },
      { type: "h2", text: "Create an access key" },
      { type: "ol", items: [
        "Ask a workspace owner or admin to open Settings → API Key and create a dedicated key. Add only the content table and blog permissions you need: canRead for sources and configuration, canConfigure to save settings, canBuild to build and preview, canPublish to authorize the key to publish or withdraw, and canRestore to restore a configuration revision.",
        "Keep the full key in server-side secret storage or an environment variable. Do not place it in browser code, a public website, a blog document, or a URL. The full key is shown once; deleting it revokes future access.",
        "Every blog write command requires a 1–200 character idempotency key. Send it in the Idempotency-Key header and reuse it when retrying the same request. A replay returns the saved result; reusing the key for a different request returns a conflict.",
      ] },
      { type: "h2", text: "REST command endpoint" },
      { type: "p", text: "Send JSON to POST /api/commands with Authorization: Bearer tab_…. Each request contains command and input; include Idempotency-Key for writes. This read-only example uses fictional IDs and a placeholder key:" },
      { type: "code", lang: "bash", code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"

curl -s -X POST "$TABDO_API_URL/api/commands" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"command":"getBlogSources","input":{"tableId":"00000000-0000-4000-8000-000000000001","limit":20}}'` },
      { type: "h2", text: "Create a blog as a signed-in member" },
      { type: "p", text: "For a new blog with tabdo-prepared content fields, send the following request body to POST /api/commands with your signed-in workspace session. This request uses the member session, not a tab_ API key; API keys cannot create a blog. The command creates the content table and default title/slug fields. A successful REST command returns { ok, command, result }; the BlogDetail site ID is result.id." },
      { type: "code", lang: "json", code: `{
  "command": "createBlog",
  "input": {
    "name": "Field Notes",
    "description": "Notes and updates",
    "language": "en",
    "idempotencyKey": "create-blog-example-1"
  }
}` },
      { type: "p", text: "To start an article in that blog, send the following request body to POST /api/commands with your signed-in workspace session, or call startBlogArticle with an API key through the REST or GraphQL API. Include its siteId, current expectedVersion, and title. The command creates or prepares a source record and generates a valid slug if needed; it does not create the body, select the article for publication, or publish it. The result contains tableId and rowId. Continue writing its body through the Document API. API-key callers need blog canConfigure and content-table canCreate for a new article, or canRead and canUpdate when preparing an existing record; body permissions remain separate." },
      { type: "code", lang: "json", code: `{
  "command": "startBlogArticle",
  "input": {
    "siteId": "00000000-0000-4000-8000-000000000002",
    "expectedVersion": 1,
    "title": "A first note",
    "idempotencyKey": "start-article-example-1"
  }
}` },
      { type: "p", text: "To keep using an existing content table, use saveBlog to configure that table and its mapped fields. This advanced configuration uses fictional UUIDs; replace the field, table, and record IDs with values from getBlogSources and the field metadata. After saveBlog, read its site ID from result.id in REST or data.saveBlog.id in GraphQL; after getBlog, use result.id or data.getBlog.id." },
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
      { type: "p", text: "Use result.id from a successful saveBlog response (data.saveBlog.id in GraphQL) as siteId, and pass its version to buildBlog. After building, read siteId from result.id (data.buildBlog.id in GraphQL) and buildId from result.revisionId. Use expectedVersion and expectedPublishedRevisionId from that build result for publishBlog. For the first publication, expectedPublishedRevisionId is null; before updating a published blog, read and confirm its current publication state." },
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
      { type: "p", text: "createBlog prepares a new blog and default content table for a signed-in member; startBlogArticle creates or prepares an article record but does not select or publish it. getBlogSources returns selectable article fields, source document versions for change detection, and explicitly selectable images. Its limit is at most 50; use nextAfterId to continue. getBlog reads configuration, the current build, published articles, configuration revisions, and pendingChanges. saveBlog saves configuration and the explicit article list; buildBlog creates a fixed snapshot from current sources; createBlogPreview returns a 10-minute share link; publishBlog publishes a selected buildId; withdrawBlogArticle removes one article; unpublishBlog takes down the whole site; restoreBlogRevision restores an earlier configuration as a new draft. Blog REST request bodies are limited to 128 KiB. See the blog guide for content and image budgets." },
      { type: "h2", text: "GraphQL" },
      { type: "p", text: "The GraphQL endpoint is POST /api/graphql and uses the same Authorization: Bearer tab_… header and dedicated blog permissions. Pass each command's JSON input as an argument; use query for reads and mutation for writes. Use the same idempotency keys and version preconditions for REST and GraphQL writes." },
      { type: "code", lang: "graphql", code: `query ReadBlog($input: JSON!) {
  getBlog(input: $input)
}` },
      { type: "code", lang: "json", code: `{
  "query": "query ReadBlog($input: JSON!) { getBlog(input: $input) }",
  "variables": { "input": { "siteId": "00000000-0000-4000-8000-000000000002" } }
}` },
      { type: "p", text: "Use the Idempotency-Key header for writes. GraphQL request bodies are limited to 128 KiB and responses use the standard { data } or { errors } envelope. Common errors include FORBIDDEN (permission missing), NOT_FOUND (object missing or not visible), VERSION_CONFLICT (configuration or published version changed), SOURCE_CHANGED (source changed; build again), IDEMPOTENCY_MISMATCH (key reused for a different request), and LIMIT_EXCEEDED (blog budget exceeded). On a version conflict, call getBlog again and review the current state before continuing." },
      { type: "h2", text: "MCP and public reading" },
      { type: "p", text: "Clients connected to tabdo MCP can use create_blog, start_blog_article, get_blog_sources, get_blog, save_blog, build_blog, create_blog_preview, revoke_blog_previews, publish_blog, withdraw_blog_article, unpublish_blog, and restore_blog_revision. API-key calls to create_blog are not supported; start_blog_article uses the same content-table blog and table permissions described above. Only give publishing access to trusted integrations." },
      { type: "p", text: "Published blogs can be read without a key. GET /s/{siteId}/ (the publicUrl returned by getBlog) opens the article list; articles, pagination, categories, and selected images use paths below that address. Draft content, withdrawn article paths, and unpublished blogs are not publicly readable. Anyone with a preview URL can access it until it expires; it is not a private, sign-in-only preview." },
      { type: "callout", tone: "warn", text: "Do not give a publishing key to browser code or an untrusted automation. Saving, building, and publishing are separate actions; a new build does not automatically update live content. The published @tabdo/sdk 0.1.1 release does not include any blog commands; use REST, GraphQL, or an authorized MCP connection." },
      { type: "cards", items: [
        { title: "Publish a blog", description: "Follow the full workflow from document writing to publishing and withdrawal.", href: "/docs/blogging", badge: "Guide" },
        { title: "Authentication", description: "Learn about API key creation, table grants, and access boundaries.", href: "/docs/auth", badge: "Permissions" },
      ] },
    ],
  },
  {
    slug: "document-api",
    sectionId: "reference",
    title: "Document API",
    description: "Read, create, replace, and render current record bodies with REST, GraphQL, or MCP.",
    body: [
      { type: "p", text: "Document endpoints read one record's current body on demand and do not include body content in table row queries. Each save keeps only the latest content; body history lists, older-version rendering, and restoration are unavailable. The old REST history paths have been removed and return 404; history GraphQL commands and MCP tools are also unavailable. API keys need separate document permissions; table CRUD grants, blog grants, and document grants are independent." },
      { type: "h2", text: "Grant the minimum permissions" },
      { type: "ol", items: [
        "Ask a workspace owner or admin to configure document permissions for the content table under Settings → API Key: canRead reads the current body, images, and safe rendering; canCreate creates a body; canUpdate replaces a body; canUpload uploads images. Legacy canReadHistory and canRestore grants do not provide body history access or restore actions.",
        "Grant only the operations a caller needs. canCreate does not include body reads. Document access does not grant table CRUD, blog configuration, or publishing permissions.",
        "Send Authorization: Bearer tab_… and keep the key out of URLs and public websites. Every write command needs a 1–200 character idempotencyKey; it can also be sent in the Idempotency-Key header. Reuse the same value when retrying the same request.",
      ] },
      { type: "h2", text: "REST command examples" },
      { type: "p", text: "POST /api/commands accepts { command, input } and returns { ok, command, result }. The example reads a body, then shows the shapes for create and replace. Substitute table and row UUIDs that the key is authorized to access. createDocument returns a version receipt only; it does not grant read access, so call getDocument separately if you need the content." },
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
      { type: "p", text: "REST success data is in result. getDocument returns { id, tableId, rowId, version, content, updatedAt } or null. The version is a concurrency token that prevents overwriting newer content; it is not browsable or restorable body history. For replaceDocument, use the current version you just read as expectedVersion. An old version returns 409 VERSION_CONFLICT; read and compare the new version rather than overwriting it. Write idempotency keys must be 1–200 characters. Ordinary REST request bodies are limited to 128 KiB; a separate body image upload request can use an 8 MiB body budget." },
      { type: "h2", text: "REST paths and GraphQL" },
      { type: "table", headers: ["Operation", "REST path", "Minimum document grant"], rows: [
        ["Read / create / replace", "GET/POST/PUT /api/tables/{tableId}/rows/{rowId}/document", "canRead / canCreate / canUpdate"],
        ["Render current body", "GET /api/tables/{tableId}/rows/{rowId}/document/render", "canRead"],
        ["Upload / read image", "POST /api/tables/{tableId}/rows/{rowId}/document/images; GET /api/tables/{tableId}/rows/{rowId}/document/images/{fileId}", "canUpload / canRead"],
      ] },
      { type: "p", text: "GraphQL is available at POST /api/graphql. Use getDocument(input: JSON!) to read. Use mutations for createDocument, replaceDocument, and uploadDocumentImage. Send Authorization: Bearer tab_…; for writes, send Idempotency-Key and the same idempotencyKey in input. Ordinary GraphQL request bodies are limited to 128 KiB; a single uploadDocumentImage mutation can use an 8 MiB body budget." },
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
    "content": { "type": "doc", "content": [{ "type": "paragraph", "attrs": { "textAlign": "center" }, "content": [{ "type": "text", "text": "An updated draft.", "marks": [{ "type": "underline" }, { "type": "textStyle", "attrs": { "color": "#337ea9" } }, { "type": "highlight", "attrs": { "color": "#d3e5ef" } }] }] }] }
  } }
}` },
      { type: "h2", text: "Images and content limits" },
      { type: "ul", items: [
        "Content uses restricted schemaVersion 1 JSON, not arbitrary HTML. Supported nodes include paragraphs, level 1–3 headings, lists, quotes, code blocks, horizontal rules, line breaks, and images. Paragraph and heading attrs may include textAlign: left, center, right, or justify (or null for the default). Supported marks are bold, italic, underline, strike, code, safe links, textStyle, and highlight. textStyle requires attrs.color to be a six-digit hex color such as #337ea9; highlight accepts null or a six-digit hex color. Links must use a full http, https, or mailto URL. Unknown nodes, properties, or invalid structures are rejected.",
        "The complete serialized body JSON is limited to 64 KiB, 4,000 nodes, 12 levels, and 20 referenced images. Each image can be up to 5 MiB; a body can have up to 40 uploaded image files and 50 MiB total.",
        "Call uploadDocumentImage first with base64 data without a data URL prefix, the current expectedVersion, file name, PNG/JPEG/WebP/GIF MIME type, and an idempotency key. Put the returned fileId in an image node's attrs.fileId and its alt text in attrs.alt, then save with replaceDocument. Images belong to one body and cannot be referenced from another record.",
        "getDocumentImage returns base64 only for an image in the authorized body. renderDocument returns safe HTML and a private asset list; relative image paths are not public download links. Do not place private file URLs, keys, or tokens in body content.",
      ] },
      { type: "h2", text: "MCP tools and errors" },
      { type: "p", text: "Clients connected to tabdo MCP can use get_document, create_document, replace_document, render_document, upload_document_image, and get_document_image. For example, read with get_document({ tableId, rowId }); for a replacement, pass tableId, rowId, the current expectedVersion, restricted JSON content, and idempotencyKey. Tools use the same per-table document permissions and version checks; provide only the access a caller needs." },
      { type: "p", text: "Common errors: FORBIDDEN means the operation is not granted; NOT_FOUND means the body or image is missing or outside the authorized scope; VERSION_CONFLICT means a newer body exists; IDEMPOTENCY_MISMATCH means a retry key was reused with different input; BAD_INPUT or ATTACHMENT_LIMIT means the content structure or image budget is invalid. On a version conflict, read the latest version and compare it with the local draft." },
      { type: "cards", items: [
        { title: "Use record bodies", description: "Review direct editing, autosave, conflict drafts, and images.", href: "/docs/record-documents", badge: "Guide" },
        { title: "Publish a blog", description: "Select and explicitly publish a snapshot of record bodies.", href: "/docs/blogging", badge: "Blog" },
      ] },
    ],
  },
  {
    slug: "auth",
    sectionId: "reference",
    title: "Authentication",
    description: "Use your signed-in account in tabdo, or a tab_ key for REST, GraphQL, and SDK access to authorized table data.",
    body: [
      {
        type: "ul",
        items: [
          "Signed-in account: use your tabdo account for workspace features.",
          "Data access key: a workspace owner/admin creates Authorization: Bearer tab_… under Settings → API Key. It grants only the selected read, create, update, and delete operations for each table.",
          "tab_ keys cannot change table schemas, manage the workspace, or run agents; unsupported operations are rejected.",
        ],
      },
    ],
  },
];
