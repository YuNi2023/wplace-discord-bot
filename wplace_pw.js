// wplace_pw.js
import { chromium, devices } from "playwright";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

export async function fetchMeWithPlaywright(rawToken) {
  const token = String(rawToken || "").trim();
  const browser = await chromium.launch({
    headless: true,                     // 必要なら false にして動作確認
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      userAgent: UA,
      locale: "ja-JP",
      colorScheme: "dark",
      viewport: { width: 1280, height: 800 },
      ...devices["Desktop Chrome"],
    });

    // Cookie j をセット（両ドメインに効かせやすいよう domain を .wplace.live に）
    await context.addCookies([
      {
        name: "j",
        value: token,
        domain: ".wplace.live",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);

    const page = await context.newPage();

    // 1) まずフロントを開く（CF の検知を正面突破）
    await page.goto("https://wplace.live/", { waitUntil: "domcontentloaded", timeout: 30000 });

    // 2) ページ内の fetch で /me を取得（credentials: "include" がポイント）
    const data = await page.evaluate(async () => {
      const res = await fetch("https://backend.wplace.live/me", {
        method: "GET",
        credentials: "include",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Referer": "https://wplace.live/",
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`PW HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return res.json();
    });

    await context.close();
    await browser.close();
    return data;
  } catch (e) {
    await browser.close();
    throw e;
  }
}
