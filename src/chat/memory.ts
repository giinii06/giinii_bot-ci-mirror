import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const HEADER = [
  "# 기니봇 메모리",
  "",
  "대화에서 기억하기로 한 내용이 쌓입니다. 직접 고쳐도 됩니다.",
  ""
].join("\n");

export const MAX_MEMORY_ENTRY_LENGTH = 120;

export type MemoryEdit = {
  from: string;
  to: string;
};

export type ExtractedReply = {
  reply: string;
  memories: string[];
  edits: MemoryEdit[];
  removals: string[];
};

export type MemoryEntry = {
  index: number;
  text: string;
};

export type MemoryBatch = {
  added: string[];
  updated: { from: string; entry: string }[];
  removed: string[];
  rejected: {
    action: "edit" | "delete";
    target: string;
    reason: "not_found" | "empty" | "duplicate";
  }[];
  blockedClearAll: boolean;
};

const oneLine = (value: string) => value.trim().replace(/\s+/g, " ");

const normalize = (value: string) =>
  oneLine(value)
    .replace(/^[-*+]\s+/, "")
    .replace(/[.!?~。]+$/g, "")
    .toLowerCase();

export const cleanMemoryText = (value: string): string =>
  oneLine(
    oneLine(value)
      .replace(/<@!?\d+>/g, "")
      .replace(/\s*\(@[\w.]+\)/g, "")
      .replace(/(^|\s)@[\w.]+/g, "$1")
  );

const bodyOf = (raw: string) => (raw.startsWith(HEADER) ? raw.slice(HEADER.length) : raw);

const parseEntries = (body: string): MemoryEntry[] => {
  const lines = body.split(/\r?\n/);
  const entries: MemoryEntry[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const text = oneLine(trimmed.replace(/^[-*+]\s+/, ""));
    if (!text) return;
    entries.push({ index: entries.length + 1, text });
  });

  return entries;
};

const bigrams = (value: string): Set<string> => {
  const chars = [...value.replace(/\s+/g, "")];
  if (chars.length < 2) return new Set(chars);

  const grams = new Set<string>();
  for (let index = 0; index < chars.length - 1; index += 1) {
    grams.add(`${chars[index]}${chars[index + 1]}`);
  }
  return grams;
};

const similarity = (left: string, right: string): number => {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const overlap = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.75 + overlap * 0.24;
  }

  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  const total = aGrams.size + bGrams.size;
  if (total === 0) return 0;

  let shared = 0;
  for (const gram of aGrams) {
    if (bGrams.has(gram)) shared += 1;
  }
  return (2 * shared) / total;
};

const findBestMatch = (entries: MemoryEntry[], target: string): MemoryEntry | null => {
  const needle = normalize(target);
  if (!needle) return null;

  const exact = entries.find((entry) => normalize(entry.text) === needle);
  if (exact) return exact;

  let best: { entry: MemoryEntry; score: number } | null = null;
  for (const entry of entries) {
    const score = similarity(entry.text, target);
    if (!best || score > best.score) best = { entry, score };
  }

  return best && best.score >= 0.3 ? best.entry : null;
};

export const formatMemoryNotice = (batch: MemoryBatch): string | null => {
  const warnings: string[] = [];
  for (const item of batch.rejected) {
    const verb = item.action === "delete" ? "삭제 실패" : "수정 실패";
    if (item.reason === "not_found") {
      warnings.push(`⚠️ '${item.target}' 기억 없음.`);
    } else if (item.reason === "duplicate") {
      warnings.push(`⚠️ '${item.target}': 중복으로 ${verb}.`);
    } else {
      warnings.push(`⚠️ '${item.target}': 새 내용이 비어 있어 ${verb}.`);
    }
  }
  if (batch.blockedClearAll) {
    warnings.push("⚠️ 전체 삭제 불가. 하나씩 삭제해 주세요.");
  }

  const sections: string[] = [];
  const kinds = [batch.removed.length, batch.updated.length, batch.added.length].filter(
    (count) => count > 0
  ).length;

  if (kinds === 1) {
    if (batch.removed.length > 0) {
      sections.push(`🗑️ 삭제됨:\n${batch.removed.map((entry) => `> ${entry}`).join("\n")}`);
    } else if (batch.updated.length > 0) {
      sections.push(`✏️ 수정됨:\n${batch.updated.map((item) => `> ${item.entry}`).join("\n")}`);
    } else {
      sections.push(`🧠 기억됨:\n${batch.added.map((entry) => `> ${entry}`).join("\n")}`);
    }
  } else if (kinds > 1) {
    const lines: string[] = [];
    for (const entry of batch.removed) lines.push(`🗑️ 지움: ${entry}`);
    for (const item of batch.updated) lines.push(`✏️ 수정: ${item.entry}`);
    for (const entry of batch.added) lines.push(`🧠 저장: ${entry}`);
    sections.push(`🧠 기억 정리됨:\n${lines.join("\n")}`);
  }

  if (warnings.length > 0) sections.push(warnings.join("\n"));

  return sections.length > 0 ? sections.join("\n") : null;
};

const pullTag = (raw: string, tag: string): { rest: string; bodies: string[] } => {
  const bodies: string[] = [];
  const closed = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  let rest = raw.replace(closed, (_match, body: string) => {
    bodies.push(body);
    return "";
  });

  const openAt = rest.search(new RegExp(`<${tag}>`, "i"));
  if (openAt !== -1) {
    bodies.push(rest.slice(openAt + tag.length + 2));
    rest = rest.slice(0, openAt);
  }

  return { rest, bodies };
};

