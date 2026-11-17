import "./style.css";
import type { GraphPeriod, GraphSnapshot } from "../../src/voice-graph-contract.js";
import { ApiError, fetchGraph, fetchSession, hydrateAvatars } from "./api.js";
import { NotInDiscordError, clearStoredToken, connectActivity, readStoredToken } from "./discord.js";
import { mountGraph, type GraphView } from "./graph.js";
import { initialSelection, pruneSelection, selectNode, type Selection } from "./selection.js";
import { bindPeriods, renderPanel, renderTableFallback, setStatus } from "./ui.js";

const must = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing activity layout: ${selector}`);
  return element;
};

const scene = must<HTMLElement>("#scene");
const panel = must<HTMLElement>("#panel");
const status = must<HTMLElement>("#status");
const topbar = must<HTMLElement>(".topbar");

const supportsWebGL = () => {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
};

const messageFor = (error: unknown) => {
  if (error instanceof NotInDiscordError) return "디스코드 안에서 /친밀도그래프3d로 열어 주세요.";
  if (error instanceof ApiError) {
    if (error.status === 401) return "세션이 만료됐어요. 디스코드에서 /친밀도그래프3d를 다시 실행해 주세요.";
    if (error.status === 403) return "이 서버에서 그래프를 볼 권한이 없어요.";
    if (error.status === 429) return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
  }
  return "그래프를 불러오지 못했어요.";
};

let sessionToken: string | null = null;
let snapshot: GraphSnapshot | null = null;
let selection: Selection = initialSelection;
let view: GraphView | null = null;
let period: GraphPeriod = "all";
let requestId = 0;
let controller: AbortController | null = null;
/** 지금 화면에 올라간 아바타 object URL. 새 스냅샷이 붙은 뒤에야 해제한다. */
let avatarUrls: string[] = [];

const releaseAvatars = (urls: string[]) => {
  for (const url of urls) URL.revokeObjectURL(url);
};

const syncPeriodButtons = bindPeriods(topbar, (next) => { void load(next); });

const clearSelection = () => {
  if (!snapshot || !view) return;
  selection = initialSelection;
  view.applySelection(selection);
  renderPanel(panel, snapshot, selection, { onClear: clearSelection });
};

const handleSelect = (userId: string | null) => {
  if (!snapshot || !view) return;
  selection = userId === null ? initialSelection : selectNode(selection, userId);
  view.applySelection(selection);
  renderPanel(panel, snapshot, selection, { onClear: clearSelection });
};

const mount = async (next: GraphSnapshot) => {
  if (!supportsWebGL()) {
    renderTableFallback(scene, next,
      "이 브라우저에서 WebGL을 켤 수 없어요. 하드웨어 가속을 켜거나 디스코드에서 /친밀도그래프로 이미지를 확인해 주세요.");
    return;
  }
  try {
    view = await mountGraph(scene, next, selection, handleSelect);
  } catch (error) {
    console.error(error);
    renderTableFallback(scene, next, "3D 장면을 초기화하지 못했어요. 같은 데이터를 목록으로 보여드려요.");
  }
};

async function load(nextPeriod: GraphPeriod) {
  const token = sessionToken;
  if (!token) return;
  const id = ++requestId;
  controller?.abort();
  const local = new AbortController();
  controller = local;
  period = nextPeriod;
  syncPeriodButtons(nextPeriod, true);
  setStatus(status, "불러오는 중…");

  try {
    const next = await fetchGraph(nextPeriod, token, local.signal);
    if (id !== requestId) return;
    const nextAvatars = await hydrateAvatars(next, token, local.signal);
    if (id !== requestId) {
      releaseAvatars(nextAvatars);
      return;
    }
    snapshot = next;
    selection = pruneSelection(selection, next);
    try {
      if (view) await view.setSnapshot(next, selection);
      else await mount(next);
    } catch (error) {
      releaseAvatars(nextAvatars);
      throw error;
    }
    // 새 화면이 붙기 전에 이전 URL을 해제하면 텍스처가 빈 채로 남는다. 순서를 지킨다.
    const previous = avatarUrls;
    avatarUrls = nextAvatars;
    releaseAvatars(previous);
    renderPanel(panel, next, selection, { onClear: clearSelection });
    setStatus(status, null);
  } catch (error) {
    if (local.signal.aborted) return;
    setStatus(status, messageFor(error), "error");
  } finally {
    if (id === requestId) syncPeriodButtons(nextPeriod, false);
  }
}

/** 같은 탭에서 기간을 바꿀 때마다 핸드셰이크를 다시 하지 않도록 저장된 세션을 먼저 쓴다. */
const resumeSession = async (): Promise<string | null> => {
  const stored = readStoredToken();
  if (!stored) return null;
  const alive = await fetchSession(stored).then(() => true, () => false);
  if (alive) return stored;
  clearStoredToken();
  return null;
};

const boot = async () => {
  try {
    sessionToken = await resumeSession() ?? await connectActivity();
  } catch (error) {
    setStatus(status, messageFor(error), "error");
    syncPeriodButtons(period, true);
    return;
  }
  await load("all");
};

window.addEventListener("pagehide", () => {
  view?.dispose();
  releaseAvatars(avatarUrls);
  avatarUrls = [];
}, { once: true });

void boot();
