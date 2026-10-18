import type { BlogCommands } from "@tabdo/shared";
import type { CommandDependencies } from "../dependencies.js";
import type { Transaction } from "../db/types.js";
import { memberBlogCommand } from "../blogs/service.js";
type Identity = { organizationId?: string; actorId?: string };
export const getBlogSources = (deps: CommandDependencies, input: BlogCommands["getBlogSources"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "getBlogSources", input, tx);
export const getBlog = (deps: CommandDependencies, input: BlogCommands["getBlog"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "getBlog", input, tx);
export const saveBlog = (deps: CommandDependencies, input: BlogCommands["saveBlog"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "saveBlog", input, tx);
export const buildBlog = (deps: CommandDependencies, input: BlogCommands["buildBlog"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "buildBlog", input, tx);
export const publishBlog = (deps: CommandDependencies, input: BlogCommands["publishBlog"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "publishBlog", input, tx);
export const withdrawBlogArticle = (deps: CommandDependencies, input: BlogCommands["withdrawBlogArticle"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "withdrawBlogArticle", input, tx);
export const unpublishBlog = (deps: CommandDependencies, input: BlogCommands["unpublishBlog"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "unpublishBlog", input, tx);
export const restoreBlogRevision = (deps: CommandDependencies, input: BlogCommands["restoreBlogRevision"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "restoreBlogRevision", input, tx);
export const createBlogPreview = (deps: CommandDependencies, input: BlogCommands["createBlogPreview"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "createBlogPreview", input, tx);
export const revokeBlogPreviews = (deps: CommandDependencies, input: BlogCommands["revokeBlogPreviews"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "revokeBlogPreviews", input, tx);
export const authorizeBlogPublication = (deps: CommandDependencies, input: BlogCommands["authorizeBlogPublication"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "authorizeBlogPublication", input, tx);

export const createBlog = (deps: CommandDependencies, input: BlogCommands["createBlog"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "createBlog", input, tx);
export const startBlogArticle = (deps: CommandDependencies, input: BlogCommands["startBlogArticle"] & Identity, tx?: Transaction) => memberBlogCommand(deps, "startBlogArticle", input, tx);
