FROM oven/bun:1.3.14

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY audio ./audio
COPY SOUL.md ./SOUL.md
COPY scripts ./scripts

VOLUME ["/app/data"]
CMD ["sh", "-c", "bun run scripts/restore-db.ts /app/data/seed /app/data/guilds && exec bun run start"]
