FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install --production
COPY server ./server
CMD ["node", "server/index.js"]
