FROM node:24-alpine

ENV NODE_ENV=production PORT=3000
WORKDIR /app

# Harici paket yok: npm install adımı da yok.
COPY site ./site
COPY sunucu ./sunucu

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/saglik >/dev/null || exit 1

CMD ["node", "sunucu/sunucu.mjs"]
