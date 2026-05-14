#!/usr/bin/env node
/* =========================================================
 * 生成 macOS 应用图标
 *   流程：assets/icon.svg → 多尺寸 PNG → icon.iconset → icon.icns
 *   依赖：macOS 内置 qlmanage / sips / iconutil
 *   产物：assets/icon.icns（会被 electron-builder 自动识别）
 * 使用：npm run make-icon
 * ======================================================= */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const SVG = path.join(ROOT, "assets", "icon.svg");
const ICONSET = path.join(ROOT, "assets", "icon.iconset");
const ICNS = path.join(ROOT, "build", "icon.icns"); // electron-builder 默认搜索路径

if (process.platform !== "darwin") {
    console.error("此脚本仅在 macOS 上运行（依赖 qlmanage / sips / iconutil）。");
    process.exit(1);
}
if (!fs.existsSync(SVG)) {
    console.error("未找到 assets/icon.svg");
    process.exit(1);
}

console.log("→ 渲染 SVG 为 1024×1024 PNG ...");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mde-icon-"));
execSync(`qlmanage -t -s 1024 -o "${tmp}" "${SVG}"`, { stdio: "inherit" });
const big = path.join(tmp, "icon.svg.png");
if (!fs.existsSync(big)) {
    console.error("qlmanage 没有生成 PNG，请检查 SVG。");
    process.exit(1);
}

fs.rmSync(ICONSET, { recursive: true, force: true });
fs.mkdirSync(ICONSET, { recursive: true });

const sizes = [
    [16, "icon_16x16.png"],
    [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"],
    [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"],
    [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"],
    [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"],
    [1024, "icon_512x512@2x.png"],
];

for (const [size, name] of sizes) {
    const out = path.join(ICONSET, name);
    execSync(`sips -s format png -z ${size} ${size} "${big}" --out "${out}"`, { stdio: "ignore" });
    console.log(`  ✓ ${name} (${size}×${size})`);
}

console.log("→ 打包为 .icns ...");
fs.mkdirSync(path.dirname(ICNS), { recursive: true });
execSync(`iconutil -c icns "${ICONSET}" -o "${ICNS}"`, { stdio: "inherit" });
fs.rmSync(ICONSET, { recursive: true, force: true });
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`✓ 完成：${path.relative(ROOT, ICNS)}`);
console.log("现在重新运行 npm run build:mac 即可看到新图标。");
