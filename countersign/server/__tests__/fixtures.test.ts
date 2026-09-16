import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { buildForumFixture, type ForumSource } from "../../../portal/import-forum.js";

const fixtureText = readFileSync(new URL("../../../portal/data/forum.json", import.meta.url), "utf8");
const forum = JSON.parse(fixtureText) as ReturnType<typeof buildForumFixture>;
const students = JSON.parse(readFileSync(new URL("../../../portal/data/students.json", import.meta.url), "utf8")) as Array<{
  id: string; name: string; email: string; ssn: string; dod_id: string; medical_note: string;
}>;

test("IFD 2 fixture retains the whole thread and leaves the eleventh learner unposted", () => {
  assert.equal(forum.posts.length, 31);
  assert.equal(forum.roster.length, 12);
  assert.equal(new Set(forum.roster.map((member) => member.user_id)).size, 12);
  assert.equal(forum.source_dataset.synthetic, true);
  assert.equal(forum.source_dataset.discussion_model, "independent_first");
  assert.equal(forum.posts.filter((post) => post.role === "student").length, 29);
  assert.equal(forum.posts.filter((post) => post.role === "instructor").length, 2);
  assert.equal(forum.posts.filter((post) => post.classification === "short").length, 2);
  assert.equal(forum.posts.reduce((sum, post) => sum + post.word_count, 0), 5724);

  const byId = new Map(forum.posts.map((post) => [post.post_id, post]));
  assert.equal(byId.size, 31);
  const root = byId.get(forum.faculty_prompt_post_id)!;
  assert.equal(root.post_id, "2-000");
  assert.equal(root.user_id, "fac-0001");
  assert.equal(root.parent_id, null);
  assert.equal(root.depth, 0);
  assert.equal(forum.faculty_prompt, root.body);
  assert.match(root.body, /post before you read/);
  assert.equal(byId.get("2-022")?.user_id, "fac-0001", "faculty follow-up is retained");
  for (const post of forum.posts) {
    assert.equal(post.ifd, 2);
    assert.ok(!Object.hasOwn(post, "provenance"), "historical posts have no claimed presence proof");
    assert.notEqual(post.user_id, "stu-0011");
    assert.equal(forum.roster.find((member) => member.user_id === post.user_id)?.name, post.author);
    if (post === root) continue;
    const parent = byId.get(post.parent_id!);
    assert.ok(parent, `parent exists for ${post.post_id}`);
    assert.equal(post.depth, parent.depth + 1);
  }
  const initials = forum.posts.filter((post) => post.role === "student" && post.parent_id === root.post_id);
  assert.equal(initials.length, 10);
  assert.equal(new Set(initials.map((post) => post.user_id)).size, 10);
  assert.equal(forum.roster.find((member) => member.user_id === "stu-0011")?.tier, "-");
  assert.match(forum.synthetic_data_notice, /SYNTHETIC - AI GENERATED\. SYNTHETIC DATA NOTICE\./);
  assert.match(forum.synthetic_data_notice, /All names, ranks, units, and posts are invented\./);
  assert.match(forum.synthetic_data_notice, /Operational anecdotes are illustrative fiction\./);
  assert.match(forum.synthetic_data_notice, /must not be used or represented as one\.$/);
});

test("selectable peers match imported authors while the demo identity and fabricated records remain intact", () => {
  assert.deepEqual(students.map((student) => student.id), ["stu-0003", "stu-0006", "stu-0009", "stu-0011"]);
  for (const student of students) {
    assert.equal(student.name, forum.roster.find((member) => member.user_id === student.id)?.name);
    assert.match(student.email, /@example\.invalid$/);
    assert.match(student.ssn, /^900-\d{2}-\d{4}$/);
    assert.match(student.dod_id, /^\d{10}$/);
    assert.match(student.medical_note, /^Fabricated note:/);
    assert.equal(forum.posts.some((post) => post.user_id === student.id), student.id !== "stu-0011");
  }
  assert.deepEqual(students.map(({ id, ssn, dod_id, medical_note }) => ({ id, ssn, dod_id, medical_note })), [
    { id: "stu-0003", ssn: "900-12-3403", dod_id: "7301946285", medical_note: "Fabricated note: temporary light-duty restriction through the end of the month." },
    { id: "stu-0006", ssn: "900-12-3406", dod_id: "4817205936", medical_note: "Fabricated note: cleared for normal training with a routine follow-up." },
    { id: "stu-0009", ssn: "900-12-3409", dod_id: "6259031748", medical_note: "Fabricated note: no current duty limitations." },
    { id: "stu-0011", ssn: "900-12-3411", dod_id: "1948267305", medical_note: "Fabricated note: limited running for fourteen days following a routine evaluation." },
  ]);
  assert.equal(students[3].name, "Capt J. Demo");
  assert.equal(students[3].email, "j.demo@example.invalid");
});

