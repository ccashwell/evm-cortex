// src/slither-on-save.ts
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
function readStdin() {
  return readFileSync(0, "utf-8");
}
function isSlitherAvailable() {
  try {
    execSync("which slither", { encoding: "utf-8", timeout: 5e3 });
    return true;
  } catch {
    return false;
  }
}
function findProjectRoot(cwd) {
  let dir = cwd;
  while (dir !== "/") {
    if (existsSync(join(dir, "foundry.toml"))) return dir;
    const parent = join(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function runSlither(cwd) {
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    return { success: true, output: "", findings: 0 };
  }
  try {
    const output = execSync(
      'slither . --filter-paths "test/,script/,lib/" --json - 2>/dev/null',
      {
        encoding: "utf-8",
        timeout: 12e4,
        maxBuffer: 2 * 1024 * 1024,
        cwd: projectRoot
      }
    );
    try {
      const parsed = JSON.parse(output);
      const detectors = parsed.results?.detectors || [];
      const highMed = detectors.filter(
        (d) => d.impact === "High" || d.impact === "Medium"
      );
      return { success: true, output: JSON.stringify(highMed, null, 2), findings: highMed.length };
    } catch {
      return { success: true, output, findings: 0 };
    }
  } catch (error) {
    return { success: false, output: error.message, findings: 0 };
  }
}
async function main() {
  const input = JSON.parse(readStdin());
  if (input.tool_name !== "Write" && input.tool_name !== "Edit") {
    console.log("{}");
    return;
  }
  const filePath = input.tool_input?.file_path || input.tool_response?.filePath || "";
  if (!filePath.endsWith(".sol")) {
    console.log("{}");
    return;
  }
  if (!isSlitherAvailable()) {
    console.log("{}");
    return;
  }
  const result = runSlither(input.cwd);
  if (result.findings > 0) {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `SLITHER: ${result.findings} High/Medium finding(s) detected. Review before proceeding.

${result.output.slice(0, 2e3)}`
      }
    }));
  } else {
    console.log("{}");
  }
}
main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
