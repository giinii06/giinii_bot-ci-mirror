import { DiscordSDK } from "@discord/embedded-app-sdk";
import { createSession, fetchActivityConfig, fetchSession } from "./api.js";

const STORAGE_KEY = "gfg_session";
const READY_TIMEOUT_MS = 8_000;

/** 디스코드 클라이언트의 iframe이 아닌 곳에서 열렸다는 뜻. 사용자에게 열 자리를 알려주는 신호다. */
export class NotInDiscordError extends Error {
  constructor() {
    super("not_in_discord");
    this.name = "NotInDiscordError";
  }
}

type StoredSession = { token: string; instanceId: string };

const readStoredSession = (): StoredSession | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.token !== "string" || typeof parsed.instanceId !== "string") return null;
    return { token: parsed.token, instanceId: parsed.instanceId };
  } catch {
    return null;
  }
};

const clearStoredSession = () => {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장소를 막은 브라우저에서는 지울 것도 없다.
  }
};

const storeSession = (session: StoredSession) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // 저장하지 못해도 이번 탭에서는 계속 쓸 수 있다.
  }
};

/**
 * 생성자가 frame_id·instance_id·platform 쿼리 파라미터를 검사하고 없으면 던진다.
 * 디스코드 밖에서 주소를 직접 연 경우가 정확히 이 경우다.
 */
const openSdk = (clientId: string): DiscordSDK => {
  try {
    return new DiscordSDK(clientId);
  } catch {
    throw new NotInDiscordError();
  }
};

const waitForReady = (sdk: DiscordSDK) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new NotInDiscordError()), READY_TIMEOUT_MS);
  sdk.ready().then(
    () => {
      clearTimeout(timer);
      resolve();
    },
    () => {
      clearTimeout(timer);
      reject(new NotInDiscordError());
    },
  );
});

/** 디스코드와 핸드셰이크하고 OAuth 코드를 서버 세션으로 바꿔 온다. */
export const connectActivity = async (): Promise<StoredSession> => {
  const { clientId } = await fetchActivityConfig();
  const sdk = openSdk(clientId);
  await waitForReady(sdk);

  // 같은 인스턴스의 새로고침이면 저장된 세션을 쓴다. 다른 인스턴스(다른 길드)의
  // 토큰을 재사용하면 현재 Activity의 명령 게이트를 건너뛰므로 인스턴스까지 비교한다.
  const stored = readStoredSession();
  if (stored?.instanceId === sdk.instanceId) {
    const alive = await fetchSession(stored.token, sdk.instanceId).then(() => true, () => false);
    if (alive) return stored;
    clearStoredSession();
  }

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });
  const session = await createSession(code, sdk.instanceId);
  const issued = { token: session.token, instanceId: sdk.instanceId };
  storeSession(issued);
  return issued;
};
