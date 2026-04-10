// src/storage-layout-check.ts
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
function readStdin() {
  return readFileSync(0, "utf-8");
}
function isUpgradeable(filePath) {
  if (!existsSync(filePath)) return false;
  const content = readFileSync(filePath, "utf-8");
  return content.includes("Initializable") || content.includes("UUPSUpgradeable") || content.includes("TransparentUpgradeableProxy") || content.includes("initializer") || content.includes("__gap");
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
function getContractName(filePath) {
  if (!existsSync(filePath)) return null;
  const content = readFileSync(filePath, "utf-8");
  const match = content.match(/contract\s+(\w+)/);
  return match ? match[1] : null;
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
  if (!isUpgradeable(filePath)) {
    console.log("{}");
    return;
  }
  const contractName = getContractName(filePath);
  if (!contractName) {
    console.log("{}");
    return;
  }
  const projectRoot = findProjectRoot(input.cwd);
  if (!projectRoot) {
    console.log("{}");
    return;
  }
  try {
    execSync(`forge build 2>/dev/null`, {
      cwd: projectRoot,
      timeout: 3e4
    });
    const layout = execSync(
      `forge inspect ${contractName} storage-layout 2>/dev/null`,
      {
        encoding: "utf-8",
        timeout: 15e3,
        cwd: projectRoot
      }
    );
    const hasGap = layout.includes("__gap");
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `UPGRADEABLE CONTRACT: ${contractName}
${hasGap ? "Storage gap detected." : "WARNING: No __gap found. Add uint256[50] private __gap for future upgrade safety."}
Verify storage layout compatibility: forge inspect ${contractName} storage-layout`
      }
    }));
  } catch {
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `UPGRADEABLE CONTRACT: ${contractName}
Could not inspect storage layout. Run: forge inspect ${contractName} storage-layout`
      }
    }));
  }
}
main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
