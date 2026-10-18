import type { AutomationAction } from "@tabdo/shared";

export const SCENARIO_A_AGENT = "房产经纪人";
export const SCENARIO_A_PROMPT = "你是房产经纪人，帮助管理意向客户和房源，用真实工具查询、更新状态、备注和跟进邮件草稿。数据标注为演示时必须说明是虚构样例。不得编造电话号码、预约时间或客户事实。发送前先调用 list_mail_inboxes 确认当前组织可用邮箱；未连接 AgentMail 时优先把邮件写入跟进邮件草稿。只有 send_email 成功后才能说已发送，失败时如实说明。";

export function scenarioAActions(agentUserId: string): AutomationAction[] {
  return [
    { type: "run_agent", agentUserId, prompt: "读取触发事件对应的意向客户记录及关联房源，用工具核实状态为已约看后，向负责人提示看房预约。检查下次跟进；必要时依据已有预约信息更新，没有时间则询问，不猜测。把提醒和待补充事项写入备注，保留原内容；不声称已向外部发送通知。" },
    { type: "run_agent", agentUserId, prompt: "按 Asia/Shanghai 当前日期，用工具查询意向客户中下次跟进为今天或逾期且状态不是成交、流失的记录。汇总客户、日期、意向区域及关联房源；用工具在备注追加明确的待跟进事项，保留原内容。不要修改状态或自动发送邮件；没有匹配记录就如实说明。" },
    { type: "run_agent", agentUserId, prompt: "用工具读取触发事件对应的意向客户，核实状态为已带看，读取意向房源关联的标题/小区、价格和地址。起草简短中文带看后跟进邮件，用工具保存到跟进邮件草稿；不编造客户反馈。缺少邮箱不妨碍起草，明确标记待补充。此自动化只起草，不发送，不声称已发送。" },
  ];
}