export const extractMemories = (raw: string): ExtractedReply => {
  const deleteTag = pullTag(raw, "memory-delete");
  const editTag = pullTag(deleteTag.rest, "memory-edit");
  const addTag = pullTag(editTag.rest, "memory");

  const memories: string[] = [];
  for (const body of addTag.bodies) {
    const value = oneLine(body);
    if (value) memories.push(value.slice(0, MAX_MEMORY_ENTRY_LENGTH));
  }

  const edits = new Map<string, MemoryEdit>();
  for (const body of editTag.bodies) {
    const match = body.match(/^\s*([\s\S]+?)\s*(?:=>|->|→|\|)\s*([\s\S]+)$/);
    if (!match) continue;
    const from = oneLine(match[1] ?? "").slice(0, MAX_MEMORY_ENTRY_LENGTH);
    const to = oneLine(match[2] ?? "").slice(0, MAX_MEMORY_ENTRY_LENGTH);
    if (from && to) edits.set(normalize(from), { from, to });
  }

  const removals = new Map<string, string>();
  for (const body of deleteTag.bodies) {
    const value = oneLine(body).slice(0, MAX_MEMORY_ENTRY_LENGTH);
    if (value) removals.set(normalize(value), value);
  }

  const reply = addTag.rest
    .replace(/<\/?memory(?:-edit|-delete)?>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    reply,
    memories: [...new Set(memories)],
    edits: [...edits.values()],
    removals: [...removals.values()]
  };
};

export class MemoryStore {
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    try {
      await readFile(this.path, "utf8");
    } catch {
      await writeFile(this.path, HEADER, "utf8");
    }
  }

  async read(): Promise<string> {
    try {
      return bodyOf(await readFile(this.path, "utf8")).trim();
    } catch {
      return "";
    }
  }

  async add(entries: string[]): Promise<string[]> {
    return this.enqueue(async () => {
      const current = await readFile(this.path, "utf8").catch(() => HEADER);
      const existing = new Set(parseEntries(bodyOf(current)).map((entry) => entry.text));
      const saved: string[] = [];
      const lines: string[] = [];

      for (const raw of entries) {
        const entry = cleanMemoryText(raw).slice(0, MAX_MEMORY_ENTRY_LENGTH);
        if (!entry) continue;
        if (existing.has(entry) || saved.includes(entry)) continue;
        saved.push(entry);
        lines.push(`- ${entry}`);
      }

      if (lines.length > 0) {
        const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
        await appendFile(this.path, `${prefix}${lines.join("\n")}\n`, "utf8");
      }

      return saved;
    });
  }

  async apply(changes: {
    add: string[];
    edits: MemoryEdit[];
    remove: string[];
  }): Promise<MemoryBatch> {
    return this.enqueue(async () => {
      const raw = await readFile(this.path, "utf8").catch(() => HEADER);
      const entries = parseEntries(bodyOf(raw));

      const rejected: MemoryBatch["rejected"] = [];
      const removed = new Map<number, MemoryEntry>();

      for (const target of changes.remove) {
        const match = findBestMatch(entries, target);
        if (!match) {
          rejected.push({ action: "delete", target, reason: "not_found" });
          continue;
        }
        removed.set(match.index, match);
      }

      let blockedClearAll = false;
      if (entries.length > 0 && removed.size >= entries.length) {
        blockedClearAll = true;
        removed.clear();
      }

      const acceptedEdits = new Map<number, { from: string; to: string }>();
      for (const edit of changes.edits) {
        const target = findBestMatch(entries, edit.from);
        if (!target) {
          rejected.push({ action: "edit", target: edit.from, reason: "not_found" });
          continue;
        }
        if (removed.has(target.index)) continue;

        const text = cleanMemoryText(edit.to).slice(0, MAX_MEMORY_ENTRY_LENGTH);
        if (!text) {
          rejected.push({ action: "edit", target: edit.from, reason: "empty" });
          continue;
        }

        const duplicate = entries.some(
          (entry) =>
            entry.index !== target.index &&
            !removed.has(entry.index) &&
            (acceptedEdits.get(entry.index)?.to ?? entry.text) === text
        );
        if (duplicate) {
          rejected.push({ action: "edit", target: edit.from, reason: "duplicate" });
          continue;
        }

        acceptedEdits.set(target.index, { from: target.text, to: text });
      }

      const finalEntries = entries
        .filter((entry) => !removed.has(entry.index))
        .map((entry) => acceptedEdits.get(entry.index)?.to ?? entry.text);

      const added: string[] = [];
      for (const rawEntry of changes.add) {
        const text = cleanMemoryText(rawEntry).slice(0, MAX_MEMORY_ENTRY_LENGTH);
        if (!text || finalEntries.includes(text) || added.includes(text)) continue;
        added.push(text);
        finalEntries.push(text);
      }

      if (removed.size > 0 || acceptedEdits.size > 0 || added.length > 0) {
        await this.writeEntries(finalEntries);
      }

      return {
        added,
        updated: [...acceptedEdits.values()].map(({ from, to }) => ({ from, entry: to })),
        removed: [...removed.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, entry]) => entry.text),
        rejected,
        blockedClearAll
      };
    });
  }

  private writeEntries(entries: string[]): Promise<void> {
    return this.writeBody(entries.map((entry) => `- ${entry}`));
  }

  private writeBody(lines: string[]): Promise<void> {
    const text = `${HEADER}${lines.join("\n")}`;
    return writeFile(this.path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(job);
    this.writeChain = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
