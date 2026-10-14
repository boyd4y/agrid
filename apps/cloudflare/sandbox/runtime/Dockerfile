FROM node:24.14.1-bookworm-slim
WORKDIR /workspace
COPY apps/cloudflare/sandbox/runtime/image-package.json package.json
COPY apps/cloudflare/sandbox/runtime/image-package-lock.json package-lock.json
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY packages/core/package.json packages/core/package.json
COPY packages/core/src packages/core/src
COPY packages/backend/package.json packages/backend/package.json
COPY packages/backend/src packages/backend/src
COPY packages/shared/package.json packages/shared/package.json
COPY packages/shared/src packages/shared/src
COPY packages/platform-node/package.json packages/platform-node/package.json
COPY packages/platform-node/src packages/platform-node/src
COPY packages/agent-runtime/package.json packages/agent-runtime/package.json
COPY packages/agent-runtime/src packages/agent-runtime/src
COPY apps/cloudflare/sandbox/runtime/package.json apps/cloudflare/sandbox/runtime/package.json
COPY apps/cloudflare/sandbox/runtime/*.ts apps/cloudflare/sandbox/runtime/
COPY apps/cloudflare/sandbox/runtime/build.mjs apps/cloudflare/sandbox/runtime/build.mjs
RUN mkdir -p node_modules/@tabdo && \
  ln -s /workspace/packages/core node_modules/@tabdo/core && \
  ln -s /workspace/packages/backend node_modules/@tabdo/backend && \
  ln -s /workspace/packages/shared node_modules/@tabdo/shared && \
  ln -s /workspace/packages/platform-node node_modules/@tabdo/platform-node && \
  ln -s /workspace/packages/agent-runtime node_modules/@tabdo/agent-runtime
# Compile workspace modules only; third-party SDKs keep their original paths.
RUN node --conditions=development apps/cloudflare/sandbox/runtime/build.mjs
# Bake code-only caches with the same pinned Node version used for each Run.
# Importing the executor does not launch an agent, access a gateway, or read keys.
ENV NODE_COMPILE_CACHE=/workspace/.node-compile-cache
RUN node -e 'await import("./apps/cloudflare/sandbox/runtime/dist/execute.mjs")'
CMD ["sleep", "infinity"]
