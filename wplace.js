// wplace.js
import axios from "axios";

const ENDPOINT = "https://backend.wplace.live/me";
const COMMON_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  "Referer": "https://wplace.live/",
  "Origin": "https://wplace.live",
};

function decodeJwtUserId(token) {
  try {
    const payloadB64 = String(token).split(".")[1];
    if (!payloadB64) return null;
    const json = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    return json.userId ?? json.sub ?? json.user_id ?? null;
  } catch {
    return null;
  }
}

async function tryGet(headers) {
  return axios.get(ENDPOINT, {
    headers: { ...COMMON_HEADERS, ...headers },
    validateStatus: () => true,
    maxRedirects: 0,
  });
}

function looksLikeCF(html) {
  return typeof html === "string" && html.includes("Just a moment");
}

function normalize(d = {}, token) {
  const userIdFromToken = decodeJwtUserId(token);
  return {
    userId: d.userId ?? d.id ?? userIdFromToken ?? null,
    name: d.name ?? "Unknown",
    droplets: d.droplets ?? 0,
    level: Math.floor(d.level ?? 0),
    pixelsPainted: d.pixelsPainted ?? 0,
    paintCurrent: d.charges?.count ?? 0,
    paintMax: d.charges?.max ?? 0,
  };
}

export async function fetchMe(rawToken, mode = "cookie") {
  const token = String(rawToken || "").trim();

  // 1) Bearer
  let res = await tryGet({ Authorization: `Bearer ${token}` });
  if (res.status === 200 && res.data && typeof res.data === "object") {
    return normalize(res.data, token);
  }
  const isCF1 = res.status === 403 && looksLikeCF(res.data);

  // 2) Cookie
  if (mode === "cookie") {
    res = await tryGet({ Cookie: `j=${token};` });
    if (res.status === 200 && res.data && typeof res.data === "object") {
      return normalize(res.data, token);
    }
  }
  const isCF2 = res.status === 403 && looksLikeCF(res.data);

  // 3) フォールバック: Playwright
  if (isCF1 || isCF2 || res.status === 403) {
    const { fetchMeWithPlaywright } = await import("./wplace_pw.js");
    const data = await fetchMeWithPlaywright(token);
    return normalize(data, token);
  }

  throw new Error(
    `HTTP ${res.status}: ${typeof res.data === "string" ? res.data.slice(0, 300) : JSON.stringify(res.data)}`
  );
}

// BlueMarble と同じ算出
export function calcNextLevelPixels(level, pixelsPainted) {
  const need = Math.ceil(
    Math.pow(Math.floor(level) * Math.pow(30, 0.65), 1 / 0.65) - (pixelsPainted ?? 0)
  );
  return Math.max(0, need);
}
