// web.js - Koyeb用の簡易HTTPサーバ（依存ゼロ）
import http from "http";

const port = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  const body = JSON.stringify({
    ok: true,
    uptime: process.uptime(),
    now: new Date().toISOString(),
  });
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(body);
});

server.listen(port, () => {
  console.log(`[web] health server listening on :${port}`);
});
