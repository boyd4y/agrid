# 部署架构已更新

2026-10-15：部署目标统一为本地和 Railway，使用 Node、PostgreSQL、Redis/BullMQ，保留官方 Vercel Harness SDK。Cloudflare/DO/Queues/Wrangler 和 Sandbox Agent/ACP 不再作为部署或执行路径。

当前设计见 [Node + Harness 架构](node-harness.md)，操作步骤见 [本地部署](../local-node.md)和 [Railway 部署](../railway.md)。已有官方 Harness 会话与恢复协议继续使用，不增加另一种 checkpoint 格式。
