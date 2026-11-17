/**
 * Activity 인증의 두 다리. 둘 다 디스코드 API와 대화하는 경계라 여기서만 검증한다.
 * - 인스턴스 조회는 봇 토큰으로 부른다. 길드 ID는 이 응답에서만 나오고 클라이언트가 보낸 값은 쓰지 않는다.
 * - 코드 교환은 서버 시크릿으로 부른다. 유저 ID는 이 응답에서만 나온다.
 * 코드·액세스 토큰·시크릿은 어떤 경로로도 로그에 남기지 않는다.
 */
const DISCORD_API_BASE = "https://discord.com/api/v10";
const TIMEOUT_MS = 5_000;
const INSTANCE_ID_PATTERN = /^i-[A-Za-z0-9-]+$/;

export type ActivityInstance = { guildId: string; userIds: string[] };
export type ActivityIdentity = { userId: string };

export type DiscordActivityAuth = {
  resolveInstance: (instanceId: string) => Promise<ActivityInstance | null>;
  exchangeCode: (code: string) => Promise<ActivityIdentity | null>;
};

export type DiscordActivityAuthOptions = {
  clientId: string;
  clientSecret: string;
  botToken: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
};

const readJson = async (response: Response): Promise<Record<string, unknown> | null> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" ? body as Record<string, unknown> : null;
};

export const createDiscordActivityAuth = ({
  clientId, clientSecret, botToken, apiBase = DISCORD_API_BASE, fetchImpl = fetch,
}: DiscordActivityAuthOptions): DiscordActivityAuth => {
  const resolveInstance = async (instanceId: string): Promise<ActivityInstance | null> => {
    if (typeof instanceId !== "string" || !instanceId || instanceId.length > 128) return null;
    if (!INSTANCE_ID_PATTERN.test(instanceId)) return null;

    const response = await fetchImpl(
      `${apiBase}/applications/${clientId}/activity-instances/${encodeURIComponent(instanceId)}`,
      { headers: { authorization: `Bot ${botToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    ).catch(() => null);
    if (!response?.ok) return null;

    const body = await readJson(response);
    // 응답이 요청한 앱과 인스턴스의 것인지 확인한다. 다른 앱의 인스턴스 ID를 넣는 우회를 막는다.
    if (body?.application_id !== clientId || body?.instance_id !== instanceId) return null;
    const location = body?.location;
    if (!location || typeof location !== "object") return null;
    const { kind, guild_id: guildId } = location as Record<string, unknown>;
    // "pc"는 DM이나 그룹 DM 안에서 열린 인스턴스다. 길드가 없으므로 그래프를 만들 수 없다.
    if (kind !== "gc") return null;
    if (typeof guildId !== "string" || !guildId) return null;

    const users = body?.users;
    if (!Array.isArray(users) || !users.every((id) => typeof id === "string")) return null;
    return { guildId, userIds: users as string[] };
  };

  const exchangeCode = async (code: string): Promise<ActivityIdentity | null> => {
    if (typeof code !== "string" || !code || code.length > 512) return null;

    const tokenResponse = await fetchImpl(`${apiBase}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    if (!tokenResponse?.ok) return null;

    const accessToken = (await readJson(tokenResponse))?.access_token;
    if (typeof accessToken !== "string" || !accessToken) return null;

    const userResponse = await fetchImpl(`${apiBase}/users/@me`, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    if (!userResponse?.ok) return null;

    const userId = (await readJson(userResponse))?.id;
    if (typeof userId !== "string" || !userId) return null;
    return { userId };
  };

  return { resolveInstance, exchangeCode };
};
