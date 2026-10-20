import { z } from "zod";
import { CALENDAR_SUBSCRIPTION_SCHEMAS, CALENDAR_SUBSCRIPTION_COMMANDS, CALENDAR_SUBSCRIPTION_READ_COMMANDS, CALENDAR_SUBSCRIPTION_TOOLS, type CalendarSubscriptionResults } from "./calendar-subscriptions.js";
export * from "./calendar-subscriptions.js";

export const CALENDAR_ERROR_CODES = ["BAD_INPUT", "NOT_FOUND", "FORBIDDEN", "VERSION_CONFLICT", "RESOURCE_CONFLICT", "OUTSIDE_AVAILABILITY", "IDEMPOTENCY_MISMATCH", "RANGE_TOO_LARGE", "QUERY_LIMIT", "ARCHIVED", "INVALID_STATE", "FUTURE_BOOKINGS", "SERVICE_UNAVAILABLE"] as const;
export type CalendarErrorCode = typeof CALENDAR_ERROR_CODES[number];
export const calendarZone = z.string().min(1).max(100).refine(value => {
  if (/^[+-]/.test(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Use an IANA time zone");
const realDate = (value: string) => { const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value; };
export const calendarDate = z.iso.date().refine(realDate, "Use a real calendar date");
const instant = z.iso.datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)) && realDate(value.slice(0, 10)), "Use an instant with an offset");
const id = z.uuid(), version = z.number().int().positive();
const key = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(200);
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const workingWindowSchema = z.strictObject({ day: z.number().int().min(1).max(7), start: clock, end: z.union([clock, z.literal("24:00")]) })
  .refine(value => value.start < value.end, "Working hours must end after they start");
export const workingHoursSchema = z.array(workingWindowSchema).max(70).refine(values => values.every((a, i) => values.every((b, j) => i === j || a.day !== b.day || a.end <= b.start || b.end <= a.start)), "Working hours cannot overlap");
export type WorkingWindow = z.infer<typeof workingWindowSchema>;
const localInterval = z.strictObject({ start: clock, end: z.union([clock, z.literal("24:00")]) }).refine(value => value.start < value.end);
export const bookingTimeSchema = z.strictObject({ start: instant, end: instant, timeZone: calendarZone }).refine(value => Date.parse(value.end) > Date.parse(value.start) && Date.parse(value.end) - Date.parse(value.start) <= 86400000, "A booking must last between 1 minute and 24 hours")
  .refine(value => [value.start, value.end].every(time => Date.parse(time) % 60000 === 0), "Use whole minutes");
const scope = { calendarId: id };
const person = { ...scope, personId: id };
const write = { idempotencyKey: key };
const change = { ...scope, expectedVersion: version, ...write };
const range = { rangeStart: instant, rangeEnd: instant };
const validRange = (value: { rangeStart: string; rangeEnd: string }, days: number) => Date.parse(value.rangeEnd) > Date.parse(value.rangeStart) && Date.parse(value.rangeEnd) - Date.parse(value.rangeStart) <= days * 86400000;
export const bookingReminderSchema = z.strictObject({ kind: z.enum(["before_start", "at_end"]), offsetMinutes: z.number().int().min(0).max(43200), agentUserId: z.string().min(1).max(200), prompt: z.string().trim().min(1).max(30000), maxLatenessMinutes: z.number().int().min(1).max(1440).default(60) }).refine(v => v.kind === "before_start" ? v.offsetMinutes > 0 : v.offsetMinutes === 0, "Before-start requires a positive offset; at-end uses zero");
export const scheduledOccurrenceQuerySchema = z.strictObject({ ...range, automationIds: z.array(id).min(1).max(100).optional(), limit: z.number().int().min(1).max(1000).default(500) }).refine(v => validRange(v, 93), "Use a range of at most 93 days");
const eventUserId = z.string().min(1).max(200);
const eventTarget = { personId: id.optional(), userId: eventUserId.optional() };
const oneTarget = (value: { personId?: string; userId?: string }) => !!value.personId !== !!value.userId;
const bookingCreate = z.strictObject({ kind: z.literal("create"), ...eventTarget, title: name, time: bookingTimeSchema, linkedRowId: id.optional() }).refine(oneTarget, "Choose exactly one of userId or legacy personId");
const bookingReschedule = z.strictObject({ kind: z.literal("reschedule"), bookingId: id, expectedVersion: version, time: bookingTimeSchema, title: name.optional(), userId: eventUserId.optional() });
const bookingCancel = z.strictObject({ kind: z.literal("cancel"), bookingId: id, expectedVersion: version });
export const CALENDAR_SCHEMAS = {
  ...CALENDAR_SUBSCRIPTION_SCHEMAS,
  listCalendars: z.strictObject({ includeArchived: z.boolean().default(false) }),
  getCalendar: z.strictObject(scope),
  createCalendar: z.strictObject({ name, timeZone: calendarZone, ...write }),
  updateCalendar: z.strictObject({ ...change, name, timeZone: calendarZone }),
  archiveCalendar: z.strictObject(change),
  listCalendarMembers: z.strictObject(scope),
  listCalendarPeople: z.strictObject({ ...scope, includeArchived: z.boolean().default(false) }),
  getCalendarPerson: z.strictObject(person),
  createCalendarPerson: z.strictObject({ ...scope, name, timeZone: calendarZone, userId: z.string().min(1).max(200).nullable().optional(), ...write }),
  updateCalendarPerson: z.strictObject({ ...person, name, timeZone: calendarZone, expectedVersion: version, ...write }),
  archiveCalendarPerson: z.strictObject({ ...person, expectedVersion: version, ...write }),
  getWorkingHours: z.strictObject(person),
  setWorkingHours: z.strictObject({ ...person, windows: workingHoursSchema, expectedVersion: version, ...write }),
  listAvailabilityExceptions: z.strictObject({ ...person, startDate: calendarDate, endDate: calendarDate }).refine(v => v.startDate <= v.endDate && Date.parse(v.endDate) - Date.parse(v.startDate) <= 93 * 86400000, "Use a range of at most 93 days"),
  setAvailabilityException: z.strictObject({ ...person, exceptionId: id.optional(), expectedVersion: version.optional(), date: calendarDate, intervals: z.array(localInterval).min(1).max(10), ...write }).refine(v => !v.exceptionId || !!v.expectedVersion, "A version is required when editing"),
  removeAvailabilityException: z.strictObject({ ...person, exceptionId: id, expectedVersion: version, ...write }),
  queryBookings: z.strictObject({ ...scope, ...range, personId: id.optional(), userId: eventUserId.optional(), includeCancelled: z.boolean().default(false) }).refine(v => validRange(v, 93), "Use a range of at most 93 days"),
  getBooking: z.strictObject({ ...scope, bookingId: id }),
  createBooking: z.strictObject({ ...scope, ...eventTarget, title: name, time: bookingTimeSchema, linkedRowId: id.optional(), ...write }).refine(oneTarget, "Choose exactly one of userId or legacy personId"),
  rescheduleBooking: z.strictObject({ ...scope, bookingId: id, time: bookingTimeSchema, title: name.optional(), userId: eventUserId.optional(), expectedVersion: version, ...write }),
  cancelBooking: z.strictObject({ ...scope, bookingId: id, expectedVersion: version, ...write }),
  queryAvailability: z.strictObject({ ...person, ...range, durationMinutes: z.number().int().min(1).max(1440), stepMinutes: z.number().int().min(1).max(1440).default(30) }).refine(v => validRange(v, 31), "Use a range of at most 31 days"),
  checkBookingConflicts: z.strictObject({ ...person, time: bookingTimeSchema }),
  queryScheduledOccurrences: scheduledOccurrenceQuerySchema,
  setBookingReminders: z.strictObject({ ...scope, bookingId: id, expectedVersion: version, reminders: z.array(bookingReminderSchema).max(10).refine(all => new Set(all.map(v => `${v.kind}:${v.offsetMinutes}`)).size === all.length, "Duplicate reminder offsets"), ...write }),
  listBookingReminders: z.strictObject({ ...scope, bookingId: id }),
  batchBookings: z.strictObject({ ...scope, operations: z.array(z.discriminatedUnion("kind", [bookingCreate, bookingReschedule, bookingCancel])).min(1).max(100), ...write }),
} as const;
export const CALENDAR_COMMANDS = [...CALENDAR_SUBSCRIPTION_COMMANDS, "listCalendars", "getCalendar", "createCalendar", "updateCalendar", "archiveCalendar", "listCalendarMembers", "listCalendarPeople", "getCalendarPerson", "createCalendarPerson", "updateCalendarPerson", "archiveCalendarPerson", "getWorkingHours", "setWorkingHours", "listAvailabilityExceptions", "setAvailabilityException", "removeAvailabilityException", "queryBookings", "getBooking", "createBooking", "rescheduleBooking", "cancelBooking", "queryAvailability", "checkBookingConflicts", "batchBookings", "queryScheduledOccurrences", "setBookingReminders", "listBookingReminders"] as const satisfies readonly (keyof typeof CALENDAR_SCHEMAS)[];
export type CalendarCommand = typeof CALENDAR_COMMANDS[number];
export type CalendarCommands = { [K in CalendarCommand]: z.input<typeof CALENDAR_SCHEMAS[K]> };
export type CalendarParsed<K extends CalendarCommand> = z.output<typeof CALENDAR_SCHEMAS[K]>;
export const CALENDAR_READ_COMMANDS: readonly CalendarCommand[] = [...CALENDAR_SUBSCRIPTION_READ_COMMANDS, "listCalendars", "getCalendar", "listCalendarMembers", "listCalendarPeople", "getCalendarPerson", "getWorkingHours", "listAvailabilityExceptions", "queryBookings", "getBooking", "queryAvailability", "checkBookingConflicts", "queryScheduledOccurrences", "listBookingReminders"];
export const calendarPermissionSchema = z.strictObject({ calendarId: id, canRead: z.boolean(), canReadAvailability: z.boolean(), canCreate: z.boolean(), canUpdate: z.boolean(), canCancel: z.boolean(), canManage: z.boolean(), canTriggerAgent: z.boolean().optional(), canSubscribe: z.boolean().optional(), canReadDeliveries: z.boolean().optional(), canManageSubscriptions: z.boolean().optional() }).refine(v => v.canRead || v.canReadAvailability || v.canCreate || v.canUpdate || v.canCancel || v.canManage || v.canTriggerAgent || v.canSubscribe || v.canReadDeliveries || v.canManageSubscriptions);
export type CalendarPermission = z.infer<typeof calendarPermissionSchema>;
export type Calendar = { id: string; workspaceId: string; name: string; timeZone: string; version: number; archived: boolean };
export type CalendarMember = { userId: string; name: string; kind: "human" | "agent" };
export type CalendarPerson = { id: string; name: string; timeZone: string; userId: string | null; version: number; archived: boolean; windows: WorkingWindow[] };
export type AvailabilityException = { id: string; personId: string; date: string; intervals: { start: string; end: string }[]; version: number };
export type Booking = { userId: string | null; schedulingMode: "working_hours" | "member"; id: string; calendarId: string; personId: string; title: string; start: string; end: string; timeZone: string; status: "confirmed" | "cancelled"; version: number; revision: number; linkedRowId: string | null };
export type BookingReceipt = Pick<Booking, "id" | "version" | "revision" | "status">;
export type CompleteCalendarPage<T> = { items: T[]; complete: true; limit: number };
export type BookingReminder = z.output<typeof bookingReminderSchema>;
export type BookingReminderIntent = { id: string; revision: number; kind: BookingReminder["kind"]; offsetMinutes: number; scheduledFor: string; status: string; reason: string | null; acceptedAt: string | null; runId: string | null; threadId: string | null };
export type ScheduledOccurrence = { automationId: string; ruleVersion: number; name: string; enabled: boolean; cron: string; scheduledFor: string; timeZone: string; projection: "planned" | "occurred"; delayed: boolean; status: string | null; threadId: string | null };
export type SchedulePermission = { automationId: string; canRead: boolean; canUpdate: boolean; canDelete?: boolean; grantVersion?: 1 | 2 };
export const schedulePermissionSchema = z.strictObject({ automationId: id, canRead: z.boolean(), canUpdate: z.boolean(), canDelete: z.boolean().default(false), grantVersion: z.union([z.literal(1), z.literal(2)]).default(1) }).refine(v => v.canRead || v.canUpdate || v.canDelete);
export type CalendarResults = CalendarSubscriptionResults & {
  queryScheduledOccurrences: CompleteCalendarPage<ScheduledOccurrence>;
  setBookingReminders: BookingReceipt;
  listBookingReminders: { bookingVersion: number; revision: number; reminders: BookingReminder[]; intents: BookingReminderIntent[]; complete: true };

  listCalendars: CompleteCalendarPage<Calendar>; getCalendar: Calendar; createCalendar: Calendar; updateCalendar: Calendar; archiveCalendar: Calendar;
  listCalendarMembers: CompleteCalendarPage<CalendarMember>;
  listCalendarPeople: CompleteCalendarPage<CalendarPerson>; getCalendarPerson: CalendarPerson; createCalendarPerson: CalendarPerson; updateCalendarPerson: CalendarPerson; archiveCalendarPerson: CalendarPerson;
  getWorkingHours: { personId: string; version: number; timeZone: string; windows: WorkingWindow[] }; setWorkingHours: CalendarPerson;
  listAvailabilityExceptions: CompleteCalendarPage<AvailabilityException>; setAvailabilityException: AvailabilityException; removeAvailabilityException: { id: string; removed: true };
  queryBookings: CompleteCalendarPage<Booking>; getBooking: Booking; createBooking: BookingReceipt; rescheduleBooking: BookingReceipt; cancelBooking: BookingReceipt;
  queryAvailability: { slots: { start: string; end: string }[]; complete: true; timeZone: string; durationMinutes: number; snapshot: true };
  checkBookingConflicts: { available: boolean; reason: "RESOURCE_CONFLICT" | "OUTSIDE_AVAILABILITY" | null; snapshot: true };
  batchBookings: { receipts: BookingReceipt[] };
};

/** Explicit public tool registrations shared by MCP and the native tool catalog. */
export const CALENDAR_TOOLS = {
  ...CALENDAR_SUBSCRIPTION_TOOLS,
  query_scheduled_occurrences: { command: "queryScheduledOccurrences", description: "只读投影当前工作区cron计划与实际occurrence，最多93天/1000点；预测不代表执行，不占预约资源。Key需独立计划授权。" },
  set_booking_reminders: { command: "setBookingReminders", description: "按预约expectedVersion整体替换最多10项智能体提醒，空数组撤销。before_start正offsetMinutes，at_end为0；改期/取消使未接受旧提醒失效。已接受运行不保证撤回。" },
  list_booking_reminders: { command: "listBookingReminders", description: "读取预约提醒配置与真实持久执行状态，只有对话所有者获得运行链接。" },
  list_calendars: { command: "listCalendars", description: "列出当前工作区可访问的日历，超出500项请缩小范围。" },
  get_calendar: { command: "getCalendar", description: "读取日历详情。" },
  create_calendar: { command: "createCalendar", description: "创建工作区日历；需owner/admin管理权。" },
  update_calendar: { command: "updateCalendar", description: "修改日历名称和显示时区，需版本和管理权。" },
  archive_calendar: { command: "archiveCalendar", description: "归档日历并保留历史；须先处理未来预约。" },
  list_calendar_members: { command: "listCalendarMembers", description: "列出当前日历工作区活跃系统成员（human与agent），返回userId/name/kind，不创建人员记录；新事件直接使用userId，无需排班。" },
  list_calendar_people: { command: "listCalendarPeople", description: "兼容旧预约：列出工作区稳定人员映射；新事件使用list_calendar_members与userId。" },
  get_calendar_person: { command: "getCalendarPerson", description: "读取服务人员及其排班。" },
  create_calendar_person: { command: "createCalendarPerson", description: "创建服务人员，可绑定活跃human userId；不使用姓名判定同人。需管理权。" },
  update_calendar_person: { command: "updateCalendarPerson", description: "修改服务人员名称和IANA时区，原子验证未来预约。" },
  archive_calendar_person: { command: "archiveCalendarPerson", description: "归档服务人员保留历史；须先处理未来预约。" },
  get_working_hours: { command: "getWorkingHours", description: "读取人员IANA时区的周工作时段，day为1周一至7周日。" },
  set_working_hours: { command: "setWorkingHours", description: "替换人员周工作时间；不能使已有未来预约失效，须版本和管理权。" },
  list_availability_exceptions: { command: "listAvailabilityExceptions", description: "查询按日期设置的临时休息/不可用，最多93天。" },
  set_availability_exception: { command: "setAvailabilityException", description: "新增或编辑某日期的临时休息；整日用00:00至24:00，编辑需版本。" },
  remove_availability_exception: { command: "removeAvailabilityException", description: "撤销临时休息，需版本和管理权。" },
  query_bookings: { command: "queryBookings", description: "按重叠范围查询事件详情（可按userId或旧personId筛选），最多93天/500项；超过上限明确报错，绝不静默截断。" },
  get_booking: { command: "getBooking", description: "读取事件详情；需要详情读取权。" },
  create_booking: { command: "createBooking", description: "创建事件：userId选择当前活跃human/agent，无需排班；与旧personId二选一，旧personId仍检查排班。带offset的start/end和IANA timeZone，事务重验跨日历容量1。重试使用原idempotencyKey，返回安全回执。" },
  reschedule_booking: { command: "rescheduleBooking", description: "编辑事件时间/可选title，member事件还可传userId换成员；旧预约保留排班规则。需expectedVersion和幂等key；冲突原子回滚，保留原时段。" },
  cancel_booking: { command: "cancelBooking", description: "取消事件释放时段，需版本和幂等key；取消后不能直接恢复。" },
  query_availability: { command: "queryAvailability", description: "兼容旧personId排班预约：查询未来空档，最多31天，durationMinutes为服务时长；新userId事件无需空档查询。仅返回完整可约slots，不包含客户或其他日历详情。查询是快照，创建需再校验。" },
  check_booking_conflicts: { command: "checkBookingConflicts", description: "兼容旧personId排班预约：检查候选时间（包含排班规则），只返回安全原因，不披露隐藏预约；不适用于免排班的userId事件。" },
  batch_bookings: { command: "batchBookings", description: "同日历1至100项事件创建/编辑/取消整批原子操作；创建用userId免排班或旧personId遵守排班，编辑可选title/member事件userId；逐项授权并校验最终状态，失败全回滚，支持交换时段。" },
} as const satisfies Record<string, { command: CalendarCommand; description: string }>;