test("quiz contains five four-choice questions with citations to the selected coursebook reading", () => {
  const quiz = JSON.parse(readFileSync(new URL("../../../portal/data/quiz.json", import.meta.url), "utf8")) as {
    id: string; notice: string; questions: Array<{ id: string; prompt: string; options: Record<string, string>; source_ref: string }>;
  };
  assert.equal(quiz.id, "1");
  assert.deepEqual(quiz.questions.map((question) => question.id), ["q1", "q2", "q3", "q4", "q5"]);
  assert.doesNotMatch(quiz.notice, /pending|placeholder|scaffold/i);
  const pages = ["5", "6", "13", "15–16", "18"];
  for (const [index, question] of quiz.questions.entries()) {
    assert.deepEqual(Object.keys(question.options), ["a", "b", "c", "d"]);
    assert.equal(new Set(Object.values(question.options)).size, 4);
    assert.ok(question.prompt.trim() && Object.values(question.options).every((option) => option.trim()));
    assert.match(question.source_ref, /AY27 8670 Prerequisite Coursebook — Lesson 2 Reading: Fundamentals of National Defense, §/);
    assert.ok(question.source_ref.endsWith(`${pages[index]} of 220.`));
  }
});

// Exercise the importer without requiring the ignored source files in a checkout.
function sourceFixture(): ForumSource {
  return {
    dataset: structuredClone(forum.source_dataset),
    course: structuredClone(forum.course),
    roster: forum.roster.filter((member) => member.user_id !== "stu-0011")
      .map(({ user_id, name, ...member }) => structuredClone(member)),
    posts: forum.posts.map(({ user_id, ...post }) => structuredClone(post)),
  };
}

test("import preserves source fields and order, filters IFD 1, and assigns identities independently of roster order", () => {
  const source = sourceFixture();
  source.roster.reverse();
  source.roster[0].extra_source_field = { retained: true };
  source.posts[1].body = "  Synthetic preservation check: <angle brackets>, apostrophe's, and Unicode — unchanged.\n\nSecond paragraph.  ";
  source.posts[1].char_count = source.posts[1].body.length;
  source.posts[1].extra_source_field = ["retained"];
  source.posts.unshift({ ...source.posts[0], ifd: 1, post_id: "1-000" });
  const before = structuredClone(source);
  const imported = buildForumFixture(source);
  assert.deepEqual(source, before, "import must not mutate its source");
  assert.deepEqual(imported.posts.map(({ user_id, ...post }) => post), source.posts.filter((post) => post.ifd === 2));
  assert.deepEqual(imported.roster.slice(0, 11).map(({ user_id, name, ...member }) => member), source.roster);
  assert.deepEqual(imported.source_dataset, source.dataset);
  assert.deepEqual(imported.course, source.course);
  assert.deepEqual(Object.fromEntries(imported.roster.map((member) => [member.handle, member.user_id])), {
    "D. Whitfield": "stu-0001", "E. Vasquez-Ruiz": "stu-0002", "P. Raghunathan": "stu-0003",
    "M. Boone": "stu-0004", "T. Okafor": "stu-0005", "S. Lindquist": "stu-0006",
    "K. Nakamura": "stu-0007", "R. Deleon": "stu-0008", "A. Pierce": "stu-0009",
    "A. Mills": "stu-0010", "J. Halloran": "fac-0001", "J. Demo": "stu-0011",
  });
  for (const post of imported.posts) {
    assert.equal(post.user_id, imported.roster.find((member) => member.name === post.author)?.user_id);
  }
});

test("import rejects incomplete threads, unknown authors, non-synthetic input, and claimed provenance", () => {
  for (const [mutate, message] of [
    [(source: ForumSource) => { source.posts.pop(); }, /all 30 discussion posts/],
    [(source: ForumSource) => { source.posts[1].parent_id = "1-000"; }, /Missing IFD 2 parent/],
    [(source: ForumSource) => { source.posts[1].author = "Unknown synthetic learner"; }, /Unknown source author/],
    [(source: ForumSource) => { source.dataset.synthetic = false; }, /synthetic Seminar 12/],
    [(source: ForumSource) => { source.posts[1].provenance = { actor_class: "human-verified" }; }, /must not contain submission provenance/],
  ] as const) {
    const source = sourceFixture();
    mutate(source);
    assert.throws(() => buildForumFixture(source), message);
  }
});

const originalSource = new URL("../../../data/source/8801-seminar12-synthetic-forum-dataset/8801-seminar12-synthetic-forum-dataset.json", import.meta.url);
test("supplied source reproduces the forum fixture byte for byte", {
  skip: !existsSync(originalSource) && "Original source is intentionally gitignored.",
}, () => {
  const source = JSON.parse(readFileSync(originalSource, "utf8")) as ForumSource;
  assert.equal(`${JSON.stringify(buildForumFixture(source), null, 2)}\n`, fixtureText);
});
