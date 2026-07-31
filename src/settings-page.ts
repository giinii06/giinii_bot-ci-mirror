export const renderSettingsPage = () => `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Discord Question Bot Settings</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f7f7f5;
        --panel: #ffffff;
        --text: #171717;
        --muted: #666b73;
        --line: #d8d8d3;
        --accent: #2563eb;
        --accent-dark: #1d4ed8;
        --ok: #16803c;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #111214;
          --panel: #181a1f;
          --text: #f4f4f5;
          --muted: #a6a9b0;
          --line: #30333a;
          --accent: #60a5fa;
          --accent-dark: #3b82f6;
          --ok: #4ade80;
        }
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font: 15px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        width: min(920px, calc(100vw - 32px));
        margin: 40px auto;
      }
      header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: end;
        margin-bottom: 24px;
      }
      h1 {
        margin: 0;
        font-size: clamp(28px, 4vw, 42px);
        line-height: 1.05;
        letter-spacing: 0;
      }
      .status {
        min-width: 128px;
        color: var(--muted);
        text-align: right;
      }
      form {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 24px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
      }
      label {
        display: grid;
        gap: 7px;
        color: var(--muted);
        font-size: 13px;
      }
      input, select, textarea {
        width: 100%;
        min-height: 42px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: transparent;
        color: var(--text);
        padding: 9px 11px;
        font: inherit;
      }
      textarea {
        min-height: 180px;
        resize: vertical;
      }
      textarea.commandPrompt {
        min-height: 150px;
      }
      input[type="checkbox"] {
        width: 18px;
        min-height: 18px;
      }
      .wide { grid-column: 1 / -1; }
      .check {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 42px;
      }
      .hint {
        color: var(--muted);
        font-size: 12px;
      }
      .modelCards {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .modelCard {
        display: grid;
        gap: 6px;
        width: 100%;
        min-height: 104px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: transparent;
        color: var(--text);
        cursor: pointer;
        padding: 12px;
        text-align: left;
      }
      .modelCard:hover {
        border-color: var(--accent);
        background: color-mix(in srgb, var(--accent) 8%, transparent);
      }
      .modelCard.selected {
        border-color: var(--accent);
        box-shadow: 0 0 0 1px var(--accent) inset;
      }
      .modelName {
        font-weight: 700;
      }
      .modelId {
        color: var(--muted);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 12px;
        overflow-wrap: anywhere;
      }
      .modelMeta {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .pill {
        border: 1px solid var(--line);
        border-radius: 999px;
        color: var(--muted);
        font-size: 11px;
        padding: 2px 7px;
      }
      .actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
        border-top: 1px solid var(--line);
        margin-top: 24px;
        padding-top: 20px;
      }
      button {
        border: 0;
        border-radius: 6px;
        background: var(--accent);
        color: white;
        cursor: pointer;
        font: inherit;
        font-weight: 650;
        min-height: 42px;
        padding: 0 18px;
      }
      button:hover { background: var(--accent-dark); }
      .saved { color: var(--ok); }

      @media (max-width: 720px) {
        main { margin: 24px auto; }
        header { display: grid; align-items: start; }
        .status { text-align: left; }
        form { padding: 18px; }
        .grid { grid-template-columns: 1fr; }
        .modelCards { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Bot Settings</h1>
        <div id="status" class="status">Loading</div>
      </header>

      <form id="settingsForm">
        <div class="grid">
          <label>
            Provider
            <select name="aiProvider">
              <option value="gemini">Gemini</option>
              <option value="opencode_zen">OpenCode Zen</option>
              <option value="nvidia_nim">NVIDIA NIM</option>
              <option value="openrouter">OpenRouter</option>
              <option value="bynara">Bynara Router</option>
            </select>
          </label>

          <div class="wide">
            <input name="aiModel" type="hidden">
            <label>
              Model
              <div id="modelCards" class="modelCards"></div>
              <span class="hint">현재 provider에서 선택 가능한 모델만 표시됩니다.</span>
            </label>
          </div>

          <label>
            공통 기준 메시지 수
            <input name="historyMessageLimit" type="number" min="1" max="10000" step="1">
            <span class="hint">모든 분석 명령이 함께 기본값으로 사용합니다.</span>
          </label>

          <label>
            최대 컨텍스트 문자 수
            <input name="maxContextChars" type="number" min="10000" max="1000000" step="1000">
          </label>

          <label class="wide">
            공통 프롬프트
            <textarea name="commonPrompt" spellcheck="false"></textarea>
            <span class="hint">모든 명령 프롬프트 앞에 공통으로 붙는 지시문입니다.</span>
          </label>

          <label class="wide">
            /question 프롬프트
            <textarea name="questionPrompt" spellcheck="false"></textarea>
            <span class="hint">공통 프롬프트 뒤에 붙는 /question 전용 지시문입니다.</span>
          </label>

          <label class="wide">
            /mbti 프롬프트
            <textarea class="commandPrompt" name="mbtiPrompt" spellcheck="false"></textarea>
          </label>

          <label class="wide">
            /결투 프롬프트
            <textarea class="commandPrompt" name="duelPrompt" spellcheck="false"></textarea>
          </label>

          <label class="wide">
            /계급 프롬프트
            <textarea class="commandPrompt" name="rankPrompt" spellcheck="false"></textarea>
          </label>

          <label class="wide">
            /싸이코지수 프롬프트
            <textarea class="commandPrompt" name="psychoPrompt" spellcheck="false"></textarea>
          </label>

          <label class="wide">
            /별명 프롬프트
            <textarea class="commandPrompt" name="nicknamePrompt" spellcheck="false"></textarea>
          </label>

          <label class="wide">
            /흑역사 프롬프트
            <textarea class="commandPrompt" name="throwbackPrompt" spellcheck="false"></textarea>
          </label>

          <label class="wide">
            /요약 프롬프트
            <textarea class="commandPrompt" name="summaryPrompt" spellcheck="false"></textarea>
          </label>

          <label class="wide">
            /캐릭터 프롬프트
            <textarea class="commandPrompt" name="characterPrompt" spellcheck="false"></textarea>
          </label>

          <label class="wide check">
            <input name="includeBotMessages" type="checkbox">
            봇 메시지도 기록에 포함
          </label>

          <label>
            Gemini API key
            <input name="geminiApiKey" type="password" autocomplete="off" placeholder="저장된 key 유지">
            <span id="geminiKeyHint" class="hint"></span>
          </label>

          <label>
            OpenCode Zen API key
            <input name="opencodeZenApiKey" type="password" autocomplete="off" placeholder="저장된 key 유지">
            <span id="opencodeKeyHint" class="hint"></span>
          </label>

          <label class="wide">
            OpenCode Zen base URL
            <input name="opencodeZenBaseUrl" placeholder="http://localhost:8080/v1">
          </label>

          <label>
            NVIDIA NIM API key
            <input name="nvidiaNimApiKey" type="password" autocomplete="off" placeholder="저장된 key 유지">
            <span id="nvidiaKeyHint" class="hint"></span>
          </label>

          <label>
            NVIDIA NIM base URL
            <input name="nvidiaNimBaseUrl" placeholder="https://integrate.api.nvidia.com/v1">
          </label>

          <label>
            OpenRouter API key
            <input name="openrouterApiKey" type="password" autocomplete="off" placeholder="저장된 key 유지">
            <span id="openrouterKeyHint" class="hint"></span>
          </label>

          <label>
            OpenRouter base URL
            <input name="openrouterBaseUrl" placeholder="https://openrouter.ai/api/v1">
          </label>

          <label>
            Bynara API key
            <input name="bynaraApiKey" type="password" autocomplete="off" placeholder="저장된 key 유지">
            <span id="bynaraKeyHint" class="hint"></span>
          </label>

          <label>
            Bynara base URL
            <input name="bynaraBaseUrl" placeholder="https://router.bynara.id/v1">
          </label>
        </div>

        <div class="actions">
          <span id="saveState" class="hint"></span>
          <button type="submit">Save</button>
        </div>
      </form>
    </main>

    <script>
      const form = document.querySelector("#settingsForm");
      const modelCards = document.querySelector("#modelCards");
      const statusEl = document.querySelector("#status");
      const saveState = document.querySelector("#saveState");
      let settingsCache;

      function renderModelCards(provider, selectedModel) {
        modelCards.textContent = "";
        const models = settingsCache.freeModels[provider] || [];
        const selected = models.some((model) => model.id === selectedModel) ? selectedModel : models[0]?.id;
        form.aiModel.value = selected || "";

        for (const model of models) {
          const card = document.createElement("button");
          card.type = "button";
          card.className = "modelCard" + (model.id === form.aiModel.value ? " selected" : "");
          card.dataset.model = model.id;
          card.innerHTML = [
            '<span class="modelName"></span>',
            '<span class="modelId"></span>',
            '<span class="modelMeta"><span class="pill"></span><span class="pill"></span></span>'
          ].join("");
          card.querySelector(".modelName").textContent = model.name;
          card.querySelector(".modelId").textContent = model.id;
          const pills = card.querySelectorAll(".pill");
          pills[0].textContent = model.note;
          pills[1].textContent = model.context;
          card.addEventListener("click", () => {
            form.aiModel.value = model.id;
            for (const item of modelCards.querySelectorAll(".modelCard")) item.classList.remove("selected");
            card.classList.add("selected");
          });
          modelCards.append(card);
        }
      }

      async function loadSettings() {
        const settings = await fetch("/api/settings").then((response) => response.json());
        settingsCache = settings;
        form.aiProvider.value = settings.aiProvider;
        renderModelCards(settings.aiProvider, settings.aiModel);
        form.historyMessageLimit.value = settings.historyMessageLimit;
        form.maxContextChars.value = settings.maxContextChars;
        form.commonPrompt.value = settings.commonPrompt || "";
        form.questionPrompt.value = settings.questionPrompt || "";
        form.mbtiPrompt.value = settings.mbtiPrompt || "";
        form.duelPrompt.value = settings.duelPrompt || "";
        form.rankPrompt.value = settings.rankPrompt || "";
        form.psychoPrompt.value = settings.psychoPrompt || "";
        form.nicknamePrompt.value = settings.nicknamePrompt || "";
        form.throwbackPrompt.value = settings.throwbackPrompt || "";
        form.summaryPrompt.value = settings.summaryPrompt || "";
        form.characterPrompt.value = settings.characterPrompt || "";
        form.includeBotMessages.checked = settings.includeBotMessages;
        form.opencodeZenBaseUrl.value = settings.opencodeZenBaseUrl || "";
        form.nvidiaNimBaseUrl.value = settings.nvidiaNimBaseUrl || "";
        form.openrouterBaseUrl.value = settings.openrouterBaseUrl || "";
        form.bynaraBaseUrl.value = settings.bynaraBaseUrl || "";
        document.querySelector("#geminiKeyHint").textContent = settings.hasGeminiApiKey ? "저장됨" : "비어 있음";
        document.querySelector("#opencodeKeyHint").textContent = settings.hasOpencodeZenApiKey ? "저장됨" : "비어 있음";
        document.querySelector("#nvidiaKeyHint").textContent = settings.hasNvidiaNimApiKey ? "저장됨" : "비어 있음";
        document.querySelector("#openrouterKeyHint").textContent = settings.hasOpenrouterApiKey ? "저장됨" : "비어 있음";
        document.querySelector("#bynaraKeyHint").textContent = settings.hasBynaraApiKey ? "저장됨" : "비어 있음";
        statusEl.textContent = "Ready";
      }

      form.aiProvider.addEventListener("change", () => {
        renderModelCards(form.aiProvider.value, form.aiModel.value);
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        saveState.textContent = "Saving";
        const payload = {
          aiProvider: form.aiProvider.value,
          aiModel: form.aiModel.value,
          commonPrompt: form.commonPrompt.value,
          questionPrompt: form.questionPrompt.value,
          mbtiPrompt: form.mbtiPrompt.value,
          duelPrompt: form.duelPrompt.value,
          rankPrompt: form.rankPrompt.value,
          psychoPrompt: form.psychoPrompt.value,
          nicknamePrompt: form.nicknamePrompt.value,
          throwbackPrompt: form.throwbackPrompt.value,
          summaryPrompt: form.summaryPrompt.value,
          characterPrompt: form.characterPrompt.value,
          historyMessageLimit: Number(form.historyMessageLimit.value),
          maxContextChars: Number(form.maxContextChars.value),
          includeBotMessages: form.includeBotMessages.checked,
          geminiApiKey: form.geminiApiKey.value,
          opencodeZenApiKey: form.opencodeZenApiKey.value,
          opencodeZenBaseUrl: form.opencodeZenBaseUrl.value,
          nvidiaNimApiKey: form.nvidiaNimApiKey.value,
          nvidiaNimBaseUrl: form.nvidiaNimBaseUrl.value,
          openrouterApiKey: form.openrouterApiKey.value,
          openrouterBaseUrl: form.openrouterBaseUrl.value,
          bynaraApiKey: form.bynaraApiKey.value,
          bynaraBaseUrl: form.bynaraBaseUrl.value
        };
        const response = await fetch("/api/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          saveState.textContent = "Save failed";
          return;
        }
        form.geminiApiKey.value = "";
        form.opencodeZenApiKey.value = "";
        form.nvidiaNimApiKey.value = "";
        form.openrouterApiKey.value = "";
        form.bynaraApiKey.value = "";
        await loadSettings();
        saveState.textContent = "Saved";
        saveState.className = "hint saved";
        setTimeout(() => {
          saveState.textContent = "";
          saveState.className = "hint";
        }, 1800);
      });

      loadSettings().catch(() => {
        statusEl.textContent = "Load failed";
      });
    </script>
  </body>
</html>`;
