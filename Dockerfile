FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S quill && adduser -S quill -G quill
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist ./dist
USER quill
EXPOSE 8086
CMD ["node", "dist/main"]
