# Build stage
FROM node:20-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY server.ts ./
COPY situations.json ./

RUN npm run build

# Runtime stage
FROM node:20-slim
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/situations.json ./situations.json

EXPOSE 8080
CMD ["npm", "start"]