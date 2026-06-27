/* =========================================================
 * Electron 主进程
 *   - 创建窗口
 *   - 原生菜单（File / Edit / View / Window / Help）
 *   - IPC：打开 / 保存 / 读 / 写
 *   - 文件关联 & 命令行参数 & open-file 事件
 *   - 拖拽文件到 Dock 图标 / 窗口
 * ======================================================= */

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, nativeTheme } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { fileURLToPath } = require("url");

const isMac = process.platform === "darwin";
const isDev = process.argv.includes("--dev") || !app.isPackaged;

// 应用单例（防止多开多窗口抢占）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow = null;
let rendererReady = false;
// 暂存「应用/渲染进程还没就绪就被打开的文件」
const pendingFilesToOpen = [];

// =====================================================
// 启动参数与 open-file 事件中提取文件路径
// =====================================================
function normalizeFilePath(input) {
    if (!input || typeof input !== "string") return null;
    const value = input.trim();
    if (!value) return null;
    if (value.startsWith("file://")) {
        try {
            return fileURLToPath(value);
        } catch (_) {
            return decodeURIComponent(value.replace(/^file:\/\//, ""));
        }
    }
    return value;
}

function isSupportedDocument(filePath) {
    return /\.(md|markdown|mdown|txt|text)$/i.test(filePath || "");
}

function pickFileFromArgs(argv) {
    if (!argv) return null;
    // 跳过可执行路径与已知 flag
    for (let i = 1; i < argv.length; i++) {
        const a = normalizeFilePath(argv[i]);
        if (!a || a.startsWith("--") || a.startsWith("-")) continue;
        // dev 模式下，argv 含 "."
        if (a === "." || a === path.resolve(".")) continue;
        if (isSupportedDocument(a)) return a;
    }
    return null;
}

// reason 标记文件来源（"initial" 首次启动 / "external" 运行期再打开）。
// 渲染进程目前一律在编辑器中打开；该标记保留以便日后区分来源，
// external 时主进程会额外把窗口带到前台。
function queueOpenFile(filePath, reason = "external") {
    const normalized = normalizeFilePath(filePath);
    if (!normalized || !isSupportedDocument(normalized)) return;
    if (!mainWindow || !rendererReady) {
        pendingFilesToOpen.push({ path: normalized, reason });
        return;
    }
    sendOpenFile(normalized, reason);
}

// macOS：双击 .md 或 Dock 拖拽时。
// 启动期（渲染进程还没就绪）的 open-file 视为首次打开 → 进编辑器；
// 之后（应用已运行）再触发的视为外部打开 → 进只读预览栏，并把窗口带到前台。
app.on("open-file", (event, filePath) => {
    event.preventDefault();
    const reason = rendererReady ? "external" : "initial";
    if (reason === "external" && mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
    queueOpenFile(filePath, reason);
});

// 第二次启动（已有实例）时，把新文件丢给已有窗口 → 外部打开 → 预览
app.on("second-instance", (event, argv) => {
    const file = pickFileFromArgs(argv);
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        if (file) queueOpenFile(file, "external");
    }
});

function sendOpenFile(filePath, reason = "external") {
    const normalized = normalizeFilePath(filePath);
    if (!mainWindow || !normalized) return;
    fs.readFile(normalized, "utf8")
        .then((content) => {
            mainWindow.webContents.send("file:opened", { path: normalized, content, reason });
        })
        .catch((err) => {
            dialog.showErrorBox("打开失败", err.message);
        });
}

function flushPendingOpenFiles() {
    if (!mainWindow || !rendererReady) return;
    const files = pendingFilesToOpen.splice(0);
    for (const item of files) sendOpenFile(item.path, item.reason);
}

// =====================================================
// 创建窗口
// =====================================================
function createWindow() {
    rendererReady = false;
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 720,
        minHeight: 480,
        titleBarStyle: isMac ? "hiddenInset" : "default",
        trafficLightPosition: { x: 12, y: 12 },
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#fafafa",
        vibrancy: isMac ? "under-window" : undefined,
        visualEffectState: "active",
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            spellcheck: true,
        },
    });

    mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

    mainWindow.once("ready-to-show", () => {
        mainWindow.show();
        if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
        // 推送启动时关联打开的文件（首次启动 → 载入编辑器）
        const initial = pickFileFromArgs(process.argv);
        if (initial) queueOpenFile(initial, "initial");
        flushPendingOpenFiles();
    });

    // 拦截外链：用系统浏览器打开
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: "deny" };
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
        rendererReady = false;
    });

    // 拖拽文件进入窗口
    mainWindow.webContents.on("will-navigate", (e, url) => {
        const filePath = normalizeFilePath(url);
        if (url.startsWith("file://") && isSupportedDocument(filePath)) {
            e.preventDefault();
            queueOpenFile(filePath);
        }
    });
}

