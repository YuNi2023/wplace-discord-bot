# Dockerfile - Koyeb用。Playwright(Chromium)入り公式イメージを使用
FROM mcr.microsoft.com/playwright:v1.55.0-noble

# 作業ディレクトリ
WORKDIR /app

# 依存インストール（package.json / lock を先にコピーしてレイヤキャッシュを効かせる）
COPY package*.json ./
RUN npm ci || npm install

# 残りのソースをコピー
COPY . .

# Web Service 要件：ポート公開（web.js は PORT または 8080 で listen）
ENV NODE_ENV=production
EXPOSE 8080

# 起動コマンド（ボット本体）
CMD ["node", "bot.js"]
