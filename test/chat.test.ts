import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_HISTORY_CHARS, buildConversation } from "../src/chat/context.js";
import { ChannelHistory, type HistoryEntry } from "../src/chat/history.js";
import { loadInstructions } from "../src/chat/instructions.js";
import {
  MemoryStore,
  cleanMemoryText,
  extractMemories,
  formatMemoryNotice,
} from "../src/chat/memory.js";
import { OpenRouterClient, isFreeModel, isReasoningEffort } from "../src/chat/router.js";
import { WEB_SEARCH_TOOL, createWebSearchTool, searchWeb } from "../src/chat/websearch.js";
import { MAX_MEMORY_CHARS, buildSystemPrompt, formatMemoryForPrompt } from "../src/chat/prompt.js";
import { detectTrigger } from "../src/chat/triggers.js";

const BOT_ID = "123456789012345678";
const PREFIX = "기니봇아";

function entry(index: number): HistoryEntry {
  return {
    id: `m${index}`,
    authorId: "u1",
    author: "민지",
    content: `메시지 ${index}`,
    fromBot: false,
  };
}

async function readEntries(store: MemoryStore): Promise<string[]> {
  const text = await store.read();
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^- /, ""));
}

describe("detectTrigger", () => {
  test("접두사 뒤 문장만 남긴다", () => {
    expect(
      detectTrigger(
        { content: "기니봇아 오늘 뭐 먹지?", botId: BOT_ID, mentionedBot: false, repliedToBot: false },
        PREFIX,
      ),
    ).toEqual({ kind: "prefix", text: "오늘 뭐 먹지?" });
  });

  test("접두사에 붙은 구두점도 처리한다", () => {
    expect(
      detectTrigger(
        { content: "기니봇아! 안녕", botId: BOT_ID, mentionedBot: false, repliedToBot: false },
        PREFIX,
      ),
    ).toEqual({ kind: "prefix", text: "안녕" });
  });

  test("접두사만 있으면 빈 텍스트", () => {
    expect(
      detectTrigger(
        { content: "기니봇아", botId: BOT_ID, mentionedBot: false, repliedToBot: false },
        PREFIX,
      ),
    ).toEqual({ kind: "prefix", text: "" });
  });

  test("접두사로 시작하는 다른 단어는 무시한다", () => {
    expect(
      detectTrigger(
        { content: "기니봇아님 저쪽이에요", botId: BOT_ID, mentionedBot: false, repliedToBot: false },
        PREFIX,
      ),
    ).toBeNull();
  });

  test("멘션은 멘션 토큰을 지운다", () => {
    expect(
      detectTrigger(
        { content: `<@${BOT_ID}> 안녕`, botId: BOT_ID, mentionedBot: true, repliedToBot: false },
        PREFIX,
      ),
    ).toEqual({ kind: "mention", text: "안녕" });
  });

  test("멘션과 접두사가 같이 와도 한 번만 처리한다", () => {
    expect(
      detectTrigger(
        { content: `<@${BOT_ID}> 기니봇아 뭐해`, botId: BOT_ID, mentionedBot: true, repliedToBot: false },
        PREFIX,
      ),
    ).toEqual({ kind: "mention", text: "뭐해" });
  });

  test("봇 메시지에 답장하면 reply 트리거", () => {
    expect(
      detectTrigger(
        { content: "이거 뭐야?", botId: BOT_ID, mentionedBot: false, repliedToBot: true },
        PREFIX,
      ),
    ).toEqual({ kind: "reply", text: "이거 뭐야?" });
  });

  test("관계없는 메시지는 null", () => {
    expect(
      detectTrigger(
        { content: "그냥 잡담", botId: BOT_ID, mentionedBot: false, repliedToBot: false },
        PREFIX,
      ),
    ).toBeNull();
  });
});