// =====================================================
// 原生菜单
// =====================================================
function buildMenu() {
    const send = (channel, payload) =>
        mainWindow && mainWindow.webContents.send(channel, payload);

    const template = [
        ...(isMac
            ? [{
                label: app.name,
                submenu: [
                    { role: "about" },
                    { type: "separator" },
                    { role: "services" },
                    { type: "separator" },
                    { role: "hide" },
                    { role: "hideOthers" },
                    { role: "unhide" },
                    { type: "separator" },
                    { role: "quit" },
                ],
            }]
            : []),
        {
            label: "文件",
            submenu: [
                {
                    label: "新建",
                    accelerator: "CmdOrCtrl+N",
                    click: () => send("menu:action", "new"),
                },
                {
                    label: "打开...",
                    accelerator: "CmdOrCtrl+O",
                    click: async () => {
                        const file = await openFileDialog();
                        if (file) sendOpenFile(file);
                    },
                },
                {
                    label: "打开文件夹...",
                    accelerator: "CmdOrCtrl+Shift+O",
                    click: () => send("menu:action", "open-folder"),
                },
                { type: "separator" },
                {
                    label: "保存",
                    accelerator: "CmdOrCtrl+S",
                    click: () => send("menu:action", "save"),
                },
                {
                    label: "另存为...",
                    accelerator: "CmdOrCtrl+Shift+S",
                    click: () => send("menu:action", "save-as"),
                },
                { type: "separator" },
                {
                    label: "导出 HTML",
                    click: () => send("menu:action", "export-html"),
                },
                {
                    label: "导出 PDF (打印)",
                    accelerator: "CmdOrCtrl+P",
                    click: () => send("menu:action", "export-pdf"),
                },
                { type: "separator" },
                isMac ? { role: "close", label: "关闭窗口" } : { role: "quit", label: "退出" },
            ],
        },
        {
            label: "编辑",
            submenu: [
                { role: "undo", label: "撤销" },
                { role: "redo", label: "重做" },
                { type: "separator" },
                { role: "cut", label: "剪切" },
                { role: "copy", label: "复制" },
                { role: "paste", label: "粘贴" },
                { role: "selectAll", label: "全选" },
                { type: "separator" },
                {
                    label: "查找",
                    accelerator: "CmdOrCtrl+F",
                    click: () => send("menu:action", "find"),
                },
            ],
        },
        {
            label: "插入",
            submenu: [
                { label: "一级标题", accelerator: "CmdOrCtrl+1", click: () => send("menu:action", "ins-h1") },
                { label: "二级标题", accelerator: "CmdOrCtrl+2", click: () => send("menu:action", "ins-h2") },
                { label: "三级标题", accelerator: "CmdOrCtrl+3", click: () => send("menu:action", "ins-h3") },
                { type: "separator" },
                { label: "表格", click: () => send("menu:action", "ins-table") },
                { label: "代码块", click: () => send("menu:action", "ins-code") },
                { label: "公式块（块级）", accelerator: "CmdOrCtrl+Shift+M", click: () => send("menu:action", "ins-math") },
                { label: "行内公式", accelerator: "CmdOrCtrl+Alt+M", click: () => send("menu:action", "ins-math-inline") },
                { label: "引用", click: () => send("menu:action", "ins-quote") },
                { type: "separator" },
                { label: "图片", click: () => send("menu:action", "ins-image") },
                { label: "链接", click: () => send("menu:action", "ins-link") },
            ],
        },
        {
            label: "视图",
            submenu: [
                { label: "即时渲染 (WYSIWYG)", click: () => send("menu:action", "mode-wysiwyg") },
                { label: "所见即所得", click: () => send("menu:action", "mode-ir") },
                { label: "分屏预览", click: () => send("menu:action", "mode-sv") },
                { type: "separator" },
                { label: "大纲", accelerator: "CmdOrCtrl+\\", click: () => send("menu:action", "toggle-outline") },
                { label: "切换深色 / 浅色", accelerator: "CmdOrCtrl+Shift+L", click: () => send("menu:action", "toggle-theme") },
                { label: "打字机模式", click: () => send("menu:action", "toggle-typewriter") },
                { type: "separator" },
                { label: "图片存为独立文件（开关）", click: () => send("menu:action", "toggle-ext-images") },
                { label: "内联图片导出为文件...", click: () => send("menu:action", "export-inline-images") },
                { type: "separator" },
                { role: "reload", label: "重新加载" },
                { role: "toggleDevTools", label: "开发者工具" },
                { type: "separator" },
                { role: "resetZoom", label: "实际大小" },
                { role: "zoomIn", label: "放大" },
                { role: "zoomOut", label: "缩小" },
                { type: "separator" },
                { role: "togglefullscreen", label: "全屏" },
            ],
        },
        {
            label: "窗口",
            role: "window",
            submenu: [
                { role: "minimize", label: "最小化" },
                { role: "zoom", label: "缩放" },
                ...(isMac
                    ? [
                        { type: "separator" },
                        { role: "front", label: "全部前置" },
                    ]
                    : []),
            ],
        },
        {
            label: "帮助",
            role: "help",
            submenu: [
                { label: "Markdown 语法", click: () => shell.openExternal("https://commonmark.org/help/") },
                { label: "KaTeX 公式语法", click: () => send("menu:action", "help-math") },
                { type: "separator" },
                { label: "关于", click: () => send("menu:action", "help-about") },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// =====================================================
// 对话框
// =====================================================
async function openFileDialog() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "打开 Markdown 文件",
        properties: ["openFile"],
        filters: [
            { name: "Markdown", extensions: ["md", "markdown", "mdown", "txt"] },
            { name: "全部文件", extensions: ["*"] },
        ],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
}

async function saveFileDialog(defaultName) {
    const result = await dialog.showSaveDialog(mainWindow, {
        title: "保存 Markdown 文件",
        defaultPath: defaultName || "未命名.md",
        filters: [
            { name: "Markdown", extensions: ["md", "markdown"] },
            { name: "HTML", extensions: ["html"] },
            { name: "纯文本", extensions: ["txt"] },
        ],
    });
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
}

async function openFolderDialog() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "打开文件夹",
        properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
}

// 排除常见噪声目录 / 文件
const SKIP_NAMES = new Set([
    "node_modules", ".git", ".idea", ".vscode", "dist", "build",
    "out", "__pycache__", ".DS_Store", ".cache", ".next", ".nuxt",
    "Library", "Pictures", "Movies", "Music",
]);

async function listDirectory(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = [];
    for (const e of entries) {
        if (SKIP_NAMES.has(e.name)) continue;
        if (e.name.startsWith(".")) continue;
        items.push({
            name: e.name,
            path: path.join(dirPath, e.name),
            isDirectory: e.isDirectory(),
        });
    }
    items.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true });
    });
    return items;
}

