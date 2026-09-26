# Multi-stage build: compile the Vite app, serve the static output with
# nginx. VITE_API_BASE_URL is a build-time arg because Vite inlines
# `import.meta.env.*` into the JS bundle at build time — there's no
# runtime env var to change after the fact, so scripts/
# 06-deploy-contract-and-app.sh passes the VM's real public IP as this arg
# when it builds this image.
FROM node:20-slim AS build
ARG VITE_API_BASE_URL=http://localhost:4100
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
