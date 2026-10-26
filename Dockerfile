FROM node:24-alpine

ENV NODE_ENV=production PORT=3000 PLAN_VERI=/app/veri
WORKDIR /app

# Harici paket yok: npm install adımı da yok.
COPY site ./site
COPY sunucu ./sunucu

# DeepCore planının verisi kalıcı birimde durur (Coolify → Storages → /app/veri).
# Klasör node kullanıcısına ait açılır; boş bir birim bağlandığında bu sahipliği devralır,
# yoksa uygulama birime yazamaz. Birim yoksa plan çalışır ama arayüz "kalıcı değil" der.
RUN mkdir -p /app/veri && chown node:node /app/veri

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/saglik >/dev/null || exit 1

CMD ["node", "sunucu/sunucu.mjs"]
