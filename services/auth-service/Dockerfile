# Dockerfile mẫu — dùng chung cho MỌI service (đổi SERVICE_DIR khi copy sang service khác)
# Multi-stage: dev (hot reload) / build / production (nhẹ)
# Build từ ROOT của repo: docker build -f services/auth-service/Dockerfile .

ARG SERVICE_DIR=services/auth-service

# ---------- base ----------
FROM node:24-alpine AS base
WORKDIR /app
ARG SERVICE_DIR
ENV SERVICE_DIR=${SERVICE_DIR}

# ---------- dev (dùng cho docker-compose.yml) ----------
FROM base AS dev
COPY ${SERVICE_DIR}/package*.json ./${SERVICE_DIR}/
RUN cd ${SERVICE_DIR} && npm install
COPY proto ./proto
COPY ${SERVICE_DIR} ./${SERVICE_DIR}
WORKDIR /app/${SERVICE_DIR}
EXPOSE 3000 50051 50052 50053
CMD ["npm", "run", "start:dev"]

# ---------- build ----------
FROM base AS build
COPY ${SERVICE_DIR}/package*.json ./${SERVICE_DIR}/
RUN cd ${SERVICE_DIR} && npm ci
COPY proto ./proto
COPY ${SERVICE_DIR} ./${SERVICE_DIR}
RUN cd ${SERVICE_DIR} && npm run build && npm prune --production

# ---------- production (image cuối, gọn nhẹ để tiết kiệm ECR + RAM) ----------
FROM node:24-alpine AS production
WORKDIR /app
ARG SERVICE_DIR
ENV NODE_ENV=production
# copy proto + dist + node_modules đã prune
COPY --from=build /app/proto ./proto
COPY --from=build /app/${SERVICE_DIR}/dist ./dist
COPY --from=build /app/${SERVICE_DIR}/node_modules ./node_modules
COPY --from=build /app/${SERVICE_DIR}/package.json ./package.json
EXPOSE 3000 50051 50052 50053
CMD ["node", "dist/main.js"]
