FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server.js version.json ./
COPY public ./public
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/version || exit 1
CMD ["node","server.js"]