describe("extractMemories", () => {
  test("태그를 분리하고 답변만 남긴다", () => {
    const result = extractMemories("좋아, 기억할게!\n<memory>민지는 커피를 좋아함</memory>");
    expect(result.reply).toBe("좋아, 기억할게!");
    expect(result.memories).toEqual(["민지는 커피를 좋아함"]);
  });

  test("태그가 없으면 답변만 둔다", () => {
    const result = extractMemories("오늘 날씨 좋다!");
    expect(result.reply).toBe("오늘 날씨 좋다!");
    expect(result.memories).toEqual([]);
  });

  test("닫히지 않은 태그도 주워 담는다", () => {
    const result = extractMemories("알겠어!\n<memory>민지는 고양이 두 마리를 키움");
    expect(result.reply).toBe("알겠어!");
    expect(result.memories).toEqual(["민지는 고양이 두 마리를 키움"]);
  });

  test("중복 태그는 한 번만 저장한다", () => {
    const result = extractMemories("<memory>같은 내용</memory><memory>같은 내용</memory>");
    expect(result.memories).toEqual(["같은 내용"]);
  });

  test("수정·삭제 태그를 분리하고 답변만 남긴다", () => {
    const result = extractMemories(
      "알겠어, 그렇게 해둘게.\n<memory-edit>기니는 21살이다. => 기니는 20살이다.</memory-edit>\n<memory-delete>기니는 부산에 산다.</memory-delete>",
    );
    expect(result.reply).toBe("알겠어, 그렇게 해둘게.");
    expect(result.edits).toEqual([{ from: "기니는 21살이다.", to: "기니는 20살이다." }]);
    expect(result.removals).toEqual(["기니는 부산에 산다."]);
  });

  test("수정 태그의 화살표 표기를 모두 받는다", () => {
    expect(extractMemories("<memory-edit>옛 기억 -> 새 기억</memory-edit>").edits).toEqual([
      { from: "옛 기억", to: "새 기억" },
    ]);
    expect(extractMemories("<memory-edit>옛 기억 → 새 기억</memory-edit>").edits).toEqual([
      { from: "옛 기억", to: "새 기억" },
    ]);
    expect(extractMemories("<memory-edit>옛 기억 | 새 기억</memory-edit>").edits).toEqual([
      { from: "옛 기억", to: "새 기억" },
    ]);
  });
});

describe("cleanMemoryText", () => {
  test("기억에서 아이디를 지우고 표시 이름만 남긴다", () => {
    expect(cleanMemoryText("기니(@giinii06)는 21살이다.")).toBe("기니는 21살이다.");
    expect(cleanMemoryText("기니 (@giinii06)는 부산에 산다.")).toBe("기니는 부산에 산다.");
    expect(cleanMemoryText("<@123456789> 민지는 커피를 좋아한다.")).toBe(
      "민지는 커피를 좋아한다.",
    );
    expect(cleanMemoryText("기니 @giinii06")).toBe("기니");
    expect(cleanMemoryText("기니는 21살이다.")).toBe("기니는 21살이다.");
  });
});

describe("ChannelHistory", () => {
  test("채널별로 최근 10개만 유지한다", () => {
    const history = new ChannelHistory(10);
    for (let index = 0; index < 12; index += 1) {
      history.record("c1", entry(index));
    }

    const recent = history.recent("c1");
    expect(recent).toHaveLength(10);
    expect(recent[0]?.id).toBe("m2");
    expect(recent.at(-1)?.id).toBe("m11");
  });

  test("현재 트리거 메시지는 문맥에서 뺀다", () => {
    const history = new ChannelHistory(10);
    history.record("c1", entry(1));
    history.record("c1", entry(2));

    expect(history.recent("c1", { excludeId: "m2" }).map((item) => item.id)).toEqual(["m1"]);
  });

  test("채널이 다르면 섞이지 않는다", () => {
    const history = new ChannelHistory(10);
    history.record("c1", entry(1));
    history.record("c2", entry(2));

    expect(history.recent("c1")).toHaveLength(1);
    expect(history.recent("c2").map((item) => item.id)).toEqual(["m2"]);
  });
});

describe("buildConversation", () => {
  test("마지막 질문에 질문자 이름을 명시한다", () => {
    const messages = buildConversation(
      [
        { id: "m1", authorId: "u1", author: "민지 (@minji)", content: "안녕", fromBot: false },
        { id: "m2", authorId: "bot", author: "기니봇", content: "안녕!", fromBot: true },
      ],
      { speaker: "준호 (@junho)", text: "오늘 뭐 먹지?" },
    );

    expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(messages.at(-1)?.content).toBe("[질문자: 준호 (@junho)]\n오늘 뭐 먹지?");
  });

  test("연속된 사용자 메시지는 합치고 질문자 표시는 남긴다", () => {
    const messages = buildConversation(
      [
        { id: "m1", authorId: "u1", author: "민지 (@minji)", content: "첫 말", fromBot: false },
        { id: "m2", authorId: "u1", author: "민지 (@minji)", content: "두 번째 말", fromBot: false },
      ],
      { speaker: "민지 (@minji)", text: "세 번째 말" },
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.content).toContain("민지 (@minji): 첫 말\n민지 (@minji): 두 번째 말");
    expect(messages[0]?.content).toContain("[질문자: 민지 (@minji)]\n세 번째 말");
  });

  test("긴 대화 기록은 예산만큼만 문맥에 넣는다", () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      id: `m${index}`,
      authorId: "u1",
      author: "민지 (@minji)",
      content: `메시지 ${index} ${"가".repeat(400)}`,
      fromBot: false,
    }));

    const messages = buildConversation(entries, { speaker: "준호 (@junho)", text: "질문" });
    const total = messages.reduce((sum, message) => sum + message.content.length, 0);

    expect(total).toBeLessThanOrEqual(MAX_HISTORY_CHARS + 100);
    expect(messages.at(-1)?.content).toContain("질문");
  });
});

