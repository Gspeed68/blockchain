# Multi-stage build: compile TypeScript in a full node image, run the
# compiled output in a slim one. contract.json is deliberately NOT copied
# in here — docker/docker-compose.yml bind-mounts the real one from the
# host at runtime, so a fresh contract deploy takes effect on a container
# restart, not a rebuild (see that file's comment on the `api` service).
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# A placeholder so the image is self-contained before the real
# contract.json is bind-mounted over it (see docker-compose.yml).
COPY src/config/contract.json ./src/config/contract.json
EXPOSE 4100
CMD ["node", "dist/index.js"]
