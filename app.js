/* =========================================================
 * Markdown Editor - 本地、类 Typora、支持公式块
 * 内核：Vditor (WYSIWYG / IR / SV 三种模式)
 * 功能：
 *   - 即时渲染（默认 WYSIWYG）
 *   - 公式：行内 $...$，块级 $$...$$（KaTeX）
 *   - 文件：新建 / 打开 / 保存 / 另存为 / 导出 HTML / 打印为 PDF
 *   - 自动保存到 localStorage，下次自动恢复
 *   - 浅色 / 深色主题
 *   - 大纲、字数统计
 * ======================================================= */

(function () {
    "use strict";

    // ---------- 常量 ----------
    const LS_KEYS = {
        content: "mde:content",
        filename: "mde:filename",
        theme: "mde:theme",
        mode: "mde:mode",
        showOutline: "mde:outline",
        showFiles: "mde:files",
        workspace: "mde:workspace",
    };

    const DEFAULT_CONTENT = `# 欢迎使用 Markdown Editor

一个本地、轻量、类 Typora 的 Markdown 编辑器，**完全离线可用**，支持公式块。

## 基础语法

- **加粗**、*斜体*、~~删除线~~
- \`行内代码\`
- [超链接](https://commonmark.org)
- 任务列表
  - [x] 已完成
  - [ ] 待办

> 引用：好的工具应该不打扰你思考。

## 代码块

\`\`\`python
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
\`\`\`

## 表格

| 模式 | 说明 |
| --- | --- |
| 即时渲染 | 边写边渲染（推荐） |
| 所见即所得 | 类似富文本 |
| 分屏预览 | 左源码右预览 |

## 公式（KaTeX）

行内公式：质能方程 $E=mc^{2}$，欧拉恒等式 $e^{i\\pi}+1=0$。

块级公式：

$$
\\int_{-\\infty}^{\\infty} e^{-x^{2}}\\,dx = \\sqrt{\\pi}
$$

$$
\\begin{aligned}
\\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_{0}} \\\\
\\nabla \\cdot \\mathbf{B} &= 0 \\\\
\\nabla \\times \\mathbf{E} &= -\\frac{\\partial \\mathbf{B}}{\\partial t} \\\\
\\nabla \\times \\mathbf{B} &= \\mu_{0}\\mathbf{J} + \\mu_{0}\\varepsilon_{0}\\frac{\\partial \\mathbf{E}}{\\partial t}
\\end{aligned}
$$

## 快捷键

- 保存：\`⌘S\` / \`Ctrl+S\`
- 打开：\`⌘O\` / \`Ctrl+O\`
- 新建：\`⌘N\` / \`Ctrl+N\`

---

开始书写吧，旧文件已自动保存到浏览器本地。
`;

    // ---------- 运行环境 ----------
    const ELECTRON = typeof window !== "undefined" && window.electronAPI;

    // ---------- 状态 ----------
    const state = {
        vditor: null,
        filename: localStorage.getItem(LS_KEYS.filename) || "未命名.md",
        filePath: null,   // Electron：完整文件路径
        fileHandle: null, // Web：File System Access API handle
        dirty: false,
        saveTimer: null,
        workspace: null,            // 当前挂载的根目录路径
        treeCache: new Map(),       // path -> entries
        treeExpanded: new Set(),    // 展开的目录路径
    };

    if (ELECTRON) document.documentElement.classList.add("is-electron");

    // ---------- DOM ----------
    const $ = (id) => document.getElementById(id);
    const docTitle = $("doc-title");
    const dirtyDot = $("dirty-dot");
    const statMode = $("stat-mode");
    const statWords = $("stat-words");
    const statChars = $("stat-chars");
    const statSaved = $("stat-saved");
    const fileInput = $("file-input");
    const outlinePanel = $("outline");
    const outlineBody = $("outline-body");
    const filesPanel = $("files");
    const filesBody = $("files-body");
    const filesTitle = $("files-title");
    const mainEl = document.querySelector(".main");

    // =====================================================
    // 初始化 Vditor
    // =====================================================
    function initEditor() {
        const initialContent = localStorage.getItem(LS_KEYS.content) || DEFAULT_CONTENT;
        const initialMode = localStorage.getItem(LS_KEYS.mode) || "wysiwyg";

        state.vditor = new Vditor("editor", {
            height: "100%",
            mode: initialMode, // "wysiwyg" | "ir" | "sv"
            value: initialContent,
            theme: getCurrentTheme() === "dark" ? "dark" : "classic",
            cdn: "https://cdn.jsdelivr.net/npm/vditor@3.10.4",
            placeholder: "开始书写...",
            cache: { enable: false },
            preview: {
                hljs: {
                    enable: true,
                    lineNumber: false,
                    style: getCurrentTheme() === "dark" ? "github-dark" : "github",
                },
                math: {
                    engine: "KaTeX",
                    inlineDigit: true,
                },
                markdown: {
                    autoSpace: true,
                    fixTermTypo: false,
                    toc: false,
                    mark: true,
                    footnotes: true,
                    listStyle: true,
                    sanitize: false,
                },
            },
            toolbar: [
                "emoji", "headings", "bold", "italic", "strike", "|",
                "line", "quote", "list", "ordered-list", "check", "|",
                "code", "inline-code", "table", "|",
                {
                    name: "math-block",
                    tipPosition: "s",
                    tip: "公式块",
                    className: "vditor-toolbar-math",
                    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h6l-3 8 3 8H5"/><path d="M19 4l-4 16"/><path d="M14 12h7"/></svg>',
                    click() {
                        if (state.vditor) state.vditor.insertValue("\n$$\nE = mc^{2}\n$$\n");
                    },
                },
                {
                    name: "math-inline",
                    tipPosition: "s",
                    tip: "行内公式",
                    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><text x="2" y="18" font-size="18" font-family="serif" font-style="italic" fill="currentColor" stroke="none">$x$</text></svg>',
                    click() {
                        if (state.vditor) state.vditor.insertValue(" $a^2 + b^2 = c^2$ ");
                    },
                },
                "|",
                "link", "upload", "|",
                "undo", "redo", "|",
                "edit-mode", "outline", "preview", "export",
            ],
            counter: { enable: true, type: "markdown" },
            after: () => {
                applyTheme(getCurrentTheme());
                onContentChange();
                statMode.textContent = modeLabel(state.vditor.getCurrentMode());
                updateOutline();
                updateCounter();
                statSaved.textContent = "就绪";
            },
            input: () => {
                onContentChange();
            },
            blur: () => {
                persistToLocal();
            },
            select: () => {},
            upload: {
                accept: "image/*",
                handler: (files) => {
                    if (!files || !files.length) return;
                    return new Promise((resolve) => {
                        const f = files[0];
                        const reader = new FileReader();
                        reader.onload = () => {
                            const md = `![${f.name}](${reader.result})`;
                            state.vditor.insertValue(md + "\n");
                            resolve();
                        };
                        reader.readAsDataURL(f);
                    });
                },
            },
        });
    }

    // =====================================================
    // 内容变更
    // =====================================================
    function onContentChange() {
        state.dirty = true;
        dirtyDot.classList.add("show");
        statSaved.textContent = "已修改 · 自动保存中...";
        if (ELECTRON) ELECTRON.setDirty(true);
        updateCounter();
        scheduleAutoSave();
        // 大纲更新做防抖
        clearTimeout(state._outlineTimer);
        state._outlineTimer = setTimeout(updateOutline, 250);
    }

    function scheduleAutoSave() {
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(() => {
            persistToLocal();
        }, 800);
    }

    function persistToLocal() {
        try {
            const md = state.vditor ? state.vditor.getValue() : "";
            localStorage.setItem(LS_KEYS.content, md);
            localStorage.setItem(LS_KEYS.filename, state.filename);
            statSaved.textContent = `已自动保存 · ${formatTime()}`;
        } catch (e) {
            statSaved.textContent = "本地存储失败";
        }
    }

    function updateCounter() {
        if (!state.vditor) return;
        const md = state.vditor.getValue();
        const chars = md.length;
        // 简单分词：中文按字、英文按词
        const words = (md.match(/[\u4e00-\u9fa5]|[a-zA-Z0-9]+/g) || []).length;
        statWords.textContent = `${words} 字`;
        statChars.textContent = `${chars} 字符`;
    }

    // =====================================================
    // 大纲
    // =====================================================
    function updateOutline() {
        if (!state.vditor) return;
        const md = state.vditor.getValue();
        const lines = md.split("\n");
        const headings = [];
        let inCode = false;
        for (const line of lines) {
            if (/^```/.test(line)) { inCode = !inCode; continue; }
            if (inCode) continue;
            const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
            if (m) headings.push({ level: m[1].length, text: m[2].trim() });
        }
        if (!headings.length) {
            outlineBody.innerHTML = '<div class="outline-empty">在文档中添加 # 标题以显示大纲</div>';
            return;
        }
        outlineBody.innerHTML = headings.map((h, i) =>
            `<div class="outline-item lv-${h.level}" data-idx="${i}" title="${escapeHTML(h.text)}">${escapeHTML(h.text)}</div>`
        ).join("");
        outlineBody.querySelectorAll(".outline-item").forEach((el) => {
            el.addEventListener("click", () => {
                const idx = parseInt(el.dataset.idx, 10);
                const target = headings[idx];
                scrollToHeading(target);
            });
        });
    }

    function scrollToHeading(h) {
        const root = document.querySelector(".vditor-reset, .vditor-ir, .vditor-wysiwyg, .vditor-sv");
        if (!root) return;
        const hs = root.querySelectorAll(`h${h.level}`);
        for (const node of hs) {
            if (node.textContent.trim() === h.text) {
                node.scrollIntoView({ behavior: "smooth", block: "start" });
                node.style.transition = "background 0.5s";
                node.style.background = "var(--accent-soft)";
                setTimeout(() => (node.style.background = ""), 800);
                break;
            }
        }
    }

    function escapeHTML(s) {
        return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    // =====================================================
    // 文件树（仅 Electron 模式可用）
    // =====================================================
    const MD_RE = /\.(md|markdown|mdown|txt)$/i;
    const IMG_RE = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i;

    function fileIcon(item) {
        if (item.isDirectory) {
            return state.treeExpanded.has(item.path) ? "📂" : "📁";
        }
        if (MD_RE.test(item.name)) return "📄";
        if (IMG_RE.test(item.name)) return "🖼";
        if (/\.(json|ya?ml|toml|xml)$/i.test(item.name)) return "⚙";
        if (/\.(js|ts|jsx|tsx|py|go|rs|java|c|cpp|h|sh)$/i.test(item.name)) return "❮❯";
        if (/\.(pdf|epub)$/i.test(item.name)) return "📕";
        if (/\.(zip|tar|gz|7z|rar)$/i.test(item.name)) return "📦";
        return "·";
    }

    async function setWorkspace(dirPath, persist = true) {
        if (!ELECTRON || !dirPath) return;
        state.workspace = dirPath;
        state.treeCache.clear();
        state.treeExpanded.clear();
        if (persist) localStorage.setItem(LS_KEYS.workspace, dirPath);

        // 标题显示文件夹名
        const name = dirPath.split(/[\\/]/).pop() || dirPath;
        filesTitle.textContent = name;
        filesTitle.title = dirPath;

        filesBody.innerHTML = '<div class="tree-loading">读取中...</div>';
        try {
            const items = await ELECTRON.listDir(dirPath);
            if (items && items.error) {
                filesBody.innerHTML = `<div class="files-empty">读取失败：${escapeHTML(items.error)}</div>`;
                return;
            }
            state.treeCache.set(dirPath, items || []);
            renderTree();
        } catch (e) {
            filesBody.innerHTML = `<div class="files-empty">读取失败：${escapeHTML(e.message)}</div>`;
        }
    }

    function renderTree() {
        if (!state.workspace) {
            filesBody.innerHTML = '<div class="files-empty">未选择文件夹</div>';
            return;
        }
        filesBody.innerHTML = "";
        renderLevel(filesBody, state.treeCache.get(state.workspace) || [], 0);
    }

    function renderLevel(container, items, depth) {
        for (const item of items) {
            const node = document.createElement("div");
            node.className = "tree-node";
            node.style.paddingLeft = `${4 + depth * 14}px`;
            if (state.filePath === item.path) node.classList.add("active");

            const caret = document.createElement("span");
            caret.className = "tree-caret" + (item.isDirectory ? "" : " leaf") +
                (state.treeExpanded.has(item.path) ? " expanded" : "");
            caret.textContent = item.isDirectory ? "▶" : "";
            node.appendChild(caret);

            const icon = document.createElement("span");
            icon.className = "tree-icon";
            icon.textContent = fileIcon(item);
            node.appendChild(icon);

            const label = document.createElement("span");
            label.className = "tree-label";
            label.textContent = item.name;
            label.title = item.name;
            node.appendChild(label);

            node.addEventListener("click", (e) => {
                e.stopPropagation();
                onTreeClick(item, node, depth);
            });

            container.appendChild(node);

            // 已展开的目录：递归渲染子节点
            if (item.isDirectory && state.treeExpanded.has(item.path)) {
                const children = state.treeCache.get(item.path);
                if (children) renderLevel(container, children, depth + 1);
            }
        }
    }

    async function onTreeClick(item, nodeEl, depth) {
        if (item.isDirectory) {
            const wasOpen = state.treeExpanded.has(item.path);
            if (wasOpen) {
                state.treeExpanded.delete(item.path);
                renderTree();
            } else {
                state.treeExpanded.add(item.path);
                if (!state.treeCache.has(item.path)) {
                    const placeholder = document.createElement("div");
                    placeholder.className = "tree-loading";
                    placeholder.style.paddingLeft = `${4 + (depth + 1) * 14}px`;
                    placeholder.textContent = "读取中...";
                    nodeEl.after(placeholder);
                    try {
                        const children = await ELECTRON.listDir(item.path);
                        state.treeCache.set(item.path, (children && !children.error) ? children : []);
                    } catch (e) {
                        state.treeCache.set(item.path, []);
                    }
                }
                renderTree();
            }
            return;
        }
        // 点文件：仅 markdown / txt 才打开
        if (!MD_RE.test(item.name)) {
            toast("仅支持打开 .md / .markdown / .txt 文件");
            return;
        }
        if (state.dirty && !confirm("当前文档未保存，是否丢弃并打开新文件？")) return;
        try {
            const content = await ELECTRON.readFile(item.path);
            state.vditor.setValue(content);
            state.filePath = item.path;
            state.filename = item.name;
            state.fileHandle = null;
            markSaved();
            updateTitle();
            renderTree(); // 高亮 active
            toast(`已打开 ${item.name}`);
        } catch (e) {
            toast("打开失败：" + e.message);
        }
    }

    async function actionOpenFolder() {
        if (!ELECTRON) {
            toast("浏览器模式暂不支持挂载文件夹，请使用 Electron 版");
            return;
        }
        const dir = await ELECTRON.openFolderDialog();
        if (!dir) return;
        await setWorkspace(dir);
        // 显示文件树面板
        if (mainEl.classList.contains("no-files")) {
            mainEl.classList.remove("no-files");
            localStorage.setItem(LS_KEYS.showFiles, "1");
        }
    }

    async function refreshTree() {
        if (!state.workspace) return;
        const expanded = new Set(state.treeExpanded);
        state.treeCache.clear();
        try {
            const items = await ELECTRON.listDir(state.workspace);
            state.treeCache.set(state.workspace, (items && !items.error) ? items : []);
            // 重新读取已展开目录的子节点
            for (const dirPath of expanded) {
                try {
                    const children = await ELECTRON.listDir(dirPath);
                    state.treeCache.set(dirPath, (children && !children.error) ? children : []);
                } catch (_) {}
            }
            renderTree();
            toast("文件树已刷新");
        } catch (e) {
            toast("刷新失败：" + e.message);
        }
    }

    // =====================================================
    // 文件：新建 / 打开 / 保存 / 另存为
    // =====================================================
    async function actionNew() {
        if (state.dirty && !confirm("当前文档有未保存的修改，确定要新建吗？")) return;
        state.vditor.setValue("# 新文档\n\n");
        state.filename = "未命名.md";
        state.filePath = null;
        state.fileHandle = null;
        markSaved();
        updateTitle();
        toast("已新建文档");
    }

    async function actionOpen() {
        // —— Electron 原生对话框 ——
        if (ELECTRON) {
            try {
                const res = await ELECTRON.openDialog();
                if (!res) return;
                state.vditor.setValue(res.content);
                state.filePath = res.path;
                state.filename = res.path.split(/[\\/]/).pop();
                state.fileHandle = null;
                markSaved();
                updateTitle();
                toast(`已打开 ${state.filename}`);
            } catch (e) {
                toast("打开失败：" + e.message);
            }
            return;
        }

        // —— 浏览器 ——
        if ("showOpenFilePicker" in window) {
            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: "Markdown",
                        accept: { "text/markdown": [".md", ".markdown", ".txt"] },
                    }],
                });
                const file = await handle.getFile();
                const text = await file.text();
                state.vditor.setValue(text);
                state.filename = file.name;
                state.fileHandle = handle;
                markSaved();
                updateTitle();
                toast(`已打开 ${file.name}`);
            } catch (e) {
                if (e.name !== "AbortError") toast("打开失败：" + e.message);
            }
        } else {
            fileInput.click();
        }
    }

    fileInput.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const text = await file.text();
        state.vditor.setValue(text);
        state.filename = file.name;
        state.fileHandle = null;
        markSaved();
        updateTitle();
        toast(`已打开 ${file.name}`);
        fileInput.value = "";
    });

    async function actionSave() {
        const text = state.vditor.getValue();

        // —— Electron ——
        if (ELECTRON) {
            try {
                let target = state.filePath;
                if (!target) {
                    target = await ELECTRON.saveDialog(state.filename || "未命名.md");
                    if (!target) return;
                }
                await ELECTRON.writeFile(target, text);
                state.filePath = target;
                state.filename = target.split(/[\\/]/).pop();
                markSaved();
                updateTitle();
                toast(`已保存 ${state.filename}`);
            } catch (e) {
                toast("保存失败：" + e.message);
            }
            return;
        }

        // —— 浏览器：File System Access ——
        if (state.fileHandle) {
            try {
                const w = await state.fileHandle.createWritable();
                await w.write(text);
                await w.close();
                markSaved();
                toast(`已保存 ${state.filename}`);
                return;
            } catch (e) {
                toast("保存失败，将以下载方式保存");
            }
        }
        if ("showSaveFilePicker" in window) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: state.filename || "未命名.md",
                    types: [{
                        description: "Markdown",
                        accept: { "text/markdown": [".md"] },
                    }],
                });
                const w = await handle.createWritable();
                await w.write(text);
                await w.close();
                state.fileHandle = handle;
                state.filename = handle.name;
                markSaved();
                updateTitle();
                toast(`已保存 ${state.filename}`);
            } catch (e) {
                if (e.name !== "AbortError") toast("保存失败：" + e.message);
            }
        } else {
            downloadFile(state.filename || "未命名.md", text, "text/markdown;charset=utf-8");
            markSaved();
            toast(`已下载 ${state.filename}`);
        }
    }

    async function actionSaveAs() {
        if (ELECTRON) {
            try {
                const target = await ELECTRON.saveDialog(state.filename || "未命名.md");
                if (!target) return;
                await ELECTRON.writeFile(target, state.vditor.getValue());
                state.filePath = target;
                state.filename = target.split(/[\\/]/).pop();
                markSaved();
                updateTitle();
                toast(`已另存为 ${state.filename}`);
            } catch (e) {
                toast("另存为失败：" + e.message);
            }
            return;
        }
        state.fileHandle = null;
        await actionSave();
    }

    function downloadFile(filename, content, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function markSaved() {
        state.dirty = false;
        dirtyDot.classList.remove("show");
        statSaved.textContent = `已保存 · ${formatTime()}`;
        if (ELECTRON) ELECTRON.setDirty(false);
    }

    function updateTitle() {
        docTitle.textContent = state.filename;
        document.title = `${state.filename} - Markdown Editor`;
        if (ELECTRON) ELECTRON.setTitle(`${state.filename} - Markdown Editor`, state.filePath);
    }

    // =====================================================
    // 导出
    // =====================================================
    async function exportHTML() {
        const md = state.vditor.getValue();
        Vditor.md2html(md, {
            mode: "classic",
            cdn: "https://cdn.jsdelivr.net/npm/vditor@3.10.4",
            math: { engine: "KaTeX", inlineDigit: true },
            hljs: { enable: true, style: "github" },
        }).then((html) => {
            const name = (state.filename || "未命名.md").replace(/\.(md|markdown|txt)$/i, "") + ".html";
            const full = buildExportHTML(name, html);
            downloadFile(name, full, "text/html;charset=utf-8");
            toast(`已导出 ${name}`);
        });
    }

    function buildExportHTML(title, body) {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${escapeHTML(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/vditor@3.10.4/dist/index.css" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css" />
<style>
  body{max-width:860px;margin:40px auto;padding:0 24px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",Arial,sans-serif;line-height:1.75;color:#222;}
  h1,h2{border-bottom:1px solid #eee;padding-bottom:.3em;}
  pre{background:#f6f8fa;padding:14px;border-radius:6px;overflow:auto;}
  code{font-family:Menlo,Consolas,monospace;}
  table{border-collapse:collapse;}
  th,td{border:1px solid #ddd;padding:6px 12px;}
  blockquote{border-left:4px solid #4099ff;background:#f6f8fa;margin:1em 0;padding:.5em 1em;color:#555;}
</style>
</head>
<body class="vditor-reset">
${body}
</body>
</html>`;
    }

    function exportPDF() {
        toast("请在弹出的打印窗口中选择 '另存为 PDF'");
        if (ELECTRON) {
            setTimeout(() => ELECTRON.print(), 400);
        } else {
            setTimeout(() => window.print(), 400);
        }
    }

    // =====================================================
    // 视图模式
    // =====================================================
    function setMode(mode) {
        if (!state.vditor) return;
        state.vditor.setMode && state.vditor.setMode(mode);
        // Vditor 旧版本以 vditor.vditor.currentMode 切换
        try { state.vditor.vditor.currentMode = mode; } catch (e) {}
        localStorage.setItem(LS_KEYS.mode, mode);
        statMode.textContent = modeLabel(mode);
        toast(`模式：${modeLabel(mode)}`);
    }

    function modeLabel(mode) {
        return { wysiwyg: "即时渲染", ir: "所见即所得", sv: "分屏预览" }[mode] || "即时渲染";
    }

    // =====================================================
    // 主题
    // =====================================================
    function getCurrentTheme() {
        const t = localStorage.getItem(LS_KEYS.theme);
        if (t) return t;
        return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        localStorage.setItem(LS_KEYS.theme, theme);
        $("btn-theme").textContent = theme === "dark" ? "☀" : "☾";
        if (state.vditor && state.vditor.setTheme) {
            try {
                state.vditor.setTheme(
                    theme === "dark" ? "dark" : "classic",
                    theme === "dark" ? "dark" : "light",
                    theme === "dark" ? "github-dark" : "github"
                );
            } catch (e) {}
        }
    }

    function toggleTheme() {
        const t = getCurrentTheme() === "dark" ? "light" : "dark";
        applyTheme(t);
        toast(`主题：${t === "dark" ? "深色" : "浅色"}`);
    }

    // =====================================================
    // 大纲切换
    // =====================================================
    function toggleOutline() {
        const hidden = mainEl.classList.toggle("no-outline");
        localStorage.setItem(LS_KEYS.showOutline, hidden ? "0" : "1");
    }
    if (localStorage.getItem(LS_KEYS.showOutline) === "0") {
        mainEl.classList.add("no-outline");
    }

    function toggleFiles() {
        const hidden = mainEl.classList.toggle("no-files");
        localStorage.setItem(LS_KEYS.showFiles, hidden ? "0" : "1");
    }
    // 默认隐藏文件树（避免空状态太突兀），用户打开过文件夹或显式开启后才显示
    if (localStorage.getItem(LS_KEYS.showFiles) !== "1") {
        mainEl.classList.add("no-files");
    }

    // =====================================================
    // 插入工具
    // =====================================================
    function insert(text) { state.vditor && state.vditor.insertValue(text); }
    const insertActions = {
        "ins-h1": () => insert("\n# 标题\n"),
        "ins-h2": () => insert("\n## 标题\n"),
        "ins-h3": () => insert("\n### 标题\n"),
        "ins-table": () => insert("\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| A   | B   | C   |\n"),
        "ins-code": () => insert("\n```python\n# 代码\n```\n"),
        "ins-math": () => insert("\n$$\nE = mc^{2}\n$$\n"),
        "ins-math-inline": () => insert(" $a^2 + b^2 = c^2$ "),
        "ins-quote": () => insert("\n> 引用文本\n"),
        "ins-image": () => insert("![描述](https://)"),
        "ins-link": () => insert("[文本](https://)"),
    };

    // =====================================================
    // 菜单交互
    // =====================================================
    function setupMenus() {
        document.querySelectorAll(".menu-item").forEach((mi) => {
            mi.addEventListener("click", (e) => {
                e.stopPropagation();
                const opened = mi.classList.contains("open");
                document.querySelectorAll(".menu-item").forEach((x) => x.classList.remove("open"));
                if (!opened) mi.classList.add("open");
            });
            mi.addEventListener("mouseenter", () => {
                if (document.querySelector(".menu-item.open")) {
                    document.querySelectorAll(".menu-item").forEach((x) => x.classList.remove("open"));
                    mi.classList.add("open");
                }
            });
        });
        document.addEventListener("click", () => {
            document.querySelectorAll(".menu-item").forEach((x) => x.classList.remove("open"));
        });
        document.querySelectorAll(".dropdown li").forEach((li) => {
            if (li.classList.contains("separator")) return;
            li.addEventListener("click", (e) => {
                e.stopPropagation();
                const action = li.dataset.action;
                runAction(action);
                document.querySelectorAll(".menu-item").forEach((x) => x.classList.remove("open"));
            });
        });
    }

    function runAction(action) {
        switch (action) {
            case "new": return actionNew();
            case "open": return actionOpen();
            case "open-folder": return actionOpenFolder();
            case "save": return actionSave();
            case "save-as": return actionSaveAs();
            case "export-html": return exportHTML();
            case "export-pdf": return exportPDF();
            case "undo": return state.vditor && state.vditor.undo && state.vditor.undo();
            case "redo": return state.vditor && state.vditor.redo && state.vditor.redo();
            case "find": return toast("使用浏览器自带查找 ⌘F / Ctrl+F");
            case "mode-wysiwyg": return setMode("wysiwyg");
            case "mode-ir": return setMode("ir");
            case "mode-sv": return setMode("sv");
            case "toggle-outline": return toggleOutline();
            case "toggle-theme": return toggleTheme();
            case "toggle-typewriter": return toggleTypewriter();
            case "help-syntax": return window.open("https://commonmark.org/help/", "_blank");
            case "help-math": return $("modal-math").hidden = false;
            case "help-about": return $("modal-about").hidden = false;
            default:
                if (insertActions[action]) return insertActions[action]();
        }
    }

    // 打字机模式：当前行始终在视口中央
    let typewriterOn = false;
    function toggleTypewriter() {
        typewriterOn = !typewriterOn;
        toast(`打字机模式：${typewriterOn ? "开" : "关"}`);
        if (typewriterOn) document.addEventListener("keyup", typewriterScroll);
        else document.removeEventListener("keyup", typewriterScroll);
    }
    function typewriterScroll() {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        const target = window.innerHeight / 2;
        const delta = rect.top - target;
        const scroller = document.querySelector(".vditor-content") || document.querySelector(".vditor-ir") || document.scrollingElement;
        if (scroller) scroller.scrollBy({ top: delta, behavior: "smooth" });
    }

    // =====================================================
    // 模态框
    // =====================================================
    document.querySelectorAll("[data-close-modal]").forEach((b) => {
        b.addEventListener("click", () => {
            b.closest(".modal").hidden = true;
        });
    });
    document.querySelectorAll(".modal").forEach((m) => {
        m.addEventListener("click", (e) => {
            if (e.target === m) m.hidden = true;
        });
    });

    // =====================================================
    // 顶部按钮
    // =====================================================
    $("btn-theme").addEventListener("click", toggleTheme);
    $("btn-outline").addEventListener("click", toggleOutline);
    $("btn-files").addEventListener("click", toggleFiles);
    $("files-open").addEventListener("click", (e) => { e.stopPropagation(); actionOpenFolder(); });
    $("files-refresh").addEventListener("click", (e) => { e.stopPropagation(); refreshTree(); });

    // =====================================================
    // 全局快捷键
    // =====================================================
    document.addEventListener("keydown", (e) => {
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        const k = e.key.toLowerCase();
        if (k === "s" && !e.shiftKey) { e.preventDefault(); actionSave(); }
        else if (k === "s" && e.shiftKey) { e.preventDefault(); actionSaveAs(); }
        else if (k === "o" && !e.shiftKey) { e.preventDefault(); actionOpen(); }
        else if (k === "o" && e.shiftKey) { e.preventDefault(); actionOpenFolder(); }
        else if (k === "n") { e.preventDefault(); actionNew(); }
    });

    // 退出前自动保存到 localStorage（不阻塞关闭：用户的内容总是会自动恢复）
    window.addEventListener("beforeunload", () => {
        try { persistToLocal(); } catch (_) {}
    });

    // =====================================================
    // Toast
    // =====================================================
    function toast(msg) {
        let t = document.querySelector(".toast");
        if (!t) {
            t = document.createElement("div");
            t.className = "toast";
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.classList.add("show");
        clearTimeout(t._timer);
        t._timer = setTimeout(() => t.classList.remove("show"), 1800);
    }

    // =====================================================
    // 工具
    // =====================================================
    function formatTime() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, "0");
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    // =====================================================
    // Electron 集成：原生菜单 + 文件关联
    // =====================================================
    function setupElectron() {
        if (!ELECTRON) return;
        // 原生菜单点击 → 复用 runAction
        ELECTRON.onMenuAction((action) => runAction(action));
        // 双击 .md / 拖到 Dock：主进程会推送 file:opened
        ELECTRON.onFileOpened(({ path: filePath, content }) => {
            if (!state.vditor) {
                // 编辑器还没初始化好，缓一下
                const wait = setInterval(() => {
                    if (state.vditor) {
                        clearInterval(wait);
                        applyOpenedFile(filePath, content);
                    }
                }, 80);
            } else {
                applyOpenedFile(filePath, content);
            }
        });
        // 恢复上次挂载的文件夹
        const lastWs = localStorage.getItem(LS_KEYS.workspace);
        if (lastWs) setWorkspace(lastWs, false).catch(() => {});
    }

    async function applyOpenedFile(filePath, content) {
        if (state.dirty && !confirm("当前文档有未保存的修改，是否丢弃并打开新文件？")) return;
        state.vditor.setValue(content);
        state.filePath = filePath;
        state.filename = filePath.split(/[\\/]/).pop();
        state.fileHandle = null;
        markSaved();
        updateTitle();
        toast(`已打开 ${state.filename}`);

        // 自动把文件所在目录挂为 workspace（若尚未挂载或不同根）
        if (ELECTRON) {
            try {
                const dir = await ELECTRON.dirname(filePath);
                if (!state.workspace || !filePath.startsWith(state.workspace + "/")) {
                    await setWorkspace(dir);
                } else {
                    renderTree(); // 仅刷新高亮
                }
            } catch (_) {}
        }
    }

    // =====================================================
    // 启动
    // =====================================================
    window.addEventListener("DOMContentLoaded", () => {
        applyTheme(getCurrentTheme());
        setupMenus();
        setupElectron();
        updateTitle();
        if (typeof Vditor === "undefined") {
            document.getElementById("editor").innerHTML =
                '<div style="padding:40px;color:#888">加载编辑器失败：请先连接一次网络以缓存 Vditor 资源（之后即可离线使用）。</div>';
            statSaved.textContent = "无法加载 Vditor";
            return;
        }
        initEditor();
    });
})();
