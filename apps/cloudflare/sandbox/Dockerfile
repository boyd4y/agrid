FROM node:24.14.1-bookworm-slim
WORKDIR /opt/tabdo/sandbox

# Isolated fixture dependencies. The Worker never bundles these Node SDKs.
COPY apps/cloudflare/sandbox/fixture-package.json ./package.json
COPY apps/cloudflare/sandbox/fixture-package-lock.json ./package-lock.json
RUN npm ci --omit=dev --no-audit --no-fund --ignore-scripts
COPY packages/core ./packages/core
COPY packages/platform-node ./packages/platform-node
RUN mkdir -p node_modules/@tabdo \
  && ln -s /opt/tabdo/sandbox/packages/core node_modules/@tabdo/core \
  && ln -s /opt/tabdo/sandbox/packages/platform-node node_modules/@tabdo/platform-node
COPY apps/cloudflare/sandbox/native-entry.ts ./native-entry.ts

# The DO starts finite Harness processes using exec(); this is not a Node API.
CMD ["sleep", "infinity"]
