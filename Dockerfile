# Builds and serves the Next.js frontend for the Docker Compose dev stack.
#
# NEXT_PUBLIC_* variables are inlined into the client JS bundle at build
# time, so they're passed as build ARGs (not just runtime env) — see
# docker-compose.yml, which supplies values pointing at the mock RPC/API
# services so the browser can reach them directly (mapped to localhost).
FROM node:24-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
# CI=true skips the `prepare` script's `husky install` — there's no .git
# directory in the build context, so that would otherwise fail the build.
RUN CI=true npm ci

FROM node:24-alpine AS build

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_CONTRACT_ID
ARG NEXT_PUBLIC_NETWORK
ARG NEXT_PUBLIC_HORIZON_URL
ARG NEXT_PUBLIC_SOROBAN_RPC
ARG NEXT_PUBLIC_IPFS_GATEWAY
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_ADMIN_ADDRESS
ARG NEXT_PUBLIC_DOMAIN
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_SEP10_SERVER_ACCOUNT
ARG NEXT_PUBLIC_SEP10_HOME_DOMAIN
ENV NEXT_PUBLIC_CONTRACT_ID=$NEXT_PUBLIC_CONTRACT_ID \
    NEXT_PUBLIC_NETWORK=$NEXT_PUBLIC_NETWORK \
    NEXT_PUBLIC_HORIZON_URL=$NEXT_PUBLIC_HORIZON_URL \
    NEXT_PUBLIC_SOROBAN_RPC=$NEXT_PUBLIC_SOROBAN_RPC \
    NEXT_PUBLIC_IPFS_GATEWAY=$NEXT_PUBLIC_IPFS_GATEWAY \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_ADMIN_ADDRESS=$NEXT_PUBLIC_ADMIN_ADDRESS \
    NEXT_PUBLIC_DOMAIN=$NEXT_PUBLIC_DOMAIN \
    NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_SEP10_SERVER_ACCOUNT=$NEXT_PUBLIC_SEP10_SERVER_ACCOUNT \
    NEXT_PUBLIC_SEP10_HOME_DOMAIN=$NEXT_PUBLIC_SEP10_HOME_DOMAIN \
    CI=true \
    NODE_ENV=production

RUN npm run build

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.js ./next.config.js
COPY --from=build /app/next-sitemap.config.js ./next-sitemap.config.js

EXPOSE 3000

CMD ["npm", "start"]
