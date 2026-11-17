# 3D 그래프 SPA는 정적 번들이라 CPU로만 빌드한다. 런타임 이미지에는 Vite가 들어가지 않는다.
FROM oven/bun:1.3.14 AS activity

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY activity ./activity
COPY src/voice-graph-contract.ts ./src/
RUN bun run build:activity

FROM oven/bun:1.3.14

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY audio ./audio
COPY SOUL.md ./SOUL.md
COPY scripts ./scripts
COPY --from=activity /app/activity/dist ./activity/dist

VOLUME ["/app/data"]
CMD ["sh", "-c", "bun run scripts/restore-db.ts /app/data/seed /app/data/guilds && exec bun run start"]
