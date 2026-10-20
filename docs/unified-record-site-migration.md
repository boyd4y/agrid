# Unified record and site migration

Internal migration reference for the unified record body and table-backed site view contract. The customer model is tables → records (properties, body, attachments) → views (including site presentation and the blog template).

## Data and publication migration

- Existing `kind=blog` sites migrate to `site` views. Keep the existing site ID, revision ID, source records, config, slugs, assets, body content, published pointer, and public URL. Migration does not rebuild or publish content.
- Code sites remain independent and keep their script, SDK, CSP, and publication behavior.
- Source row changes and site view config saves do not publish. Explicit site view publication updates the public content; unpublish removes the publication pointer; withdrawing a row removes that selected published record using the existing published copy.
- Do not introduce version-history, restore, build approval, delegated publishing, or separate body/blog permissions into the customer workflow.

## Retired external contracts

- Row REST paths `/api/tables/:tableId/rows/:rowId/document`, `/document/render`, and `/document/images[/<fileId>]` are retired (410 or unknown route); callers must use row body and row attachment operations.
- Document commands `getDocument`, `createDocument`, `replaceDocument`, `renderDocument`, `uploadDocumentImage`, and `getDocumentImage` are retired from REST command, GraphQL, MCP/native tools, and SDK APIs (unknown operation). The `documents` SDK namespace is removed.
- Blog commands `createBlog`, `startBlogArticle`, `getBlogSources`, `getBlog`, `saveBlog`, `buildBlog`, `createBlogPreview`, `revokeBlogPreviews`, `publishBlog`, `withdrawBlogArticle`, `unpublishBlog`, and `restoreBlogRevision` are retired from REST command, GraphQL, MCP/native tools, and SDK APIs (unknown operation). The `blogs` SDK namespace is removed.
- Old MCP tool names `get_document`, `create_document`, `replace_document`, `render_document`, `upload_document_image`, `get_document_image`, `create_blog`, `start_blog_article`, `get_blog_sources`, `get_blog`, `save_blog`, `build_blog`, `create_blog_preview`, `revoke_blog_previews`, `publish_blog`, `withdraw_blog_article`, `unpublish_blog`, and `restore_blog_revision` are retired.

## Authorization migration

Table Read/Create/Update/Delete grants are canonical for row properties, body, attachments, and views. Reading site views requires Read; creating, configuring, and explicitly publishing, unpublishing, or withdrawing site views requires both Read and Update. Existing table grants remain authoritative. Historical Document/Blog-only grants do not confer table access; keys with only those grants must receive the required table grants from a workspace owner/admin. Preserve key identity/hash and calendar/schedule grants as defined by the unified contract.
