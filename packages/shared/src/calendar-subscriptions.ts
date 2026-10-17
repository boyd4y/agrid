import { z } from "zod";

export const CALENDAR_EVENT_TYPES = ["booking.created", "booking.rescheduled", "booking.cancelled", "booking.reminders_changed", "calendar.updated", "calendar.archived", "person.created", "person.updated", "person.archived", "working_hours.updated", "availability_exception.created", "availability_exception.updated", "availability_exception.removed"] as const;
export type CalendarEventType = typeof CALENDAR_EVENT_TYPES[number];
export const calendarEventSchema = z.strictObject({ protocol: z.literal(1), eventId: z.uuid(), workspaceId: z.uuid(), calendarId: z.uuid(), type: z.enum(CALENDAR_EVENT_TYPES), aggregateId: z.uuid(), aggregateVersion: z.number().int().positive(), occurredAt: z.iso.datetime() });
export const calendarEndpointSchema = z.string().url().max(2000).refine(value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash && (!url.port || url.port === "443"); } catch { return false; }
}, "Use an HTTPS endpoint on port 443 without credentials or a fragment");
const scope = { calendarId: z.uuid() };
const target = { ...scope, subscriptionId: z.uuid() };
const write = { idempotencyKey: z.string().min(1).max(200) };
const change = { ...target, expectedVersion: z.number().int().positive(), ...write };
const eventTypes = z.array(z.enum(CALENDAR_EVENT_TYPES)).min(1).max(CALENDAR_EVENT_TYPES.length).refine(all => new Set(all).size === all.length, "Duplicate event types");
const configuration = { name: z.string().trim().min(1).max(200), endpoint: calendarEndpointSchema, eventTypes };
export const CALENDAR_SUBSCRIPTION_COMMANDS = ["listCalendarSubscriptions", "getCalendarSubscription", "createCalendarSubscription", "updateCalendarSubscription", "revokeCalendarSubscription", "rotateCalendarSubscriptionSecret", "listCalendarDeliveries", "getCalendarDelivery", "retryCalendarDelivery"] as const;
export const CALENDAR_SUBSCRIPTION_READ_COMMANDS = ["listCalendarSubscriptions", "getCalendarSubscription", "listCalendarDeliveries", "getCalendarDelivery"] as const;
export const CALENDAR_DELIVERY_STATUSES = ["pending", "delivering", "succeeded", "deadletter", "skipped"] as const;
export type CalendarDeliveryStatus = typeof CALENDAR_DELIVERY_STATUSES[number];
export const CALENDAR_SUBSCRIPTION_SCHEMAS = {
  listCalendarSubscriptions: z.strictObject({ ...scope, cursor: z.uuid().optional(), limit: z.number().int().min(1).max(100).default(25) }),
  getCalendarSubscription: z.strictObject(target),
  createCalendarSubscription: z.strictObject({ ...scope, ...configuration, ...write }),
  updateCalendarSubscription: z.strictObject({ ...change, ...configuration, status: z.enum(["active", "paused"]) }),
  revokeCalendarSubscription: z.strictObject(change),
  rotateCalendarSubscriptionSecret: z.strictObject(change),
  listCalendarDeliveries: z.strictObject({ ...target, cursor: z.uuid().optional(), limit: z.number().int().min(1).max(100).default(25), status: z.enum(CALENDAR_DELIVERY_STATUSES).optional() }),
  getCalendarDelivery: z.strictObject({ ...target, deliveryId: z.uuid() }),
  retryCalendarDelivery: z.strictObject({ ...change, deliveryId: z.uuid() }),
} as const;
export type CalendarSubscription = { id: string; workspaceId: string; calendarId: string; name: string; endpoint: string; eventTypes: CalendarEventType[]; status: "active" | "paused" | "revoked"; version: number; createdAt: string; updatedAt: string };
/** Reference-only notification: fetch customer or schedule details using independently granted APIs. */
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type CalendarDelivery = { id: string; subscriptionId: string; subscriptionVersion: number; event: CalendarEvent; status: CalendarDeliveryStatus; attemptCount: number; nextAttemptAt: string; lastError: string | null; httpStatus: number | null; finishedAt: string | null; createdAt: string };
export type CalendarDeliveryAttempt = { id: string; attempt: number; status: "started" | "succeeded" | "failed" | "unknown" | "skipped"; startedAt: string; finishedAt: string | null; httpStatus: number | null; error: string | null };
export type CalendarSubscriptionPage<T> = { items: T[]; nextCursor: string | null; hasMore: boolean; limit: number };
export type CalendarSubscriptionResults = {
  listCalendarSubscriptions: CalendarSubscriptionPage<CalendarSubscription>;
  getCalendarSubscription: CalendarSubscription;
  createCalendarSubscription: { subscription: CalendarSubscription; secret?: string };
  updateCalendarSubscription: CalendarSubscription;
  revokeCalendarSubscription: CalendarSubscription;
  rotateCalendarSubscriptionSecret: { subscription: CalendarSubscription; secret?: string };
  listCalendarDeliveries: CalendarSubscriptionPage<CalendarDelivery>;
  getCalendarDelivery: { delivery: CalendarDelivery; attempts: CalendarDeliveryAttempt[] };
  retryCalendarDelivery: CalendarDelivery;
};
export const CALENDAR_SUBSCRIPTION_TOOLS = {
  list_calendar_subscriptions: { command: "listCalendarSubscriptions", description: "分页列出当前日历的出站事件订阅；不返回签名密钥。Key只访问自身订阅。" },
  get_calendar_subscription: { command: "getCalendarSubscription", description: "读取日历出站订阅配置，不返回签名密钥。" },
  create_calendar_subscription: { command: "createCalendarSubscription", description: "创建HTTPS出站事件订阅。需独立subscribe和日历read授权；仅返回一次签名密钥。事件仅含ID与版本，无客户资料。" },
  update_calendar_subscription: { command: "updateCalendarSubscription", description: "修改、暂停或恢复订阅，需独立manage-subscriptions授权和版本。配置变更跳过未完成的旧版本投递；恢复不补发暂停期间事件。" },
  revoke_calendar_subscription: { command: "revokeCalendarSubscription", description: "永久撤销订阅，停止后续投递；已被远端接收的请求不能撤回。" },
  rotate_calendar_subscription_secret: { command: "rotateCalendarSubscriptionSecret", description: "轮换HMAC密钥，仅返回一次新密钥；跳过旧版本的未完成投递。" },
  list_calendar_deliveries: { command: "listCalendarDeliveries", description: "按状态分页查询订阅的持久投递记录；需独立read-deliveries授权。" },
  get_calendar_delivery: { command: "getCalendarDelivery", description: "读取投递及每次尝试的状态、时间、HTTP状态与安全错误码。不会返回响应正文或签名。" },
  retry_calendar_delivery: { command: "retryCalendarDelivery", description: "显式重试当前订阅版本的deadletter投递，保持deliveryId/eventId，不重放预约命令。每轮最多5次；远端须按ID去重。" },
} as const;
