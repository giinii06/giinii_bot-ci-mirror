# Taste

## Communication
- Writes prompts in Korean (casual, terse, pastes raw terminal output as the question); reply in Korean. Confidence: 0.8
- Frames asks as "can't we just make it do X automatically?" — prefers a one-command/automated fix over manual step-by-step instructions. Confidence: 0.6

## Workflow & tooling
- Uses a `git acp` alias for the add → commit → push cycle; assume shell/git alias habits and run/inspect commands rather than asking the user to type them. Confidence: 0.6
- Project scripts are TypeScript run via `bun run scripts/<name>.ts` (also keeps large binaries split under a size cap, with originals in .gitignore). Confidence: 0.5
