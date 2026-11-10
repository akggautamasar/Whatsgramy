FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
RUN mkdir /app/data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 DATA_DIR=/app/data
EXPOSE 8787
CMD ["node", "src/server.js"]
