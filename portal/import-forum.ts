import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Usage: npx tsx portal/import-forum.ts <8801-seminar12-synthetic-forum-dataset.json>
// Writes only portal/data/forum.json; the original JSON/PDF stay in data/source/.

export interface ForumSource {
  dataset: { synthetic: boolean; discussion_model: string; [key: string]: unknown };
  course: Record<string, unknown>;
  roster: Array<{
    handle: string; rank: string; service: string; mos: string; tier: string;
    [key: string]: unknown;
  }>;
  posts: Array<{
    post_id: string; ifd: number; parent_id: string | null; depth: number;
    author: string; service: string; specialty: string; role: string; design_tier: string;
    timestamp: string; subject: string; body: string;
    word_count: number; char_count: number; classification: string;
    [key: string]: unknown;
  }>;
}

// These identities must not depend on roster order. The instructor must never
// take stu-0011, which is reserved for the learner who has not posted yet.
const userIds = new Map([
  ["D. Whitfield", "stu-0001"],
  ["E. Vasquez-Ruiz", "stu-0002"],
  ["P. Raghunathan", "stu-0003"],
  ["M. Boone", "stu-0004"],
  ["T. Okafor", "stu-0005"],
  ["S. Lindquist", "stu-0006"],
  ["K. Nakamura", "stu-0007"],
  ["R. Deleon", "stu-0008"],
  ["A. Pierce", "stu-0009"],
  ["A. Mills", "stu-0010"],
  ["J. Halloran", "fac-0001"],
]);

// The JSON supplies synthetic: true but no notice text. This is the complete
// notice paragraph from 8801-seminar12-synthetic-forum-dataset.pdf, page 1,
// prefixed with the portal's existing synthetic-data label.
const syntheticDataNotice = "SYNTHETIC - AI GENERATED. SYNTHETIC DATA NOTICE. " +
  "This document is a fabricated dataset generated for testing and demonstration of the Learning Intelligence Dashboard (LID) forum discussion analyzer. " +
  "All names, ranks, units, and posts are invented. " +
  "No content originates from a real learner, a real course offering, or a real institutional record. " +
  "Operational anecdotes are illustrative fiction. " +
  "This artifact is not a record of any person's academic performance and must not be used or represented as one.";

export function buildForumFixture(source: ForumSource) {
  assert.equal(source?.dataset?.synthetic, true, "Expected the synthetic Seminar 12 dataset.");
  assert.equal(source.dataset.discussion_model, "independent_first", "Expected an independent_first forum.");
  assert.ok(Array.isArray(source.roster) && source.roster.length === 11, "Expected 10 learners and 1 faculty advisor.");
  assert.ok(Array.isArray(source.posts), "Expected a posts array.");

  const authorIds = new Map<string, string>();
  const seenUsers = new Set<string>();
  const roster = source.roster.map((member) => {
    for (const field of ["handle", "rank", "service", "mos", "tier"] as const) {
      assert.equal(typeof member[field], "string", `Roster ${field} must be a string.`);
    }
    const user_id = userIds.get(member.handle);
    assert.ok(user_id, `Unknown source roster handle: ${member.handle}`);
    assert.ok(!seenUsers.has(user_id), `Duplicate roster member: ${member.handle}`);
    seenUsers.add(user_id);
    const name = `${member.rank} ${member.handle}`;
    authorIds.set(name, user_id);
    return { ...member, user_id, name };
  });

  const posts = source.posts.filter((post) => post.ifd === 2).map((post) => {
    for (const field of ["post_id", "author", "timestamp", "subject", "body"] as const) {
      assert.equal(typeof post[field], "string", `Post ${field} must be a string.`);
    }
    assert.ok(post.parent_id === null || typeof post.parent_id === "string", "Invalid parent_id.");
    assert.ok(Number.isInteger(post.depth) && post.depth >= 0, "Invalid thread depth.");
    assert.ok(!("provenance" in post), "Imported posts must not contain submission provenance.");
    const user_id = authorIds.get(post.author);
    assert.ok(user_id, `Unknown source author: ${post.author}`);
    return { ...post, user_id };
  });
  assert.equal(posts.length, 31, "Expected the IFD 2 prompt and all 30 discussion posts.");
  const byId = new Map(posts.map((post) => [post.post_id, post]));
  assert.equal(byId.size, posts.length, "Duplicate IFD 2 post IDs.");
  const root = byId.get("2-000");
  assert.ok(root && root.role === "instructor" && root.user_id === "fac-0001", "Missing IFD 2 faculty prompt.");
  assert.equal(root.parent_id, null, "Faculty prompt must be the thread root.");
  assert.equal(root.depth, 0, "Faculty prompt must have depth 0.");
  for (const post of posts) {
    if (post === root) continue;
    const parent: (typeof posts)[number] | undefined = post.parent_id === null ? undefined : byId.get(post.parent_id);
    assert.ok(parent, `Missing IFD 2 parent for ${post.post_id}: ${post.parent_id}`);
    assert.equal(post.depth, parent.depth + 1, `Invalid thread depth for ${post.post_id}`);
  }

  return {
    id: "2",
    ifd: 2,
    title: root.subject.replace(/^IFD 2: /, ""),
    faculty_prompt: root.body,
    faculty_prompt_post_id: root.post_id,
    synthetic_data_notice: syntheticDataNotice,
    // Keep the full source's metadata/counts distinct from the filtered fixture.
    source_dataset: source.dataset,
    course: source.course,
    roster: [...roster, {
      handle: "J. Demo", rank: "Capt", service: "USMC", mos: "Demo learner", tier: "-",
      user_id: "stu-0011", name: "Capt J. Demo",
    }],
    posts,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [sourcePath, ...extra] = process.argv.slice(2);
    assert.ok(sourcePath && extra.length === 0, "Usage: npx tsx portal/import-forum.ts <source-json>");
    const source = JSON.parse(readFileSync(resolve(sourcePath), "utf8")) as ForumSource;
    const fixture = buildForumFixture(source);
    const destination = new URL("./data/forum.json", import.meta.url);
    writeFileSync(destination, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(`Imported IFD 2: 1 faculty prompt + 30 discussion posts; ${fixture.roster.length} roster entries -> ${fileURLToPath(destination)}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
