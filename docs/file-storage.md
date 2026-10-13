# 文件字段与存储

文件字段的值是文件对象 UUID 数组，文件名、大小、类型和存储位置保存在 `file_objects`。字段设置 `file.multiple` 默认允许多个文件；设为 `false` 后仅允许一个。行、批量行和表单写入使用同一事务验证文件存在且属于当前字段，不能引用另一个字段或工作区的文件。

部署新版本前执行迁移 `0021_file_objects`。本轮只在独立 `tabdo_agent_test` 数据库执行迁移；没有迁移或改动应用数据库。

## 配置

默认 `FILE_STORAGE_DRIVER=local`，目录为仓库根目录 `data/files`，与进程启动目录无关；编译后的 Docker 镜像默认 `/app/data/files`。可通过 `FILE_STORAGE_LOCAL_DIR` 指定持久化目录。该目录不作为静态目录公开，存储键由服务端 UUID 生成，不使用上传文件名作为路径。

Dockerfile 创建归 `node` 用户所有的目录并声明卷。部署 API 时应使用持久卷，例如 `-v tabdo-files:/app/data/files`；备份时需同时保留数据库元信息与文件卷。现有 `docker-compose.yml` 定义 `uploaded_files` 卷，workers overlay 挂载该卷；该配置当前不包含 API 服务。自行部署 API 的 Compose 服务应挂载同一卷；多个 API 副本须共享同一可写文件系统，或使用 S3。

S3 兼容配置：

```dotenv
FILE_STORAGE_DRIVER=s3
FILE_STORAGE_S3_ENDPOINT=https://your-object-storage.example
FILE_STORAGE_S3_REGION=us-east-1
FILE_STORAGE_S3_BUCKET=tabdo-files
FILE_STORAGE_S3_ACCESS_KEY_ID=your-access-key
FILE_STORAGE_S3_SECRET_ACCESS_KEY=your-secret-key
FILE_STORAGE_S3_FORCE_PATH_STYLE=true
```

预先创建 bucket，凭证需具备对象读、写和删除权限。endpoint 可省略以使用 AWS S3，path-style 可设为 `false`。access/secret 必须一起设置；同时省略时使用官方 AWS SDK 的标准凭证链（例如 IAM role），不把凭证返回给客户端。实现使用官方 `S3Client` 和 PutObject/GetObject/DeleteObject；下载直接返回对象流。[AWS SDK S3 文档](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html)、[凭证文档](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html)。

上传默认单个文件最多 25 MiB、每次最多 20 个、整个 multipart 请求最多 100 MiB，包含边界和元信息。可设置 `FILE_UPLOAD_MAX_BYTES`、`FILE_UPLOAD_MAX_FILES`（最多100）、`FILE_UPLOAD_MAX_REQUEST_BYTES`。服务器逐块计数，不仅信任 Content-Length；通过大小限制后才解析 multipart。当前实现使用有界内存解析上传，不是无限大小或直接客户端到 S3 的上传。部署代理也须允许相应大小，并保留认证 cookie/header。

## API

- `POST /api/tables/:tableId/columns/:columnId/files`：multipart，重复 `files` 字段，成功 `201 {files: StoredFile[]}`。仅文件列允许上传，整个请求先验证再保存。文件大小超限返回413；数量、单多或格式错误返回400；存储故障返回503。
- `GET /api/files?ids=<逗号分隔 UUID>`：最多100个不同ID，返回 `{files: StoredFile[]}`，保持请求顺序。任一文件不属于当前工作区或不存在则整批404，不泄漏其它文件信息。
- `GET /api/files/:id/download`：认证后代理读取，返回 attachment、nosniff 和私有禁缓存响应；不会返回公开对象 URL、存储键或凭证。不存在/其它工作区返回404，存储故障返回503。

上传后再提交文件 ID 到行保存接口。上传对象不依赖某个编辑器草稿，取消草稿或移除单元格引用不会立即删除内容。当前没有文件删除接口、后台垃圾收集或自动迁移；删除表格/字段会级联删除元信息，底层对象仍可能保留，应纳入容量与保留策略。

写入对象全部成功后，元信息事务重新锁定表格并核对字段仍存在且设置兼容；存储部分失败或元信息事务失败时清理已尝试写入的对象。进程被强制终止或底层删除失败仍可能留下无引用对象，清理失败记录文件 ID，不能把跨系统写入说成具备数据库级原子提交。

对象记录保留创建时的 driver，切换 driver 仅影响新上传；读取旧对象仍使用对应 driver 当前配置。改变 local 目录、S3 bucket/endpoint 或移除旧 driver 的凭证不会搬迁旧文件，必须保留旧位置与访问配置或单独完成数据迁移。

## 验证

```sh
pnpm --filter @tabdo/server exec tsx --test test/storage/adapter.test.ts
DATABASE_URL=postgresql://tableapp:tableapp@localhost:5432/tabdo_agent_test \
  pnpm --filter @tabdo/server exec tsx --test test/routes/files.test.ts
```

本地测试使用临时目录验证二进制流往返与路径拒绝；S3 协议 fixture 验证真实官方 SDK 的 SigV4 签名、path-style 请求和 PUT/GET/DELETE 字节往返。隔离数据库测试验证部分 S3 写入失败、上传期间字段变化的对象清理和元信息回滚，以及 multipart 数量/大小/流限制。没有访问用户 S3、凭证或业务数据；这是协议验收，不代表某个实际远程 S3 服务已经验收。
