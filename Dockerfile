FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
RUN apk add --no-cache git openssh-client

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY config ./config
COPY packages ./packages

RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @zh/sdk build

ARG SERVICE
ARG CODEX_VERSION=0.130.0
ARG CLAUDE_CODE_VERSION=2.1.138
RUN if [ "$SERVICE" = "brain" ]; then npm install -g @openai/codex@${CODEX_VERSION} @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}; fi
RUN pnpm --filter @zh/${SERVICE} build

ENV NODE_ENV=production
ENV ZH_CONFIG_PATH=/app/config/zero-human.yaml
ENV SERVICE=${SERVICE}
CMD pnpm --filter @zh/${SERVICE} start
