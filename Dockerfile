FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node server.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node data ./data
COPY --chown=node:node ui ./ui
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
RUN npm run build
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
