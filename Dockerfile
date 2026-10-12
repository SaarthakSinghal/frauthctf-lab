FROM node:22-bookworm-slim
WORKDIR /app
COPY --chown=node:node app.js ./app.js
USER node
EXPOSE 8080
CMD ["node", "app.js"]