describe("MemoryStore", () => {
  test("추가한 기억을 파일에서 다시 읽는다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "giny-bot-"));
    const store = new MemoryStore(join(dir, "nested", "memory.md"));

    try {
      await store.init();
      const first = await store.add(["민지는 부산에 산다"]);
      expect(first).toEqual(["민지는 부산에 산다"]);

      const second = await store.add(["민지는 부산에 산다", "민지는 고양이를 키운다"]);
      expect(second).toEqual(["민지는 고양이를 키운다"]);

      const text = await store.read();
      expect(text.match(/부산에 산다/g)).toHaveLength(1);
      expect(text).toContain("고양이를 키운다");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("저장할 때 날짜를 붙이지 않는다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "giny-bot-date-"));
    const store = new MemoryStore(join(dir, "memory.md"));

    try {
      await store.init();
      await store.add(["기니는 21살이다."]);
      const text = await store.read();
      expect(text).toBe("- 기니는 21살이다.");
      expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("저장할 때 아이디를 지운다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "giny-bot-id-"));
    const store = new MemoryStore(join(dir, "memory.md"));

    try {
      await store.init();
      const saved = await store.add(["기니(@giinii06)는 21살이다."]);
      expect(saved).toEqual(["기니는 21살이다."]);
      expect(await store.read()).not.toContain("@giinii06");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("자연어 기억 반영", () => {
  test("문장으로 찾아 수정·삭제하고 추가까지 한 번에 반영한다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "giny-bot-natural-"));
    const store = new MemoryStore(join(dir, "memory.md"));

    try {
      await store.init();
      await store.add(["기니는 21살이다.", "기니는 부산에 산다."]);

      const batch = await store.apply({
        add: ["기니는 고양이를 키운다."],
        edits: [{ from: "기니는 21살이다", to: "기니는 20살이다." }],
        remove: ["기니는 부산에 산다"],
      });

      expect(batch.updated).toEqual([{ from: "기니는 21살이다.", entry: "기니는 20살이다." }]);
      expect(batch.removed).toEqual(["기니는 부산에 산다."]);
      expect(batch.added).toEqual(["기니는 고양이를 키운다."]);
      expect(await readEntries(store)).toEqual(["기니는 20살이다.", "기니는 고양이를 키운다."]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("기억을 전부 지우는 요청은 막는다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "giny-bot-clear-"));
    const store = new MemoryStore(join(dir, "memory.md"));

    try {
      await store.init();
      await store.add(["기니는 21살이다.", "기니는 부산에 산다."]);

      const batch = await store.apply({
        add: [],
        edits: [],
        remove: ["기니는 21살이다.", "기니는 부산에 산다."],
      });

      expect(batch.blockedClearAll).toBe(true);
      expect(batch.removed).toEqual([]);
      expect(await readEntries(store)).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("비슷한 기억이 여러 개여도 묻지 않고 가장 잘 맞는 것을 처리한다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "giny-bot-closest-"));
    const store = new MemoryStore(join(dir, "memory.md"));

    try {
      await store.init();
      await store.add(["기니는 부산에 산다.", "기니는 부산에 간다."]);

      const batch = await store.apply({
        add: [],
        edits: [{ from: "부산에 간다", to: "기니는 대구에 간다." }],
        remove: ["부산에 산다"],
      });

      expect(batch.rejected).toEqual([]);
      expect(batch.updated).toEqual([
        { from: "기니는 부산에 간다.", entry: "기니는 대구에 간다." },
      ]);
      expect(batch.removed).toEqual(["기니는 부산에 산다."]);
      expect(await readEntries(store)).toEqual(["기니는 대구에 간다."]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("formatMemoryNotice", () => {
  test("저장만 있으면 저장 안내만 보낸다", () => {
    expect(
      formatMemoryNotice({
        added: ["기니는 설하에게 적당히 짓궂게 굴기로 했다."],
        updated: [],
        removed: [],
        rejected: [],
        blockedClearAll: false,
      }),
    ).toBe("🧠 기억됨:\n> 기니는 설하에게 적당히 짓궂게 굴기로 했다.");
  });

  test("수정만 있으면 수정 안내만 보낸다", () => {
    expect(
      formatMemoryNotice({
        added: [],
        updated: [{ from: "기니는 21살이다.", entry: "기니는 20살이다." }],
        removed: [],
        rejected: [],
        blockedClearAll: false,
      }),
    ).toBe("✏️ 수정됨:\n> 기니는 20살이다.");
  });

  test("삭제만 있으면 삭제 안내만 보낸다", () => {
    expect(
      formatMemoryNotice({
        added: [],
        updated: [],
        removed: ["기니는 부산에 산다."],
        rejected: [],
        blockedClearAll: false,
      }),
    ).toBe("🗑️ 삭제됨:\n> 기니는 부산에 산다.");
  });

  test("여러 종류가 섞이면 한 번에 정리해 알려준다", () => {
    expect(
      formatMemoryNotice({
        added: ["기니는 고양이를 키운다."],
        updated: [{ from: "기니는 21살이다.", entry: "기니는 20살이다." }],
        removed: ["기니는 부산에 산다."],
        rejected: [],
        blockedClearAll: false,
      }),
    ).toBe(
      "🧠 기억 정리됨:\n🗑️ 지움: 기니는 부산에 산다.\n✏️ 수정: 기니는 20살이다.\n🧠 저장: 기니는 고양이를 키운다.",
    );
  });
});

describe("buildSystemPrompt", () => {
  test("AGENTS.md 지침과 기억, 태그 규칙을 함께 넣는다", () => {
    const prompt = buildSystemPrompt({
      instructions: "- 이름은 기니봇\n- 반말로 짧게 답한다",
      memory: "- 민지는 커피를 좋아함",
    });
    expect(prompt).toContain("이름은 기니봇");
    expect(prompt).toContain("반말로 짧게 답한다");
    expect(prompt).toContain("민지는 커피를 좋아함");
    expect(prompt).toContain("<memory>한 줄 요약</memory>");
  });

  test("기억을 사실형으로 쓰라는 규칙을 넣는다", () => {
    const prompt = buildSystemPrompt({ instructions: "지침", memory: "" });
    expect(prompt).toContain("사실 자체로");
    expect(prompt).toContain("설하는 공주병이 심하다");
    expect(prompt).toContain("전달 표현을 쓰지 않는다");
  });

  test("지침이 비면 기본 지침을 쓰고 기억 없음 문구를 넣는다", () => {
    const prompt = buildSystemPrompt({ instructions: "  ", memory: "" });
    expect(prompt).toContain("기니봇");
    expect(prompt).toContain("(아직 없음)");
  });
});

describe("프롬프트 토큰 예산", () => {
  test("기억은 예산 안에서 최신 줄만 남기고 번호를 유지한다", () => {
    const memory = Array.from(
      { length: 80 },
      (_, index) => `- 기억 ${index + 1} ${"가".repeat(20)}`,
    ).join("\n");

    const formatted = formatMemoryForPrompt(memory);

    expect(formatted.length).toBeLessThanOrEqual(MAX_MEMORY_CHARS + 40);
    expect(formatted).toContain("생략");
    expect(formatted).toContain("80.");
  });
});

describe("loadInstructions", () => {
  test("AGENTS.md 내용을 읽는다", async () => {
    const dir = await mkdtemp(join(tmpdir(), "giny-agents-"));
    try {
      const path = join(dir, "AGENTS.md");
      await writeFile(path, "# 지침\n친절하게 짧게 답한다.\n", "utf8");
      const loaded = await loadInstructions(path);
      expect(loaded.source).toBe("file");
      expect(loaded.text).toContain("친절하게 짧게 답한다");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("파일이 없으면 기본 지침으로 답한다", async () => {
    const loaded = await loadInstructions("does-not-exist/AGENTS.md");
    expect(loaded.source).toBe("fallback");
    expect(loaded.text).toContain("기니봇");
  });
});

describe("reasoning", () => {
  test("추론 정도를 바꾼다", () => {
    const client = new OpenRouterClient("sk-test", "deepseek/deepseek-v4.1-flash-1017");
    expect(client.reasoningEffort).toBe("high");

    client.setReasoningEffort("low");
    expect(client.reasoningEffort).toBe("low");
  });

  test("요청 본문에 추론 정도를 넣는다", async () => {
    const originalFetch = globalThis.fetch;
    let body: { model?: string; reasoning?: { effort?: string } } | undefined;

    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      body = JSON.parse(String(args[1]?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const client = new OpenRouterClient("sk-test", "deepseek/deepseek-v4.1-flash-1017");
      client.setReasoningEffort("low");
      const reply = await client.complete([{ role: "user", content: "hi" }], {
        maxTokens: 100,
        timeoutMs: 1000,
      });

      expect(reply).toBe("ok");
      expect(body?.model).toBe("deepseek/deepseek-v4.1-flash-1017");
      expect(body?.reasoning).toEqual({ effort: "low" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("지원하는 값만 통과시킨다", () => {
    expect(isReasoningEffort("none")).toBe(true);
    expect(isReasoningEffort("medium")).toBe(true);
    expect(isReasoningEffort("turbo")).toBe(false);
  });
});

describe("isFreeModel", () => {
  test(":free 로 끝나는 OpenRouter 모델은 무료", () => {
    expect(isFreeModel("deepseek/deepseek-v4-flash:free")).toBe(true);
  });

  test("가격이 0으로 내려오면 무료", () => {
    expect(isFreeModel("some/model", { prompt: "0", completion: "0.000000" })).toBe(true);
  });

  test("유료 모델은 false", () => {
    expect(
      isFreeModel("deepseek/deepseek-v4.1-flash-1017", {
        prompt: "0.0000003",
        completion: "0.0000012",
      }),
    ).toBe(false);
    expect(isFreeModel("deepseek/deepseek-v4.1-flash-1017")).toBe(false);
  });
});

describe("웹 검색", () => {
  test("Exa 응답을 3개 결과와 짧은 발췌로 줄인다", async () => {
    const originalFetch = globalThis.fetch;
    let request: { url?: string; headers?: Headers; body?: Record<string, unknown> } = {};

    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      request = {
        url: String(input),
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      };
      return new Response(
        JSON.stringify({
          results: [
            { title: "첫 결과", url: "https://example.com/a", highlights: ["가".repeat(500)] },
            { url: "https://example.com/b", text: "본문 요약" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const hits = await searchWeb("테스트 검색", "exa-key");

      expect(request.url).toBe("https://api.exa.ai/search");
      expect(request.headers?.get("x-api-key")).toBe("exa-key");
      expect(request.body?.numResults).toBe(3);
      expect(hits).toHaveLength(2);
      expect(hits[0]?.snippet).toHaveLength(400);
      expect(hits[1]?.title).toBe("https://example.com/b");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("툴 호출을 실행하고 결과를 넣어 다시 묻는다", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<Record<string, unknown>> = [];
    let calls = 0;
    let toolArguments = "";

    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      const [, init] = args;
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      calls += 1;

      if (calls === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "web_search", arguments: "{\"query\":\"오늘 날씨\"}" },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({ choices: [{ message: { content: "맑음" } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    try {
      const client = new OpenRouterClient("sk-test", "test/model");
      const answer = await client.completeWithTools(
        [{ role: "user", content: "날씨 알려줘" }],
        { maxTokens: 100, timeoutMs: 1000 },
        [WEB_SEARCH_TOOL],
        async (call) => {
          toolArguments = call.function.arguments;
          return JSON.stringify({ results: [] });
        },
      );

      expect(answer).toBe("맑음");
      expect(toolArguments).toBe("{\"query\":\"오늘 날씨\"}");
      expect((requests[0]?.tools as Array<{ function: { name: string } }>)[0]?.function.name).toBe(
        "web_search",
      );
      expect((requests[1]?.messages as Array<Record<string, unknown>>).at(-1)).toEqual({
        role: "tool",
        tool_call_id: "call_1",
        content: "{\"results\":[]}",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("한 턴에 검색은 두 번까지 실행한다", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 })) as unknown as typeof fetch;

    try {
      const tool = createWebSearchTool("exa-key");
      const call = {
        id: "call_1",
        type: "function" as const,
        function: { name: "web_search", arguments: "{\"query\":\"테스트\"}" },
      };

      expect(await tool.run(call)).toContain("results");
      expect(await tool.run(call)).toContain("results");
      expect(await tool.run(call)).toContain("limit");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
