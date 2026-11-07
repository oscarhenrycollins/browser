FROM node:22.22.3-bookworm-slim
WORKDIR /opt/reader
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY . ./
RUN mkdir /data && chown 1000:1000 /data
USER 1000:1000
ENV NODE_ENV=production
EXPOSE 8080 8081
CMD ["node","server.mjs"]
