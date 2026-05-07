FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY config ./config
COPY packages ./packages

RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @zh/sdk build

ARG SERVICE
RUN pnpm --filter @zh/${SERVICE} build

ENV NODE_ENV=production
ENV ZH_CONFIG_PATH=/app/config/zero-human.yaml
ENV SERVICE=${SERVICE}
CMD pnpm --filter @zh/${SERVICE} start
