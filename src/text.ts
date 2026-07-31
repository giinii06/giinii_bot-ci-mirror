export const splitForEmbeds = (text: string) => {
  const max = 1_800;
  const pages: string[] = [];
  let remaining = text;
  while (remaining.length > max) {
    const cutAt = Math.max(remaining.lastIndexOf("\n", max), remaining.lastIndexOf(" ", max), max);
    pages.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  pages.push(remaining || "응답이 비어 있습니다.");
  return pages;
};