// =====================================================
// IPC：渲染进程 ↔ 主进程
// =====================================================
ipcMain.handle("dialog:open", async () => {
    const filePath = await openFileDialog();
    if (!filePath) return null;
    const content = await fs.readFile(filePath, "utf8");
    return { path: filePath, content };
});

ipcMain.handle("dialog:save", async (_e, defaultName) => {
    return await saveFileDialog(defaultName);
});

ipcMain.handle("dialog:open-folder", async () => {
    return await openFolderDialog();
});

ipcMain.handle("fs:read", async (_e, filePath) => {
    return await fs.readFile(filePath, "utf8");
});

ipcMain.handle("fs:write", async (_e, filePath, content) => {
    await fs.writeFile(filePath, content, "utf8");
    return true;
});

// 把 base64 图片写入 <dir>/assets/，返回相对链接 assets/<filename>
ipcMain.handle("fs:write-image", async (_e, dirPath, filename, base64) => {
    const assetsDir = path.join(dirPath, "assets");
    await fs.mkdir(assetsDir, { recursive: true });
    await fs.writeFile(path.join(assetsDir, filename), Buffer.from(base64, "base64"));
    return "assets/" + filename;
});

// 复制文件（用于瘦身前备份原文件）
ipcMain.handle("fs:copy", async (_e, src, dest) => {
    await fs.copyFile(src, dest);
    return true;
});

ipcMain.handle("fs:basename", async (_e, p) => path.basename(p));

ipcMain.handle("fs:dirname", async (_e, p) => path.dirname(p));

ipcMain.handle("fs:list-dir", async (_e, dirPath) => {
    try {
        return await listDirectory(dirPath);
    } catch (err) {
        return { error: err.message };
    }
});

ipcMain.handle("app:platform", async () => process.platform);

ipcMain.on("renderer:ready", () => {
    rendererReady = true;
    flushPendingOpenFiles();
});

ipcMain.on("app:print", () => {
    if (mainWindow) mainWindow.webContents.print({ silent: false, printBackground: true });
});

ipcMain.on("app:set-dirty", (_e, dirty) => {
    if (mainWindow) mainWindow.setDocumentEdited(!!dirty);
});

ipcMain.on("app:set-title", (_e, title, filePath) => {
    if (!mainWindow) return;
    mainWindow.setTitle(title || "Markdown Editor");
    if (filePath) mainWindow.setRepresentedFilename(filePath);
});

// =====================================================
// 关闭前提醒（macOS：关窗口不退出 app）
// =====================================================
let isQuitting = false;
app.on("before-quit", () => { isQuitting = true; });

app.on("window-all-closed", () => {
    if (!isMac) app.quit();
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// =====================================================
// 启动
// =====================================================
app.whenReady().then(() => {
    buildMenu();
    createWindow();
});
