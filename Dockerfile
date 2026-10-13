FROM node:20-alpine
WORKDIR /app
COPY server.mjs updater.mjs ./
COPY public ./public
ENV DATA_DIR=/app/data
VOLUME /app/data
EXPOSE 3000
CMD ["node","server.mjs"]
