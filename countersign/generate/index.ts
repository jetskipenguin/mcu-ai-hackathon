import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const paths = {
  students: resolve(root, "portal/data/students.json"),
  quiz: resolve(root, "portal/data/quiz.json"),
  forum: resolve(root, "portal/data/forum.json"),
  active: resolve(root, "countersign/policy/countersign.policy.json"),
  draft: resolve(root, "countersign/policy/countersign.policy.draft.json"),
};

export function buildPrompt(fixtures: {
  students: unknown;
  quiz: unknown;
  forum: unknown;
}): string {
  return [
    "Draft a Countersign policy for the supplied portal fixtures.",
    "Return JSON matching docs/contracts.md section 2.",
    "Use only marking identifiers supplied by the Registry vocabulary.",
    JSON.stringify(fixtures, null, 2),
  ].join("\n\n");
}

async function main(): Promise<void> {
  const [studentsRaw, quizRaw, forumRaw, activeRaw] = await Promise.all([
    readFile(paths.students, "utf8"),
    readFile(paths.quiz, "utf8"),
    readFile(paths.forum, "utf8"),
    readFile(paths.active, "utf8"),
  ]);
  const prompt = buildPrompt({
    students: JSON.parse(studentsRaw) as unknown,
    quiz: JSON.parse(quizRaw) as unknown,
    forum: JSON.parse(forumRaw) as unknown,
  });
  void prompt;

  // TODO(track-b): call complete(prompt), validate its JSON, and attach citations.
  const active = JSON.parse(activeRaw) as unknown;
  await writeFile(paths.draft, `${JSON.stringify(active, null, 2)}\n`, "utf8");
  console.log(`Draft policy written to ${paths.draft}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
