FROM oven/bun:1.3-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS web
WORKDIR /app
COPY vite.config.ts tsconfig.json ./
COPY web ./web
RUN bun run build:web

FROM oven/bun:1.3-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3800 JOBHUNT_DATA=/app/data CHROME_BIN=chromium
# chromium renders CVs and cover letters to PDF; poppler-utils reads uploaded CV PDFs and counts pages
RUN apt-get update && apt-get install -y --no-install-recommends chromium poppler-utils ca-certificates fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
# Optional: Claude Code CLI, only needed for AI_PROVIDER=claude-cli (a Claude subscription instead of an API key)
ARG INSTALL_CLAUDE_CLI=false
RUN if [ "$INSTALL_CLAUDE_CLI" = "true" ]; then bun add -g @anthropic-ai/claude-code && claude --version; fi
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY assets ./assets
COPY config ./config
COPY --from=web /app/web/dist ./web/dist
EXPOSE 3800
CMD ["bun", "src/index.ts"]
