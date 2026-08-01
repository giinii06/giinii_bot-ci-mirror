export const renderPlaygroundPage = () => `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Giinii Board · Playground</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f4f6f8;
        --panel: #ffffff;
        --panel-soft: #f8fafc;
        --text: #172033;
        --muted: #667085;
        --line: #dbe1e8;
        --accent: #2563eb;
        --accent-dark: #1d4ed8;
        --accent-soft: #eaf1ff;
        --ok: #137a43;
        --danger: #b42318;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0f1218;
          --panel: #171b23;
          --panel-soft: #1d2430;
          --text: #f2f4f7;
          --muted: #9aa4b2;
          --line: #303947;
          --accent: #78a9ff;
          --accent-dark: #9abfff;
          --accent-soft: #1a2c4d;
          --ok: #67d391;
          --danger: #ff8a80;
        }
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font: 15px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .shell { width: min(1180px, calc(100vw - 32px)); margin: 20px auto 48px; }
      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        min-height: 58px;
        padding: 8px 12px 8px 18px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 14px;
        box-shadow: 0 8px 24px rgb(16 24 40 / 6%);
      }
      .brand { color: var(--text); font-weight: 800; letter-spacing: .04em; text-decoration: none; }
      .brand small { color: var(--accent); font-size: 10px; letter-spacing: .14em; margin-left: 6px; }
      .nav { display: flex; gap: 6px; }
      .navLink {
        min-height: 42px;
        display: inline-flex;
        align-items: center;
        padding: 0 15px;
        border-radius: 9px;
        color: var(--muted);
        font-weight: 650;
        text-decoration: none;
      }
      .navLink:hover, .navLink.active { background: var(--accent-soft); color: var(--accent); }
      .pageHeader {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 20px;
        padding: 48px 4px 28px;
      }
      .eyebrow { margin: 0 0 8px; color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: .13em; }
      h1 { margin: 0; font-size: clamp(34px, 6vw, 58px); line-height: 1; letter-spacing: -.04em; }
      .intro { max-width: 620px; margin: 16px 0 0; color: var(--muted); }
      .serverStatus { color: var(--muted); font-size: 13px; text-align: right; }
      .panel {
        margin-top: 16px;
        padding: 24px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 14px;
        box-shadow: 0 8px 24px rgb(16 24 40 / 4%);
      }
      .sectionHeading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
      .sectionHeading strong { font-size: 17px; }
      .hint { color: var(--muted); font-size: 12px; }
      .controls, .commandFields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .field { display: grid; gap: 7px; min-width: 0; }
      .field.wide { grid-column: 1 / -1; }
      .fieldLabel { color: var(--muted); font-size: 13px; font-weight: 650; }
      select, input, textarea {
        width: 100%;
        min-height: 44px;
        padding: 10px 12px;
        border: 1px solid var(--line);
        border-radius: 9px;
        background: var(--panel-soft);
        color: var(--text);
        font: inherit;
      }
      select:focus, input:focus, textarea:focus, button:focus-visible, a:focus-visible { outline: 3px solid color-mix(in srgb, var(--accent) 35%, transparent); outline-offset: 2px; }
      textarea { min-height: 120px; resize: vertical; }
      .commandNote { min-height: 20px; margin: 14px 0 0; color: var(--muted); font-size: 13px; }
      .runs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .runCard { padding: 18px; background: var(--panel-soft); border: 1px solid var(--line); border-radius: 12px; }
      .runTitle { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
      .runTitle strong { font-size: 14px; letter-spacing: .08em; }
      .runBadge { color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .1em; }
      .runCard .field + .field { margin-top: 14px; }
      .runHint { min-height: 18px; margin: 12px 0 0; color: var(--muted); font-size: 12px; }
      .actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 22px; }
      button {
        min-height: 46px;
        padding: 0 20px;
        border: 0;
        border-radius: 9px;
        background: var(--accent);
        color: #fff;
        cursor: pointer;
        font: inherit;
        font-weight: 750;
      }
      button:hover { background: var(--accent-dark); }
      button:disabled { cursor: wait; opacity: .6; }
      .runState { color: var(--muted); font-size: 13px; }
      .results { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      .resultCard { min-width: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; }
      .resultCard.success { border-color: color-mix(in srgb, var(--ok) 45%, var(--line)); }
      .resultCard.error { border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); }
      .resultHead { display: flex; align-items: start; justify-content: space-between; gap: 12px; padding: 16px; background: var(--panel-soft); }
      .resultHead strong { overflow-wrap: anywhere; }
      .resultMeta { color: var(--muted); font-size: 12px; text-align: right; white-space: nowrap; }
      .resultBody { min-height: 180px; max-height: 520px; overflow: auto; padding: 18px; white-space: pre-wrap; overflow-wrap: anywhere; }
      .resultCard.error .resultBody { color: var(--danger); }
      .empty { padding: 28px; border: 1px dashed var(--line); border-radius: 10px; color: var(--muted); text-align: center; }

      @media (max-width: 720px) {
        .shell { width: min(100% - 20px, 1180px); margin-top: 10px; }
        .topbar { align-items: stretch; flex-direction: column; gap: 4px; padding: 10px; }
        .brand { padding: 4px 6px; }
        .nav { width: 100%; }
        .navLink { flex: 1; justify-content: center; }
        .pageHeader { display: grid; align-items: start; padding: 34px 2px 20px; }
        .serverStatus { text-align: left; }
        .panel { padding: 18px; }
        .controls, .commandFields, .runs, .results { grid-template-columns: 1fr; }
        .field.wide { grid-column: auto; }
        .actions { align-items: stretch; flex-direction: column; }
        button { width: 100%; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <nav class="topbar" aria-label="주요 메뉴">
        <a class="brand" href="/">GIINII BOARD <small>AI LAB</small></a>
        <div class="nav">
          <a class="navLink" href="/">메인 메뉴</a>
          <a class="navLink active" href="/playground" aria-current="page">Playground</a>
        </div>
      </nav>

      <main>
        <header class="pageHeader">
          <div>
            <p class="eyebrow">CHAT COMMAND LAB</p>
            <h1>Playground</h1>
            <p class="intro">서버의 저장된 채팅 기록을 기준으로 분석 명령어를 시험합니다. 두 provider와 모델을 이번 실행에만 지정해 나란히 비교할 수 있습니다.</p>
          </div>
          <div id="serverStatus" class="serverStatus" aria-live="polite">서버 목록을 불러오는 중</div>
        </header>

        <section class="panel" aria-labelledby="inputTitle">
          <div class="sectionHeading">
            <strong id="inputTitle">1. 테스트 입력</strong>
            <span id="historyInfo" class="hint"></span>
          </div>
          <div class="controls">
            <label class="field">
              <span class="fieldLabel">Discord 서버</span>
              <select id="server" aria-label="Discord 서버"></select>
            </label>
            <label class="field">
              <span class="fieldLabel">채팅 분석 명령어</span>
              <select id="command" aria-label="채팅 분석 명령어">
                <option value="question">/question · 질문</option>
                <option value="mbti">/mbti · MBTI</option>
                <option value="결투">/결투 · 말싸움 결투</option>
                <option value="계급">/계급 · 서버 계급</option>
                <option value="싸이코지수">/싸이코지수 · 싸이코 지수</option>
                <option value="별명">/별명 · 별명</option>
                <option value="흑역사">/흑역사 · 흑역사</option>
                <option value="요약">/요약 · 서버 요약</option>
                <option value="캐릭터">/캐릭터 · RPG 캐릭터</option>
              </select>
            </label>
            <label class="field">
              <span class="fieldLabel">기준 메시지 수</span>
              <input id="limit" type="number" min="1" max="10000" step="1">
            </label>
            <label class="field">
              <span class="fieldLabel">채널 필터 <span class="hint">선택</span></span>
              <input id="channels" placeholder="#채널 또는 채널 ID" autocomplete="off">
            </label>
          </div>
          <div id="commandFields" class="commandFields" style="margin-top: 16px"></div>
          <p id="commandNote" class="commandNote"></p>
        </section>

        <section class="panel" aria-labelledby="modelTitle">
          <div class="sectionHeading">
            <strong id="modelTitle">2. 비교할 모델</strong>
            <span class="hint">메인 메뉴의 설정은 변경되지 않습니다.</span>
          </div>
          <div class="runs">
            <article class="runCard">
              <div class="runTitle"><strong>RUN A</strong><span class="runBadge">PRIMARY</span></div>
              <label class="field"><span class="fieldLabel">Provider</span><select id="provider0"></select></label>
              <label class="field"><span class="fieldLabel">Model</span><select id="model0"></select></label>
              <p id="runHint0" class="runHint"></p>
            </article>
            <article class="runCard">
              <div class="runTitle"><strong>RUN B</strong><span class="runBadge">COMPARE</span></div>
              <label class="field"><span class="fieldLabel">Provider</span><select id="provider1"></select></label>
              <label class="field"><span class="fieldLabel">Model</span><select id="model1"></select></label>
              <p id="runHint1" class="runHint"></p>
            </article>
          </div>
          <div class="actions">
            <span id="runState" class="runState" aria-live="polite">두 요청은 서버에서 동시에 실행됩니다.</span>
            <button id="runButton" type="button">두 모델 동시에 실행</button>
          </div>
        </section>

        <section id="resultsPanel" class="panel" aria-labelledby="resultTitle" hidden>
          <div class="sectionHeading">
            <strong id="resultTitle">비교 결과</strong>
            <span id="resultMeta" class="hint"></span>
          </div>
          <div id="results" class="results"></div>
        </section>
      </main>
    </div>

    <script>
      const state = { settings: null, servers: [] };
      const providerNames = {
        gemini: "Gemini",
        opencode_zen: "OpenCode Zen",
        nvidia_nim: "NVIDIA NIM",
        openrouter: "OpenRouter",
        bynara: "Bynara Router"
      };
      const commandNotes = {
        question: "최근 채팅을 근거로 자유로운 질문을 보냅니다.",
        mbti: "대상 유저의 최근 말투와 대화 패턴을 분석합니다.",
        결투: "두 유저의 말투와 반박력을 비교합니다.",
        계급: "서버 대화에 등장한 유저들의 관계와 영향력을 분석합니다.",
        싸이코지수: "대상 유저의 장난스러운 혼돈 지수를 측정합니다.",
        별명: "대상 유저의 대화 패턴에 맞는 별명을 제안합니다.",
        흑역사: "대상 유저의 가벼운 흑역사 포인트를 찾습니다.",
        요약: "최근 서버 대화의 사건과 분위기를 요약합니다.",
        캐릭터: "대상 유저의 RPG 캐릭터 시트를 만듭니다."
      };
      const keyNames = {
        gemini: "hasGeminiApiKey",
        opencode_zen: "hasOpencodeZenApiKey",
        nvidia_nim: "hasNvidiaNimApiKey",
        openrouter: "hasOpenrouterApiKey",
        bynara: "hasBynaraApiKey"
      };

      const byId = (id) => document.getElementById(id);

      function addField(container, labelText, id, type) {
        const label = document.createElement("label");
        label.className = "field";
        const title = document.createElement("span");
        title.className = "fieldLabel";
        title.textContent = labelText;
        const input = document.createElement(type === "textarea" ? "textarea" : "input");
        input.id = id;
        input.name = id;
        input.autocomplete = "off";
        if (type !== "textarea") input.placeholder = type === "target" ? "표시 이름 또는 username" : "질문을 입력하세요";
        label.append(title, input);
        container.append(label);
      }

      function renderCommandFields() {
        const command = byId("command").value;
        const fields = byId("commandFields");
        fields.textContent = "";
        byId("commandNote").textContent = commandNotes[command] || "";
        if (command === "question") addField(fields, "질문", "question", "textarea");
        else if (command === "결투") {
          addField(fields, "유저 1", "user1", "target");
          addField(fields, "유저 2", "user2", "target");
        } else if (["mbti", "싸이코지수", "별명", "흑역사", "캐릭터"].includes(command)) {
          addField(fields, "대상 유저", "targetUser", "target");
        }
      }

      function firstModel(provider, preferred) {
        const models = state.settings.freeModels[provider] || [];
        return models.some((model) => model.id === preferred) ? preferred : (models[0] && models[0].id) || "";
      }

      function renderModels(slot, preferred) {
        const provider = byId("provider" + slot).value;
        const select = byId("model" + slot);
        const models = state.settings.freeModels[provider] || [];
        select.textContent = "";
        models.forEach((model) => {
          const option = document.createElement("option");
          option.value = model.id;
          option.textContent = model.name + " · " + model.id;
          select.append(option);
        });
        select.value = firstModel(provider, preferred);
        const keyAvailable = state.settings[keyNames[provider]];
        byId("runHint" + slot).textContent = keyAvailable
          ? providerNames[provider] + "의 메인 메뉴 인증 설정을 사용합니다."
          : "API key가 없습니다. 메인 메뉴에서 " + providerNames[provider] + " key를 저장해 주세요.";
      }

      function renderProviders() {
        [0, 1].forEach((slot) => {
          const select = byId("provider" + slot);
          select.textContent = "";
          Object.keys(providerNames).forEach((provider) => {
            const option = document.createElement("option");
            option.value = provider;
            option.textContent = providerNames[provider];
            select.append(option);
          });
          select.addEventListener("change", () => renderModels(slot));
        });
        const first = state.settings.aiProvider;
        const second = first === "gemini" ? "opencode_zen" : "gemini";
        byId("provider0").value = first;
        byId("provider1").value = second;
        renderModels(0, state.settings.aiModel);
        renderModels(1, second === "opencode_zen" ? state.settings.fallbackModel : undefined);
      }

      function renderServers() {
        const select = byId("server");
        select.textContent = "";
        state.servers.forEach((server) => {
          const option = document.createElement("option");
          option.value = server.id;
          option.textContent = server.name + " · " + server.messageCount.toLocaleString() + "개 기록";
          select.append(option);
        });
        if (!state.servers.length) {
          const option = document.createElement("option");
          option.textContent = "사용 가능한 서버가 없습니다";
          select.append(option);
        }
        select.addEventListener("change", updateServerInfo);
        updateServerInfo();
      }

      function updateServerInfo() {
        const server = state.servers.find((item) => item.id === byId("server").value);
        byId("serverStatus").textContent = server
          ? server.name + " · 저장된 메시지 " + server.messageCount.toLocaleString() + "개"
          : "사용 가능한 서버가 없습니다";
        byId("historyInfo").textContent = server ? "현재 서버 기록 " + server.messageCount.toLocaleString() + "개" : "";
      }

      function value(id) {
        const element = byId(id);
        return element ? element.value.trim() : undefined;
      }

      function renderResults(data) {
        const results = byId("results");
        results.textContent = "";
        data.results.forEach((result, index) => {
          const card = document.createElement("article");
          card.className = "resultCard " + (result.ok ? "success" : "error");
          const head = document.createElement("div");
          head.className = "resultHead";
          const title = document.createElement("strong");
          title.textContent = "RUN " + (index === 0 ? "A" : "B") + " · " + providerNames[result.provider] + " / " + result.model;
          const meta = document.createElement("span");
          meta.className = "resultMeta";
          meta.textContent = (result.ok ? "성공" : "실패") + " · " + result.elapsedMs + "ms";
          head.append(title, meta);
          const body = document.createElement("div");
          body.className = "resultBody";
          body.textContent = result.ok ? result.output : result.error;
          card.append(head, body);
          results.append(card);
        });
        byId("resultMeta").textContent = data.server.name + " · " + data.history.messageCount.toLocaleString() + "개 메시지 · " + data.history.channelCount + "개 채널";
        byId("resultsPanel").hidden = false;
      }

      async function loadPage() {
        const responses = await Promise.all([
          fetch("/api/settings"),
          fetch("/api/playground/servers")
        ]);
        if (!responses[0].ok || !responses[1].ok) throw new Error("설정이나 서버 목록을 불러오지 못했습니다.");
        state.settings = await responses[0].json();
        state.servers = await responses[1].json();
        byId("limit").value = state.settings.historyMessageLimit;
        renderServers();
        renderProviders();
        renderCommandFields();
      }

      async function runComparison() {
        const button = byId("runButton");
        const command = byId("command").value;
        const tests = [0, 1].map((slot) => ({ provider: byId("provider" + slot).value, model: byId("model" + slot).value }));
        const payload = {
          guildId: byId("server").value,
          command,
          question: value("question"),
          targetUser: value("targetUser"),
          user1: value("user1"),
          user2: value("user2"),
          channels: value("channels"),
          limit: Number(byId("limit").value),
          tests
        };
        if (!payload.guildId) {
          byId("runState").textContent = "먼저 서버를 선택해 주세요.";
          return;
        }
        button.disabled = true;
        byId("runState").textContent = "두 모델에 동시에 요청하는 중...";
        byId("resultsPanel").hidden = false;
        byId("results").innerHTML = '<div class="empty">두 모델의 응답을 기다리는 중입니다.</div>';
        try {
          const response = await fetch("/api/playground/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Playground 실행에 실패했습니다.");
          renderResults(data);
          byId("runState").textContent = "비교 실행이 끝났습니다.";
        } catch (error) {
          byId("results").innerHTML = "";
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = error.message || "Playground 실행에 실패했습니다.";
          byId("results").append(empty);
          byId("runState").textContent = "실행에 실패했습니다.";
        } finally {
          button.disabled = false;
        }
      }

      byId("command").addEventListener("change", renderCommandFields);
      byId("runButton").addEventListener("click", runComparison);
      loadPage().catch((error) => {
        byId("serverStatus").textContent = error.message || "불러오기 실패";
        byId("runState").textContent = "페이지를 새로고침해 다시 시도해 주세요.";
      });
    </script>
  </body>
</html>`;
