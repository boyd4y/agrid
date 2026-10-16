# 连接现有表格数据 API

## 配置和权限

API 地址使用用户实际的 Tabdo 服务地址，不假设远程环境能访问 localhost。所有表/列使用 get_table 返回的 UUID。Key 由工作区所有者或管理员在「设置 → API Key」创建；完整值只显示一次。不要索要数据库、模型或管理员会话凭证，也不把 Key 写进聊天日志或提交到源代码仓库。浏览器使用的普通 Key 对访问者可见，只授予该页面需要的表和操作。

四种操作互相独立：新增、更新、删除不要求读取；仅新增的收集表仍可查询表/列元数据。Key 管理、智能体运行和表结构修改需要登录会话，不属于站点数据 API。权限编辑或删除 Key 后，下次请求立即按新授权处理。

## 使用独立发布的 SDK

`@tabdo/sdk` 提供浏览器 ESM 和类型定义。构建项目安装后用 `import { createClient } from '@tabdo/sdk'`；纯HTML页面使用当前部署在系统上下文中提供的完整SDK URL，海外默认jsDelivr，国内部署由平台配置自己的固定URL。无需让用户选择国内或海外来源，不复制SDK源码，也不依赖工作区的 packages 目录。以下URL是默认版本的示例，实际以当前部署配置为准；对应npm版本发布后才能访问，不把未发布链接称为已验证。CDN不可用时说明依赖未就绪，不能偷偷把SDK源码塞回站点。

```js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@tabdo/sdk@0.1.1/dist/tabdo.js';

const tabdo = createClient({ url: config.url, key: config.key });
const content = tabdo.table(config.contentTableId);
const page = await content.list({ limit: 20 });
// 下一页保留同样的过滤、排序条件，并带上 page.nextCursor。
const receipt = await tabdo.table(config.submissionsTableId).create({
  [config.nameColumnId]: name,
});
// receipt 含 id、createdAt；不含历史记录或提交后的完整行。
```

`table.columns()` 返回字段元数据；`get(rowId)`、`update(rowId, cells, { expectedVersion })`、`delete(rowId)` 分别受读取、更新、删除权限约束。`list()` 默认 50 行、最多 100 行，使用 nextCursor/hasMore 分页。查询总数需 includeTotal；不要一次下载所有记录。

## 直接使用 GraphQL

原生 fetch 即可连接同一接口，无需等待安装或额外服务。以下是页面内的请求示例，不是平台已存在的工具。config 需替换为真实配置；构建页面时可先留集中配置位置，待用户在可信配置入口填写 Key。

```js
async function request(query, variables, signal) {
  const response = await fetch(new URL('/api/graphql', config.url), {
    method: 'POST', credentials: 'omit', redirect: 'error', signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.key}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json();
  if (!response.ok || result.errors?.length || !result.data) {
    throw new Error(result.errors?.[0]?.message || 'Request failed');
  }
  return result.data;
}

const result = await request(`query Content($id: ID!, $options: RowsInput) {
  table(id: $id) {
    rows(options: $options) {
      rows { id cells files { id columnId name mimeType size url } }
      nextCursor hasMore
    }
  }
}`, { id: config.contentTableId, options: { limit: 20 } });

const saved = await request(`mutation Submit($id: ID!, $cells: JSON!) {
  createRow(tableId: $id, cells: $cells) { id createdAt }
}`, { id: config.submissionsTableId, cells: { [config.nameColumnId]: name } });
```

访客请求不携带工作区 Cookie。GraphQL HTTP 200 也可能含 errors，必须检查后再显示成功。超时可能发生在写入已完成之后，不自动重试新增。服务端已有限流：每 Key/可信来源 IP 每分钟读取 120 次、写入合计 20 次；页面处理 429，保留草稿。

## 值与能力边界

可写：text、number、date、checkbox、select、multi_select。数字传有限 number，checkbox 传 boolean，select 传真实 option ID，多选传 ID 数组。日期格式遵守读取到的字段契约，不发本地化显示字符串。未填写的字段可省略，不能把空字符串强转为数字零。

person、relation、file、formula、rollup 目前不能通过数据 API 写入。只读记录可返回文件及安全访问链接；不要重新拼接 URL 或向未知文件地址附加 Key。关联/汇总来源表没有读取授权时，相应派生内容会被隐藏。

API 检查类型、授权和写入版本，但还没有站点专属必填规则、访客身份或行级权限。表单 UI 验证、客户端字段白名单和筛选不能替代这些服务端约束。
