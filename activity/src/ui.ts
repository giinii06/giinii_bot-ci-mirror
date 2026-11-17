import { isGraphPeriod, type GraphPeriod, type GraphSnapshot } from "../../src/voice-graph-contract.js";
import { compareReport, focusReport, type Selection } from "./selection.js";

export const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return "0분";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "1분 미만";
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours}시간 ${restMinutes}분` : `${hours}시간`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}일 ${restHours}시간` : `${days}일`;
};

export const PERIOD_LABEL: Record<GraphPeriod, string> = {
  "7d": "최근 7일",
  "30d": "최근 30일",
  all: "전체 기간",
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const listOf = (names: Map<string, string>, entries: { id: string; sharedMs: number }[]) => {
  if (!entries.length) return el("p", "panel-muted", "기록이 없어요.");
  const list = el("ul", "neighbor-list");
  for (const entry of entries) {
    const item = el("li", "neighbor");
    item.append(el("span", "neighbor-name", names.get(entry.id) ?? "알 수 없는 유저"));
    item.append(el("span", "neighbor-time", formatDuration(entry.sharedMs)));
    list.append(item);
  }
  return list;
};

export type PanelHandlers = { onClear: () => void };

export const renderPanel = (
  panel: HTMLElement,
  snapshot: GraphSnapshot,
  selection: Selection,
  handlers: PanelHandlers,
) => {
  panel.replaceChildren();
  const names = new Map(snapshot.nodes.map((node) => [node.id, node.name]));
  const nameOf = (id: string) => names.get(id) ?? "알 수 없는 유저";

  if (selection.mode === "all") {
    delete panel.dataset.collapsed;
    panel.classList.remove("collapsed");
    panel.append(
      el("h2", "panel-title", "전체 네트워크"),
      el("p", "panel-muted",
        `${snapshot.nodes.length}명 · 기본 표시 관계 ${snapshot.links.filter((link) => link.visibleByDefault).length}개`),
      el("p", "panel-hint", "노드를 누르면 그 사람의 관계만 남기고, 다른 사람을 한 번 더 누르면 둘을 비교해요."),
      el("p", "panel-note", "‘친밀도’는 같은 음성 채널에 함께 머문 시간이에요."),
    );
    return;
  }

  let title: HTMLElement;
  const body = el("div", "panel-body");

  if (selection.mode === "focus") {
    const report = focusReport(snapshot, selection.userId);
    title = el("h2", "panel-title", nameOf(report.id));
    body.append(
      el("p", "panel-muted", `${PERIOD_LABEL[snapshot.period]} 음성 접속 ${formatDuration(report.voiceMs)}`),
      el("h3", "panel-subtitle", "주요 상대"),
      listOf(names, report.neighbors),
      el("p", "panel-hint", "다른 노드를 누르면 두 사람을 비교해요."),
    );
  } else {
    const first = nameOf(selection.first);
    if (!selection.second) {
      title = el("h2", "panel-title", first);
      body.append(
        el("p", "panel-hint", "비교할 두 번째 사람을 눌러 주세요."),
        el("p", "panel-muted", `${PERIOD_LABEL[snapshot.period]} 음성 접속 ${formatDuration(focusReport(snapshot, selection.first).voiceMs)}`),
      );
    } else {
      const secondId = selection.second;
      const secondName = nameOf(secondId);
      const report = compareReport(snapshot, selection.first, secondId);
      title = el("h2", "panel-title compare-title");
      title.append(el("span", "name-first", first), el("span", "versus", "vs"), el("span", "name-second", secondName));

      const direct = el("div", "metric");
      direct.append(el("span", "metric-label", "두 사람의 같은 채널 동시 접속"));
      direct.append(el("strong", "metric-value", report.directMs > 0
        ? formatDuration(report.directMs) : "함께한 통화 기록 없음"));
      body.append(direct);

      const shared = el("section", "compare-block");
      shared.append(el("h3", "panel-subtitle", `공통 상대 ${report.sharedNeighbors.length}명`));
      if (report.sharedNeighbors.length) {
        const list = el("ul", "neighbor-list");
        for (const id of report.sharedNeighbors) {
          const item = el("li", "neighbor");
          item.append(el("span", "neighbor-name", nameOf(id)));
          list.append(item);
        }
        shared.append(list);
      } else {
        shared.append(el("p", "panel-muted", "공통으로 함께한 사람이 없어요."));
      }
      body.append(shared);

      const columns = el("div", "compare-columns");
      for (const [side, label, entries] of [
        ["first", first, report.first.neighbors],
        ["second", secondName, report.second.neighbors],
      ] as const) {
        const column = el("section", `compare-block ${side}`);
        column.append(el("h3", "panel-subtitle", `${label}의 주요 상대`));
        column.append(listOf(names, entries));
        columns.append(column);
      }
      body.append(columns);
    }
  }

  const clear = el("button", "panel-clear", "전체 보기");
  clear.type = "button";
  clear.addEventListener("click", handlers.onClear);
  body.append(clear);

  const toggle = el("button", "panel-toggle");
  toggle.type = "button";
  const setCollapsed = (collapsed: boolean) => {
    panel.classList.toggle("collapsed", collapsed);
    panel.dataset.collapsed = String(collapsed);
    toggle.textContent = collapsed ? "펼치기" : "접기";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };
  const initialCollapsed = panel.dataset.collapsed !== undefined
    ? panel.dataset.collapsed === "true"
    : window.matchMedia("(max-width: 720px)").matches;
  setCollapsed(initialCollapsed);
  toggle.addEventListener("click", () => {
    setCollapsed(!panel.classList.contains("collapsed"));
  });

  const header = el("div", "panel-header");
  header.append(title, toggle);
  panel.append(header, body);
};

/** WebGL을 쓸 수 없을 때 같은 JSON으로 읽을 수 있는 표를 만든다. 서버에 3D 대체 렌더를 요구하지 않는다. */
export const renderTableFallback = (root: HTMLElement, snapshot: GraphSnapshot, reason: string) => {
  root.replaceChildren();
  const names = new Map(snapshot.nodes.map((node) => [node.id, node.name]));
  const wrap = el("div", "fallback");
  wrap.append(el("h2", "fallback-title", "3D를 표시할 수 없어 목록으로 보여드려요"));
  wrap.append(el("p", "panel-muted", reason));

  const table = el("table", "fallback-table");
  const head = el("thead");
  const headRow = el("tr");
  for (const label of ["순위", "이름", "음성 접속", "주요 상대"]) headRow.append(el("th", undefined, label));
  head.append(headRow);
  table.append(head);

  const body = el("tbody");
  const ranked = [...snapshot.nodes].sort((a, b) => b.voiceMs - a.voiceMs);
  ranked.forEach((node, index) => {
    const row = el("tr");
    row.append(el("td", undefined, String(index + 1)));
    row.append(el("td", undefined, node.name));
    row.append(el("td", undefined, formatDuration(node.voiceMs)));
    const top = snapshot.links
      .filter((link) => link.source === node.id || link.target === node.id)
      .sort((a, b) => b.sharedMs - a.sharedMs)[0];
    const partner = top ? names.get(top.source === node.id ? top.target : top.source) ?? "알 수 없는 유저" : "없음";
    row.append(el("td", undefined, top ? `${partner} · ${formatDuration(top.sharedMs)}` : partner));
    body.append(row);
  });
  table.append(body);
  wrap.append(table);
  root.append(wrap);
};

export const setStatus = (status: HTMLElement, text: string | null, tone: "info" | "error" = "info") => {
  status.textContent = text ?? "";
  status.dataset.tone = tone;
  status.hidden = !text;
};

export const bindPeriods = (root: HTMLElement, onChange: (period: GraphPeriod) => void) => {
  const buttons = [...root.querySelectorAll<HTMLButtonElement>("[data-period]")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const period = button.dataset.period;
      if (isGraphPeriod(period)) onChange(period);
    });
  }
  return (active: GraphPeriod, loading: boolean) => {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.period === active));
      button.disabled = loading;
    }
  };
};
