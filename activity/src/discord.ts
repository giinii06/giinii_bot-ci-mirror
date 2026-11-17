import { DiscordSDK } from "@discord/embedded-app-sdk";
import { createSession, fetchActivityConfig } from "./api.js";

const STORAGE_KEY = "gfg_session_token";
const READY_TIMEOUT_MS = 8_000;

/** 디스코드 클라이언트의 iframe이 아닌 곳에서 열렸다는 뜻. 사용자에게 열 자리를 알려주는 신호다. */
export class NotInDiscordError extends Error {
  constructor() {
    super("not_in_discord");
    this.name = "NotInDiscordError";
  }
}

export const readStoredToken = (): string | null => {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

export const clearStoredToken = () => {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장소를 막은 브라우저에서는 지울 것도 없다.
  }
};

const storeToken = (token: string) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, token);
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
export const connectActivity = async (): Promise<string> => {
  const { clientId } = await fetchActivityConfig();
  const sdk = openSdk(clientId);
  await waitForReady(sdk);
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify"],
  });
  const session = await createSession(code, sdk.instanceId);
  storeToken(session.token);
  return session.token;
};
