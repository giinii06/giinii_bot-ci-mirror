export type AvatarImage = { bytes: Uint8Array<ArrayBuffer>; contentType: string };

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_LIMIT = 128;

/**
 * Discord CDN에서 아바타 바이트를 받아 온다. 임의 URL을 받지 않는다.
 * 호출자는 이미 허용 목록에서 꺼낸 URL만 넘긴다.
 */
export const createAvatarProxy = (clock: () => number = Date.now) => {
  const cache = new Map<string, { image: AvatarImage; fetchedAt: number }>();

  const load = async (url: string): Promise<AvatarImage | null> => {
    const now = clock();
    const cached = cache.get(url);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.image;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "image/png,image/jpeg,image/webp" },
    }).catch(() => null);
    if (!response?.ok) return null;

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    if (!contentType.startsWith("image/")) return null;
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > MAX_BYTES) return null;

    const bytes = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;

    const image = { bytes, contentType };
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(url, { image, fetchedAt: now });
    return image;
  };

  return { load };
};
