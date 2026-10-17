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
        ],
      },
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
          { title: "Calendars and bookings", description: "Set staff hours, find open slots, and manage bookings.", href: "/docs/calendar-booking", badge: "Calendar" },
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
        { title: "Calendar booking API", description: "Calendar grants, availability, bookings, and agent reminders.", href: "/docs/calendar-booking", badge: "Calendar" },
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
    title: "Calendars and bookings",
    description: "Set staff hours and time off, find open slots, and manage bookings in the calendar or through the API.",
    body: [
      { type: "p", text: "Use a calendar to arrange service bookings in a workspace. Create separate calendars for different services, add staff, set working hours and temporary unavailable times, then let members, agents, or authorized applications create and manage bookings. Staff are the people providing the service; they are separate from the AI agent that performs an action." },
      { type: "h2", text: "Set up staff availability" },
      { type: "ol", items: [
        "Open Calendar in the app and choose an existing calendar or create one. Set a name and display time zone.",
        "Open staff and schedule settings. Add a staff member and choose their time zone. You can link an existing active workspace member when appropriate; avoid creating a second identity for the same person.",
        "Set the staff member’s weekly working hours. These hours repeat in the selected time zone. Add dated unavailable periods for time off, then edit or remove them when plans change.",
        "Review bookings in the calendar. To book, choose a staff member, duration, and available time. You can also check the next seven days for open slots before entering a booking title.",
        "Open a booking to review, reschedule, or cancel it. Rescheduling and cancellation check the current version; if a conflict occurs, the original booking remains in place.",
      ] },
      { type: "h2", text: "Reminders and scheduled plans" },
      { type: "ul", items: [
        "Members with permission can set an existing workspace agent to run before a booking starts or at its end. Booking details show the actual run status. These are agent actions, not email or text-message notifications.",
        "A before-start reminder is skipped after the booking starts. Rescheduling or cancelling invalidates reminders that have not been accepted. An agent action that has already started cannot always be recalled.",
        "You can overlay scheduled tasks on the calendar to view their projected times and recorded runs. A projected time is a preview; it does not mean the task ran or reserves booking time. Open the scheduled task to edit it.",
      ] },
      { type: "h2", text: "Connect with the REST API" },
      { type: "p", text: "A workspace owner/admin can create a key under Settings → API Key and grant access to each calendar separately. Booking detail, availability, create, reschedule, cancel, calendar management, and triggering an agent reminder are separate grants. Detail access does not include availability, and create access does not include detail access. Reminder setup requires both booking update and trigger-agent access. Scheduled task projections use separate per-task read grants. Select only the permissions an integration needs. New keys have no calendar grants by default. The full key is shown once. The host, key, and UUIDs below are fictional placeholders." },
      { type: "code", lang: "bash", code: `export TABDO_API_URL="https://your-tabdo-host.example"
export TABDO_API_KEY="tab_replace_with_your_key"
export CALENDAR_ID="00000000-0000-4000-8000-000000000001"
export PERSON_ID="00000000-0000-4000-8000-000000000002"

# Find complete availability for 30-minute bookings over the next seven days
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/availability/query" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"personId":"'"$PERSON_ID"'","rangeStart":"2026-10-19T00:00:00Z","rangeEnd":"2026-10-26T00:00:00Z","durationMinutes":30,"stepMinutes":30}'

# Create a booking. Use a new idempotency key for each write; on a network retry,
# resend the original request with the same key.
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"personId":"'"$PERSON_ID"'","title":"Example booking","time":{"start":"2026-10-20T09:00:00+08:00","end":"2026-10-20T09:30:00+08:00","timeZone":"Asia/Shanghai"},"idempotencyKey":"booking-create-demo-001"}'` },
      { type: "p", text: "Availability results include a completeness marker and time zone. A query is a snapshot: the service checks staff hours, unavailable periods, and existing bookings again when you create the booking. Send RFC 3339 instants with a UTC offset and include an IANA time zone. A successful write returns the booking ID, version, revision, and status." },
      { type: "h2", text: "Unified command endpoint and GraphQL" },
      { type: "p", text: "You can also send the same operation to POST /api/commands with a body such as {\"command\": \"queryAvailability\", \"input\": {…}} or {\"command\": \"createBooking\", \"input\": {…}}. REST, GraphQL, and this endpoint use the same calendar grants and booking checks. Include an idempotency key in the body or send it in the Idempotency-Key header." },
      { type: "table", headers: ["Operation", "REST path"], rows: [
        ["List calendars (GET)", "/api/calendars"],
        ["List / add staff (GET / POST)", "/api/calendars/:calendarId/people"],
        ["Read / replace weekly hours (GET / POST)", "/api/calendars/:calendarId/people/:personId/hours"],
        ["List dated unavailable time (POST)", "/api/calendars/:calendarId/people/:personId/exceptions/query"],
        ["Add / edit unavailable time (POST)", "/api/calendars/:calendarId/people/:personId/exceptions"],
        ["Remove unavailable time (POST)", "/api/calendars/:calendarId/people/:personId/exceptions/:exceptionId/remove"],
        ["Query availability (POST)", "/api/calendars/:calendarId/availability/query"],
        ["Query bookings (POST)", "/api/calendars/:calendarId/bookings/query"],
        ["Get a booking (GET)", "/api/calendars/:calendarId/bookings/:bookingId"],
        ["Create a booking (POST)", "/api/calendars/:calendarId/bookings"],
        ["Reschedule (POST)", "/api/calendars/:calendarId/bookings/:bookingId/reschedule"],
        ["Cancel (POST)", "/api/calendars/:calendarId/bookings/:bookingId/cancel"],
        ["Batch create / reschedule / cancel (POST)", "/api/calendars/:calendarId/bookings/batch"],
        ["Set / read reminders (POST / GET)", "/api/calendars/:calendarId/bookings/:bookingId/reminders"],
        ["Query scheduled task times (POST)", "/api/schedules/occurrences/query"],
      ] },
      { type: "p", text: "API keys can list calendars they have been granted, but cannot create a calendar. A current workspace owner/admin must create it in the app first, then grant the key access under Settings → API Key." },
      { type: "p", text: "The batch route accepts 1–100 create, reschedule, or cancel operations and applies them together. If one operation fails validation or conflicts, the batch is rolled back." },
      { type: "code", lang: "bash", code: `# Reschedule. Use the latest booking version you have read.
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings/BOOKING_ID/reschedule" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"time":{"start":"2026-10-21T10:00:00+08:00","end":"2026-10-21T10:30:00+08:00","timeZone":"Asia/Shanghai"},"expectedVersion":1,"idempotencyKey":"booking-reschedule-demo-001"}'

# Only confirmed bookings can have reminders. Rescheduling above returns version 2.
# Reminder setup requires booking update and the "trigger agent" grant. An empty
# reminders array removes reminders that have not been accepted.
curl -s -X POST "$TABDO_API_URL/api/calendars/$CALENDAR_ID/bookings/BOOKING_ID/reminders" \\
  -H "Authorization: Bearer $TABDO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"expectedVersion":2,"idempotencyKey":"booking-reminder-demo-001","reminders":[{"kind":"before_start","offsetMinutes":60,"agentUserId":"agent-user-demo","prompt":"Prepare the information needed for this booking.","maxLatenessMinutes":60}]}'

# Reminder setup returns version 3. Cancel the still-confirmed booking using it.
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
      { type: "p", text: "Use createBooking(input: $input) for a write. The GraphQL endpoint is POST /api/graphql. Send the key in the Authorization: Bearer <API key> header." },
      { type: "h2", text: "Reminders and MCP tools" },
      { type: "p", text: "In a connected Tabdo MCP client with the required grants, use calendar tools such as query_availability, create_booking, reschedule_booking, and cancel_booking. Manage schedules with create_calendar_person, set_working_hours, and set_availability_exception. Configure and review reminders with set_booking_reminders and list_booking_reminders; query the scheduled-task projection with query_scheduled_occurrences. Calendar tools follow the grants for their target calendar; scheduled task projections require separate read access to the selected tasks." },
      { type: "p", text: "To set reminders, provide the booking’s current expectedVersion, an idempotency key, and up to 10 reminder rules. For before_start, offsetMinutes is the number of minutes before the start; at_end uses 0. Each rule names an existing workspace agent and its prompt. The result shows reminder configuration and actual run status. A run link is shown only to someone allowed to view that conversation." },
      { type: "h2", text: "Limits, permissions, and troubleshooting" },
      { type: "ul", items: [
        "Workspace members can view and manage bookings according to their workspace access. Only owners/admins can manage calendars, staff, working hours, and unavailable periods. An API key only accesses calendars you grant; creating a booking does not grant access to customer details. Calendar grants do not grant access to scheduled tasks.",
        "Bookings and staff are isolated by workspace; busy times from another workspace are not combined. A staff member can have only one booking at a time. Supported booking states are confirmed and cancelled. Recurring booking series, guest self-service, payments, and external calendar sync are not available.",
        "Availability results contain open time slots, not booking titles or customer details. Booking detail requires its own read grant.",
        "Booking queries cover up to 93 days and 500 items. Availability queries cover up to 31 days and 5,000 slots. Results do not use a cursor; exceeding a query budget returns an explicit error. Results are not silently truncated and missing time is never treated as available.",
        "Rescheduling, cancellation, and schedule changes require the current expectedVersion. On VERSION_CONFLICT, reload the booking or schedule and review the latest version. On RESOURCE_CONFLICT or OUTSIDE_AVAILABILITY, query availability again.",
        "Writes require an idempotency key. If a request is interrupted, retry the same input with the same key; do not reuse a key for different data. A cancelled booking cannot be restored, but you can create another booking.",
        "If you receive FORBIDDEN, ask an owner/admin to check that the key has the required grant for the target calendar. If you receive QUERY_LIMIT, narrow the date range. Future bookings must be resolved before a calendar or staff member can be archived; booking history is retained.",
      ] },
      { type: "cards", items: [
        { title: "Automations and scheduled tasks", description: "Create scheduled tasks and review their run history.", href: "/docs/automations", badge: "Automation" },
        { title: "HTTP API", description: "Learn API key basics and REST and GraphQL access.", href: "/docs/api-quickstart", badge: "API" },
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
        { title: "HTTP API and data access keys", description: "Learn about tab_ key permissions and access boundaries.", href: "/docs/api-quickstart", badge: "Security" },
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
      { type: "p", text: "Install the public @tabdo/sdk package from npm and use createClient with your tabdo URL and a tab_ data access key. The SDK supports table data access; it does not use your signed-in browser session." },
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
      { type: "cards", items: [{ title: "API quickstart", description: "Follow the complete REST flow and permissions guide.", href: "/docs/api-quickstart", badge: "Guide" }, { title: "GraphQL", description: "Read the GraphQL schema and limits.", href: "/docs/graphql", badge: "GraphQL" }] },
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
