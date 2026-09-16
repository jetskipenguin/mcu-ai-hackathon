import { constants } from "node:fs"
import { copyFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../", import.meta.url))
for (const [source, target] of [
  [".env.example", ".env"],
  ["governance.policy.example.json", "governance.policy.json"],
] as const) {
  const created = await copyFile(path.join(root, source), path.join(root, target), constants.COPYFILE_EXCL)
    .then(() => true)
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return false
      throw error
    })
  console.log(`${created ? "Created" : "Kept existing"} ${target}`)
}
console.log("Edit .env to set DEEPSEEK_API_KEY, then edit governance.policy.json to choose banned phrases.")
