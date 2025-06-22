// scripts/sync-protos.js
const fs = require("fs");
const path = require("path");

// --- 🚨 关键配置 🚨 ---
// 请务必将此路径修改为您电脑上 Bazel 源码仓库的真实绝对路径！
const BAZEL_REPO_PATH = "/Users/kila/workspace/bazel";
// ---

const DEST_PROTO_DIR = path.resolve(__dirname, "../proto");
const ENTRY_PROTO_FILE =
  "src/main/java/com/google/devtools/build/lib/buildeventstream/proto/build_event_stream.proto";
const PROCESSED_FILES = new Set();
const IMPORT_REGEX = /^\s*import\s+"([^"]+)"\s*;/gm;

function ensureDirectoryExistence(filePath) {
  const dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}

/**
 * 递归地抓取一个 proto 文件及其所有依赖
 * @param {string} relativePath - 相对于 BAZEL_REPO_PATH 的文件路径
 * @param {number} depth - 用于日志缩进
 */
function fetchProtoWithDependencies(relativePath, depth = 0) {
  const indent = "  ".repeat(depth);
  const normalizedPath = path.normalize(relativePath);

  if (PROCESSED_FILES.has(normalizedPath)) {
    return;
  }
  PROCESSED_FILES.add(normalizedPath);

  console.log(`${indent}Processing: ${normalizedPath}`);

  // 跳过标准的 Google proto 文件，它们由工具链提供，不需要复制
  if (normalizedPath.startsWith("google/protobuf/")) {
    console.log(`${indent} -> Standard proto, skipping copy.`);
    return;
  }

  const sourceFile = path.join(BAZEL_REPO_PATH, normalizedPath);
  if (!fs.existsSync(sourceFile)) {
    console.error(
      `${indent} -> ❌ ERROR: Source file not found: ${sourceFile}`,
    );
    return;
  }

  // 1. 复制文件到本地 proto 目录，保持结构
  const destFile = path.join(DEST_PROTO_DIR, normalizedPath);
  ensureDirectoryExistence(destFile);
  fs.copyFileSync(sourceFile, destFile);

  // 2. 读取文件内容，递归处理其所有 import
  const content = fs.readFileSync(sourceFile, "utf-8");
  let match;
  // 必须重置正则表达式的 lastIndex，因为它有 /g 标志
  IMPORT_REGEX.lastIndex = 0;
  while ((match = IMPORT_REGEX.exec(content)) !== null) {
    const importPath = match[1];
    console.log(`${indent}  -> Found dependency: "${importPath}"`);

    // Bazel 的 import 几乎都是从 workspace 根目录开始的，
    // 所以我们直接用 importPath 作为下一个要处理的相对路径。
    fetchProtoWithDependencies(importPath, depth + 1);
  }
}

function main() {
  console.log("--- Starting Proto Synchronization ---");

  if (
    !fs.existsSync(BAZEL_REPO_PATH) ||
    BAZEL_REPO_PATH === "/path/to/your/bazel/repo"
  ) {
    console.error(
      `\n🚨 FATAL ERROR: Bazel source repository path is not configured!`,
    );
    console.error(
      `Please edit 'scripts/sync-protos.js' and set BAZEL_REPO_PATH to the correct absolute path.`,
    );
    process.exit(1);
  }

  console.log(`Source Bazel Repo: ${BAZEL_REPO_PATH}`);
  console.log(`Destination Dir:     ${DEST_PROTO_DIR}`);
  console.log("-------------------------------------\n");

  if (fs.existsSync(DEST_PROTO_DIR)) {
    console.log("Cleaning up old proto directory...");
    fs.rmSync(DEST_PROTO_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DEST_PROTO_DIR, { recursive: true });

  fetchProtoWithDependencies(ENTRY_PROTO_FILE);

  const copiedCount = [...PROCESSED_FILES].filter(
    (p) => !p.startsWith("google/protobuf/"),
  ).length;
  console.log("\n-------------------------------------");
  console.log(`✅ Synchronization complete! Copied ${copiedCount} files.`);
}

main();
