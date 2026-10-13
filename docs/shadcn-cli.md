# shadcn CLI 与工作区

从仓库根目录使用锁定的官方 CLI（当前 `shadcn@4.21.4`）：

```sh
pnpm install --frozen-lockfile
pnpm shadcn docs select input button
pnpm --silent shadcn info --json
pnpm shadcn:ui docs select input button
pnpm --silent shadcn:ui info --json
```

`pnpm shadcn` 默认选择 `apps/client`；`pnpm shadcn:ui` 选择
`packages/ui`。也可以在子命令后显式传 `--cwd`。入口只调用官方 CLI，
不复制 registry、不更新组件、不改全局网络设置。

两个包都已有 `components.json`，使用一致的 `new-york`、Radix、Lucide、
neutral 与 Tailwind v4 配置。客户端组件及业务 hooks 保留在 app，
`@tabdo/ui/components` 和 utils 指向共享 UI 包，CSS 指向共享
`src/styles/globals.css`。真实 `info --json` 已验证两个包的解析路径。
共享包当前没有 hooks 源文件，不预先增加未使用的 hooks export。
官方规范见 [monorepo 文档](https://ui.shadcn.com/docs/monorepo)。

## ECONNRESET 的实际原因

2026-10-14 本机同时设置了 HTTP/HTTPS 代理与 SOCKS `all_proxy`。
官方 `@shadcn/registry@0.1.3` 优先选择 SOCKS，其自定义 undici connector
直接返回 SOCKS TCP socket，HTTPS 没有经过 TLS 封装。最新 CLI 原始
`docs` 和 `info` 都出现 `read ECONNRESET`；增加大写 HTTPS_PROXY 无效。
只为该子进程清除 ALL_PROXY/all_proxy，保留现有 HTTP/HTTPS 代理，
三个组件的 docs 与两个工作区的 info 都成功。

另用本机隔离的 SOCKS fixture 核对：对 HTTPS 地址发出的第一个数据包是
明文 `GET`，而不是 TLS ClientHello，证实上述实现差异；不是
components.json 或 monorepo 路径错误。检查时没有输出代理凭证。
对应官方源码是 [registry/proxy.ts](https://github.com/shadcn-ui/ui/blob/main/packages/registry/src/registry/proxy.ts)。

`scripts/shadcn.mjs` 仅在现有 HTTP/HTTPS 代理有效且 ALL_PROXY/all_proxy
指定 SOCKS 时，为 CLI 子进程移除这两个变量，使官方 HTTP 代理实现
接管。代理地址、凭证与 NO_PROXY 均沿用环境。只有 SOCKS 的环境不被
绕过；这种环境仍需要配置可用的 HTTP/HTTPS 代理或等待 upstream 修复。
直接运行未包装的 `pnpm dlx shadcn@latest` 在上述双代理环境仍会遇到
upstream 问题，不应反复降级组件或更改组件样式来处理。

需要临时运行原始命令、且已经配置 HTTP/HTTPS 代理时，可使用：

```sh
env -u ALL_PROXY -u all_proxy pnpm dlx shadcn@4.21.4 docs select input button --cwd apps/client
```

upstream 修正 SOCKS HTTPS TLS 处理后，显式升级固定版本，在原始双代理
环境重新验证 docs 与两个包的 info，再删除 wrapper 中的兼容分支。
不应凭版本号变化自动假设网络问题已修复。
