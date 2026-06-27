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
        extImages: "mde:extImages",
        filePath: "mde:filepath",
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
        editorReady: false,         // Vditor 内部 after 回调触发后才为 true（setValue 才生效）
        filename: localStorage.getItem(LS_KEYS.filename) || "未命名.md",
        filePath: (typeof window !== "undefined" && window.electronAPI && localStorage.getItem("mde:filepath")) || null,   // Electron：完整文件路径（跨会话恢复）
        fileHandle: null, // Web：File System Access API handle
        dirty: false,
        saveTimer: null,
        savedContent: null,
        suppressChanges: false,
        suppressChangesTimer: null,
        workspace: null,            // 当前挂载的根目录路径
        treeCache: new Map(),       // path -> entries
        treeExpanded: new Set(),    // 展开的目录路径
        previewPath: null,          // 只读预览栏当前显示的文件路径
        previewContent: null,       // 只读预览栏当前内容（用于主题切换时重渲染）
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
    const previewPanel = $("preview");
    const previewTitle = $("preview-title");
    const previewBody = $("preview-body");
    const mainEl = document.querySelector(".main");

    // =====================================================
    // 初始化 Vditor
    // =====================================================
    function getInitialContent() {
        const saved = localStorage.getItem(LS_KEYS.content);
        return saved !== null ? saved : DEFAULT_CONTENT;
    }

    function suppressChangeTracking() {
        state.suppressChanges = true;
        clearTimeout(state.suppressChangesTimer);
    }

    function resumeChangeTracking(delay = 80) {
        clearTimeout(state.suppressChangesTimer);
        state.suppressChangesTimer = setTimeout(() => {
            state.suppressChanges = false;
        }, delay);
    }

    function syncDirtyState() {
        dirtyDot.classList.toggle("show", state.dirty);
        if (ELECTRON) ELECTRON.setDirty(state.dirty);
    }

    function getEditorContent() {
        if (!state.vditor || typeof state.vditor.getValue !== "function") return "";
        return state.vditor.getValue();
    }

    function syncDirtyFromContent() {
        state.dirty = getEditorContent() !== (state.savedContent ?? "");
        syncDirtyState();
    }

    function setSavedSnapshot(content) {
        state.savedContent = typeof content === "string" ? content : getEditorContent();
        state.dirty = false;
        syncDirtyState();
    }

    function updateModeButtons(activeMode) {
        document.querySelectorAll(".mode-btn[data-mode]").forEach((btn) => {
            btn.classList.toggle("active", btn.dataset.mode === activeMode);
        });
    }

    function setEditorContent(content) {
        if (!state.vditor) return;
        suppressChangeTracking();
        state.vditor.setValue(escapePipesInTableMath(convertLatexDelimiters(content)));
        updateCounter();
        updateOutline();
        resumeChangeTracking();
    }

    // 失焦时修正表格内公式（覆盖直接输入 / 粘贴后 "|" 拆坏公式的情况），并触发重新渲染。
    function fixTableMathInEditor() {
        if (!state.vditor || typeof state.vditor.getValue !== "function") return;
        const current = state.vditor.getValue();
        const fixed = escapePipesInTableMath(current);
        if (fixed === current) return;
        suppressChangeTracking();
        state.vditor.setValue(fixed);
        resumeChangeTracking();
        syncDirtyFromContent();
        updateCounter();
        updateOutline();
    }

    // ── LaTeX 定界符归一化 ──────────────────────────────────
    // ChatGPT 等工具导出的 Markdown 常用 \[...\]（块级）/ \(...\)（行内）作公式
    // 定界符，Vditor/Lute 只识别 $$...$$ / $...$，导致公式不渲染、反斜杠被
    // Markdown 转义吃掉、公式内 "=" 行被误判为 Setext 标题。载入 / 粘贴 / 预览
    // 时统一转换。跳过代码围栏与行内代码；\\[（LaTeX 换行间距如 \\[2pt]）不受影响。
    // 同行 \[...\] 是否像公式。[ 是 Markdown 链接语法，\[文字1\] 这类转义括号很常见，
    // 因此要求含真正的数学信号符（\ ^ _ { } =），仅有数字不足以判定。
    function looksLikeMath(body) {
        return /[\\^_{}=]/.test(body);
    }

    // 公式内的裸 < > 换成 KaTeX 等价的 \lt \gt。WYSIWYG 是基于 contenteditable 的
    // HTML 编辑器，公式里的 "<"（如 r<R、R_H<0）会被浏览器当成 HTML 标签开头，吞掉
    // 后续内容 → 粘贴 / 模式切换时丢行、公式损坏。\lt \gt 渲染完全等价且不含危险字符。
    // 把公式体内的裸 < > 换成 KaTeX 等价的 \lt \gt
    function fixAngles(b) {
        return b.replace(/</g, "\\lt ").replace(/>/g, "\\gt ");
    }

    function replaceAnglesInMath(text) {
        if (text.indexOf("$") === -1 || !/[<>]/.test(text)) return text;
        // 块级 $$...$$：含尖括号即处理（块级一定是公式）
        let out = text.replace(/\$\$([\s\S]*?)\$\$/g, (m, b) =>
            /[<>]/.test(b) ? `$$${fixAngles(b)}$$` : m);
        // 行内 $...$：要求含尖括号且含数学信号符，避免误伤「$5 < $10」这类货币正文
        out = out.replace(/(^|[^\\$])\$(?!\$)([^$\n]*?)\$(?!\$)/g, (m, pre, b) =>
            (/[<>]/.test(b) && /[\\^_{}=]/.test(b)) ? `${pre}$${fixAngles(b)}$` : m);
        return out;
    }

    function convertLatexDelimitersInSegment(text) {
        let out = text;
        // 块级：\[ 与 \] 各占一行（LLM 导出的典型格式），无条件转换
        out = out.replace(/^[ \t]*\\\[[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\\\][ \t]*$/gm,
            (_m, body) => `$$\n${fixAngles(body)}\n$$`);
        // 块级：同行 \[...\]，要求内容像公式（[ 是 Markdown 链接语法，需防误转 \[文字\]）
        out = out.replace(/(^|[^\\])\\\[([^\n]*?[^\\])\\\]/g, (m, pre, body) =>
            looksLikeMath(body) ? `${pre}$$${fixAngles(body.trim())}$$` : m);
        // 行内：\(...\) —— 圆括号不是 Markdown 语法，\( 几乎只用于公式，无条件转换
        // （含 \(q\)、\(R\) 这类单字母变量；已知是公式，尖括号无条件保护）
        out = out.replace(/(^|[^\\])\\\(([^\n]*?[^\\]|)\\\)/g, (_m, pre, body) =>
            `${pre}$${fixAngles(body.trim())}$`);
        // 兜底：处理本就用 $ 定界、未经上面转换的公式里的尖括号
        return replaceAnglesInMath(out);
    }

    function convertLatexDelimiters(md) {
        if (!md) return md;
        // 需要处理的两种情况：① 含 \[ \( 定界符；② 含 $ 公式且内部有尖括号需保护
        const hasLatexDelim = md.indexOf("\\[") !== -1 || md.indexOf("\\(") !== -1;
        const hasMathAngle = md.indexOf("$") !== -1 && /[<>]/.test(md);
        if (!hasLatexDelim && !hasMathAngle) return md;
        const lines = md.split("\n");
        const out = [];
        let plain = [];
        let fenced = false;
        const flushPlain = () => {
            if (!plain.length) return;
            const seg = plain.join("\n");
            // 行内代码保护
            const stash = [];
            let t = seg.replace(/`[^`\n]*`/g, (m) => {
                stash.push(m);
                return "\u0000" + (stash.length - 1) + "\u0000";
            });
            t = convertLatexDelimitersInSegment(t);
            out.push(t.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[+i]));
            plain = [];
        };
        for (const line of lines) {
            if (/^\s*(```|~~~)/.test(line)) {
                if (!fenced) flushPlain();
                fenced = !fenced;
                out.push(line);
                continue;
            }
            if (fenced) out.push(line);
            else plain.push(line);
        }
        flushPlain();
        return out.join("\n");
    }

    function normalizePastedMarkdown(text) {
        if (!text) return text;
        let out = convertLatexDelimiters(text);
        if (out.includes("$$")) {
            // In WYSIWYG paste, a standalone "=" inside $$...$$ can be parsed as a Setext H1 underline.
            // Merge it with the following formula line so it remains LaTeX, not a Markdown heading.
            out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_match, body) => {
                const lines = body.replace(/^\r?\n/, "").replace(/\r?\n$/, "").split(/\r?\n/);
                const merged = [];
                for (let i = 0; i < lines.length; i += 1) {
                    const line = lines[i];
                    if (/^\s*=+\s*$/.test(line) && i + 1 < lines.length) {
                        merged.push(`${line.trim()} ${lines[i + 1].trimStart()}`);
                        i += 1;
                    } else {
                        merged.push(line);
                    }
                }
                return `$$\n${merged.join("\n")}\n$$`;
            });
        }
        return escapePipesInTableMath(out);
    }

    // ── 表格内公式修复 ───────────────────────────────────────
    // GFM 表格里 "|" 是列分隔符，因此公式中出现的 "|"（如 $P(A|B)$、$|x|$、范数、
    // 集合记号）会把单元格和公式一起拆坏，导致公式无法渲染。这里把表格行中数学公式
    // 内未转义的 "|" 转义为 "\|"。Lute 会在送入 KaTeX 前还原为 "|"，公式语义不变。
    //
    // 注意：「\|」只是编辑器内部的工作格式。保存 / 写盘时会经
    // unescapePipesInTableMath 还原成用户输入的「|」，避免污染文件
    // （否则其它编辑器里 KaTeX 会把 \| 渲染成范数符号 ‖）。
    function escapeBarsInMathBody(body) {
        return body.replace(/\\\||\|/g, (token) => (token === "|" ? "\\|" : token));
    }

    function unescapeBarsInMathBody(body) {
        // 仅把「\|」还原为「|」；优先吃掉「\\」以免误拆 LaTeX 换行等双反斜杠序列
        return body.replace(/\\\\|\\\|/g, (token) => (token === "\\|" ? "|" : token));
    }

    function mapMathInCell(text, mapBody, shouldTouch) {
        const fix = (delimiter) => (match, body) => {
            if (!shouldTouch(body)) return match;
            return delimiter + mapBody(body) + delimiter;
        };
        // 先处理单行块级 $$...$$，再处理行内 $...$
        return text
            .replace(/\$\$([^\n]+?)\$\$/g, fix("$$"))
            .replace(/\$([^$\n]+?)\$/g, fix("$"));
    }

    function escapeMathPipesInCell(text) {
        return mapMathInCell(text, escapeBarsInMathBody, (body) => {
            if (body.indexOf("|") === -1) return false; // 无需处理
            // 仅当内容像公式时才处理，避免误伤如 "| $5 | $6 |" 这类货币单元格。
            return /[A-Za-z\\^_{}=+()/]/.test(body);
        });
    }

    function unescapeMathPipesInCell(text) {
        return mapMathInCell(text, unescapeBarsInMathBody, (body) => body.indexOf("\\|") !== -1);
    }

    function mapTableMathLines(md, mapLine) {
        if (!md || md.indexOf("|") === -1 || md.indexOf("$") === -1) return md;
        const lines = md.split("\n");
        const n = lines.length;
        const isFence = (l) => /^\s*(```|~~~)/.test(l);
        const isDelim = (l) =>
            l.includes("|") &&
            l.includes("-") &&
            /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l);
        const inTable = new Array(n).fill(false);
        let fenced = false;
        for (let i = 0; i < n; i += 1) {
            if (isFence(lines[i])) { fenced = !fenced; continue; }
            if (fenced) continue;
            if (isDelim(lines[i]) && i > 0 && lines[i - 1].includes("|") && !isDelim(lines[i - 1])) {
                inTable[i - 1] = true; // 表头
                inTable[i] = true;     // 分隔行（无公式，处理也无副作用）
                for (let j = i + 1; j < n && lines[j].trim() !== "" && lines[j].includes("|"); j += 1) {
                    if (isFence(lines[j])) break;
                    inTable[j] = true;
                }
            }
        }
        for (let i = 0; i < n; i += 1) {
            if (inTable[i] && lines[i].includes("$")) lines[i] = mapLine(lines[i]);
        }
        return lines.join("\n");
    }

    function escapePipesInTableMath(md) {
        return mapTableMathLines(md, escapeMathPipesInCell);
    }

    // 落盘前还原：表格公式里的「\|」→「|」，保持文件与用户输入一致
    function unescapePipesInTableMath(md) {
        return mapTableMathLines(md, unescapeMathPipesInCell);
    }

    function setUnsavedStatus(message = "未保存 · 自动备份中...") {
        statSaved.textContent = message;
    }

    // 文本是否含数学公式。块级 $$...$$ 直接算；行内 $...$ 要求内部含真正的数学
    // 信号符（\ ^ _ { } =），避免把「$5 到 $6」这类货币误判为公式。
    function containsMath(text) {
        return /\$\$[\s\S]*?\$\$/.test(text) ||
            /(^|[^\\$])\$[^$\n]*[\\^_{}=][^$\n]*\$/.test(text);
    }

    // 光标是否落在表格单元格内（表格单元格是行内/单行上下文，放不下块级 $$ 公式）
    function caretInTableCell() {
        const sel = window.getSelection && window.getSelection();
        if (!sel || !sel.anchorNode) return false;
        const root = document.getElementById("editor");
        let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
        while (el && el !== root) {
            if (el.tagName === "TD" || el.tagName === "TH" || el.tagName === "TABLE") return true;
            el = el.parentElement;
        }
        return false;
    }

    // 把块级 $$...$$ 压成单行行内 $...$（用于粘进表格单元格时）
    function blockMathToInline(text) {
        return text.replace(/\$\$\s*([\s\S]*?)\s*\$\$/g, (_m, body) =>
            `$${body.replace(/\s*\n\s*/g, " ").trim()}$`);
    }

    // 文本是否包含 GFM 表格（用对齐分隔行 |---|---| 判定）
    function hasTableDelimiterRow(text) {
        return text.split("\n").some((l) =>
            l.includes("|") && l.includes("-") &&
            /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l));
    }

    function setupPasteGuard() {
        document.addEventListener("paste", (event) => {
            if (!state.vditor || getCurrentModeSafe() !== "wysiwyg") return;
            const editorRoot = document.getElementById("editor");
            if (!editorRoot || !editorRoot.contains(event.target)) return;
            const clipboard = event.clipboardData;
            const text = clipboard && clipboard.getData("text/plain");
            const html = clipboard && clipboard.getData("text/html");
            if (!text) return;
            // 含表格的粘贴一律交给 Vditor 原生处理，绝不走 insertValue：后者把 Markdown
            // 转 HTML 插入 contenteditable 时，单元格公式里的 "<"（如 r<R）会被当成 HTML
            // 标签开头，吞掉后续内容造成丢行 / 公式损坏。表格里的 \(\)\[\] 公式可在保存后
            // 重新打开时由文件加载路径（setValue，对 < 安全）正确渲染。
            if (hasTableDelimiterRow(text)) return;
            const normalized = normalizePastedMarkdown(text);
            // 含公式的纯文本：必须接管。Vditor 原生粘贴会把 $ 当普通字符转义成 \$，
            // 改用 insertValue 按 Markdown 解析，公式才能正确渲染。
            const mathy = containsMath(normalized);
            if (!mathy) {
                // 富文本（带 HTML）且无公式：交给 Vditor 原生处理；
                // 纯文本且归一化未改写：同样放行，避免影响普通粘贴。
                if (html) return;
                if (normalized === text) return;
            }
            // 表格单元格放不下块级公式，压成行内 $...$，否则 Vditor 会整体转义
            const toInsert = caretInTableCell() ? blockMathToInline(normalized) : normalized;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            setTimeout(() => {
                if (state.vditor) state.vditor.insertValue(toInsert);
            }, 0);
        }, true);
    }

    function initEditor(options = {}) {
        const initialContent = escapePipesInTableMath(convertLatexDelimiters(
            Object.prototype.hasOwnProperty.call(options, "content")
                ? options.content
                : getInitialContent()
        ));
        const initialMode = options.mode || localStorage.getItem(LS_KEYS.mode) || "wysiwyg";
        const onReady = options.onReady;

        suppressChangeTracking();
        state.editorReady = false;

        state.vditor = new Vditor("editor", {
            height: "100%",
            mode: initialMode, // "wysiwyg" | "ir" | "sv"
            value: initialContent,
            theme: getCurrentTheme() === "dark" ? "dark" : "classic",
            cdn: "https://cdn.jsdelivr.net/npm/vditor@3.10.4",
            placeholder: "开始书写...",
            cache: { enable: false },
            preview: {
                // 分屏（sv）模式依赖该值为 both / editor，否则左侧源码区会一直保持 display:none
                mode: "both",
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
                state.editorReady = true;
                applyTheme(getCurrentTheme());
                const currentMode = state.vditor.getCurrentMode();
                statMode.textContent = modeLabel(currentMode);
                updateModeButtons(currentMode);
                if (state.savedContent === null) {
                    state.savedContent = getEditorContent();
                }
                syncDirtyFromContent();
                updateOutline();
                updateCounter();
                if (!state.dirty && statSaved.textContent !== "已自动恢复") {
                    statSaved.textContent = "就绪";
                }
                if (typeof onReady === "function") onReady();
                resumeChangeTracking();
            },
            input: () => {
                if (state.suppressChanges) return;
                onContentChange();
            },
            blur: () => {
                fixTableMathInEditor();
                persistToLocal();
            },
            select: () => {},
            upload: {
                accept: "image/*",
                handler: async (files) => {
                    if (!files || !files.length) return null;
                    for (const f of files) {
                        const dataURL = await readFileAsDataURL(f);
                        const md = await buildImageMarkdown(f.name, dataURL);
                        state.vditor.insertValue(md + "\n");
                    }
                    return null;
                },
            },
        });
    }

    // =====================================================
    // 图片：内联 base64 ↔ 独立文件
    // =====================================================
    let imageNameSeq = 0;

    // 「图片存为独立文件」按文件单独记忆（localStorage 里存 路径→true 的映射），
    // 不影响其它文件，也不改正文内容。未保存的文档没有路径，恒为关（仍用 base64）。
    function extFilesMap() {
        try { return JSON.parse(localStorage.getItem(LS_KEYS.extImages) || "{}") || {}; }
        catch (_) { return {}; }
    }

    function externalImagesEnabled() {
        return !!(state.filePath && extFilesMap()[state.filePath]);
    }

    function setExternalImagesForFile(filePath, on) {
        if (!filePath) return;
        const map = extFilesMap();
        if (on) map[filePath] = true; else delete map[filePath];
        localStorage.setItem(LS_KEYS.extImages, JSON.stringify(map));
    }

    // 让编辑器里相对路径图片（assets/xxx.png）相对「当前文档所在目录」解析，
    // 否则会相对应用包解析而显示裂图。用 <base> 指向文档目录；Markdown 里仍是
    // 相对路径（getAttribute('src') 不变），保存内容不受影响。
    function setImageBase(dir) {
        if (!ELECTRON) return;
        let base = document.getElementById("doc-img-base");
        if (!base) {
            base = document.createElement("base");
            base.id = "doc-img-base";
            document.head.appendChild(base);
        }
        base.href = dir ? "file://" + encodeURI(dir).replace(/#/g, "%23") + "/" : "";
    }

    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error || new Error("读取失败"));
            reader.readAsDataURL(file);
        });
    }

    const MIME_EXT = {
        "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/gif": "gif",
        "image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp", "image/x-icon": "ico",
    };

    function parseDataURL(dataURL) {
        const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/.exec(dataURL || "");
        if (!m) return null;
        const mime = m[1].toLowerCase();
        const ext = MIME_EXT[mime] || mime.split("/")[1].replace("+xml", "");
        return { mime, ext, base64: m[2] };
    }

    function uniqueImageName(orig, ext) {
        // 只剔除文件系统不安全字符与空白，保留中文等 Unicode 文字
        let base = String(orig || "image")
            .replace(/\.[^.]+$/, "")
            .replace(/[\/\\:*?"<>|-]+/g, "_")
            .replace(/\s+/g, "_")
            .replace(/^[._]+|[._]+$/g, "")
            .slice(0, 40);
        if (!base) base = "image";
        imageNameSeq += 1;
        return `${base}-${Date.now()}-${imageNameSeq}.${ext}`;
    }

    // 决定插入内联 base64 还是落地为 assets/ 文件
    async function buildImageMarkdown(name, dataURL) {
        if (externalImagesEnabled() && ELECTRON && state.filePath) {
            const parsed = parseDataURL(dataURL);
            if (parsed) {
                try {
                    const dir = await ELECTRON.dirname(state.filePath);
                    const rel = await ELECTRON.writeImage(dir, uniqueImageName(name, parsed.ext), parsed.base64);
                    return `![${name || ""}](${rel})`;
                } catch (e) {
                    toast("图片落地失败，改用内联：" + e.message);
                }
            }
        }
        return `![${name || ""}](${dataURL})`;
    }

    function toggleExternalImages() {
        if (!state.filePath) return toast("请先保存文档，再为该文件开启「图片存为独立文件」");
        const on = !externalImagesEnabled();
        setExternalImagesForFile(state.filePath, on);
        toast(`本文件「图片存为独立文件」：${on ? "开（之后插入的图自动存到 assets/）" : "关"}`);
    }

    // 瘦身：把当前文档里的内联 base64 图片导出为 assets/ 文件，原文件先备份
    async function exportInlineImages() {
        if (!ELECTRON) return toast("仅桌面版支持导出图片");
        if (!state.filePath) return toast("请先保存文档，再导出图片");
        const content = state.vditor.getValue();
        const re = /!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/g;
        const hits = [];
        let m;
        while ((m = re.exec(content)) !== null) hits.push({ full: m[0], alt: m[1], dataURL: m[2] });
        if (!hits.length) return toast("当前文档没有内联图片");
        try {
            const dir = await ELECTRON.dirname(state.filePath);
            // 固定名备份，已存在则保留（始终是最初的原始备份，不覆盖、不堆积）
            const bak = `${state.filePath}.bak`;
            const bk = await ELECTRON.copyFile(state.filePath, bak, true);
            let out = content;
            let count = 0;
            for (const h of hits) {
                const parsed = parseDataURL(h.dataURL);
                if (!parsed) continue;
                const rel = await ELECTRON.writeImage(dir, uniqueImageName(h.alt || "image", parsed.ext), parsed.base64);
                out = out.replace(h.full, `![${h.alt}](${rel})`);
                count += 1;
            }
            suppressChangeTracking();
            state.vditor.setValue(out);
            resumeChangeTracking();
            await actionSave();
            // 瘦身后自动为本文件开启外置，之后新增图片直接落地，无需再转
            setExternalImagesForFile(state.filePath, true);
            const bakNote = bk && bk.existed
                ? "（原始备份 .bak 已存在，保留不覆盖）"
                : `，原文件已备份为 ${bak.split(/[\\/]/).pop()}`;
            toast(`已导出 ${count} 张图片到 assets/${bakNote}；已为本文件开启自动外置`);
        } catch (e) {
            toast("导出失败：" + e.message);
        }
    }

    // =====================================================
    // 内容变更
    // =====================================================
    function onContentChange() {
        syncDirtyFromContent();
        if (!state.dirty) {
            statSaved.textContent = `已保存 · ${formatTime()}`;
            return;
        }
        markDirtyPendingSave();
    }

    function queueOutlineUpdate() {
        clearTimeout(state._outlineTimer);
        state._outlineTimer = setTimeout(updateOutline, 250);
    }

    function markDirtyPendingSave() {
        setUnsavedStatus();
        updateCounter();
        scheduleAutoSave();
        queueOutlineUpdate();
    }

    function scheduleAutoSave() {
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(() => {
            persistToLocal();
        }, 800);
    }

    function persistToLocal() {
        try {
            const md = getEditorContent();
            localStorage.setItem(LS_KEYS.content, md);
            localStorage.setItem(LS_KEYS.filename, state.filename);
            if (state.filePath) localStorage.setItem(LS_KEYS.filePath, state.filePath);
            else localStorage.removeItem(LS_KEYS.filePath);
            if (state.dirty) {
                setUnsavedStatus(`未保存 · 已自动备份 ${formatTime()}`);
            }
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
    // 文件树仅展示的 Markdown 文件后缀（目录始终展示以便浏览）
    const MD_DISPLAY_RE = /\.(md|markdown|mdown)$/i;
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
            // 仅显示目录与 Markdown 文件，其它类型隐藏
            if (!item.isDirectory && !MD_DISPLAY_RE.test(item.name)) continue;
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

            // md 文件：hover 时显示「在预览栏只读打开」按钮（不影响编辑器）
            if (!item.isDirectory) {
                const prevBtn = document.createElement("button");
                prevBtn.className = "tree-preview-btn";
                prevBtn.title = "在预览栏打开（只读）";
                prevBtn.textContent = "👁";
                prevBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    try {
                        const content = await ELECTRON.readFile(item.path);
                        openInPreview(item.path, content);
                    } catch (err) {
                        toast("预览失败：" + err.message);
                    }
                });
                node.appendChild(prevBtn);
            }

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
            setImageBase(item.path.replace(/[\\/][^\\/]*$/, "")); // 渲染前设好图片基准目录
            setEditorContent(content);
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
        setEditorContent("# 新文档\n\n");
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
                setImageBase(res.path.replace(/[\\/][^\\/]*$/, "")); // 渲染前设好图片基准目录
                setEditorContent(res.content);
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
                setEditorContent(text);
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
        setEditorContent(text);
        state.filename = file.name;
        state.fileHandle = null;
        markSaved();
        updateTitle();
        toast(`已打开 ${file.name}`);
        fileInput.value = "";
    });

    async function actionSave() {
        fixTableMathInEditor();
        // 写盘内容还原编辑器内部的「\|」工作格式，保持文件与用户输入一致
        const text = unescapePipesInTableMath(state.vditor.getValue());

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
                try { setImageBase(await ELECTRON.dirname(target)); } catch (_) {}
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
        fixTableMathInEditor();
        if (ELECTRON) {
            try {
                const target = await ELECTRON.saveDialog(state.filename || "未命名.md");
                if (!target) return;
                await ELECTRON.writeFile(target, unescapePipesInTableMath(state.vditor.getValue()));
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
        clearTimeout(state.saveTimer);
        setSavedSnapshot();
        persistToLocal();
        statSaved.textContent = `已保存 · ${formatTime()}`;
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
        fixTableMathInEditor();
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
        const currentMode = state.vditor.getCurrentMode();
        if (currentMode === mode) return;

        const content = state.vditor.getValue();
        const wasDirty = state.dirty;
        const savedContent = state.savedContent;
        const savedText = statSaved.textContent;
        clearTimeout(state.saveTimer);
        suppressChangeTracking();
        if (state.vditor.destroy) state.vditor.destroy();
        document.getElementById("editor").innerHTML = "";
        state.vditor = null;
        localStorage.setItem(LS_KEYS.mode, mode);

        initEditor({
            content,
            mode,
            onReady: () => {
                if (wasDirty) {
                    state.savedContent = savedContent;
                    state.dirty = true;
                    syncDirtyState();
                } else {
                    setSavedSnapshot();
                }
                statMode.textContent = modeLabel(mode);
                updateModeButtons(mode);
                statSaved.textContent = wasDirty ? savedText || "已修改" : savedText || "就绪";
                updateCounter();
                updateOutline();
            },
        });
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
        // 预览栏打开时，跟随主题重新渲染
        if (mainEl.classList.contains("has-preview") && state.previewContent != null) {
            renderPreview(state.previewContent);
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

    function getCurrentModeSafe() {
        return state.vditor && typeof state.vditor.getCurrentMode === "function"
            ? state.vditor.getCurrentMode()
            : null;
    }

    function getWysiwygRoot() {
        return document.querySelector(".vditor-wysiwyg");
    }

    function getSelectionAnchorElement(selection) {
        if (!selection || !selection.anchorNode) return null;
        return selection.anchorNode.nodeType === Node.ELEMENT_NODE
            ? selection.anchorNode
            : selection.anchorNode.parentElement;
    }

    function getCurrentWysiwygBlock(selection = window.getSelection()) {
        const root = getWysiwygRoot();
        const anchor = getSelectionAnchorElement(selection);
        if (!root || !anchor || !root.contains(anchor)) return null;
        const block = anchor.closest("p, h1, h2, h3, h4, h5, h6");
        return block && root.contains(block) ? block : null;
    }

    function placeCaretAtBlockEnd(block) {
        if (!block) return;
        if (!block.firstChild || (block.childNodes.length === 1 && block.firstChild.nodeName === "BR")) {
            block.textContent = "";
            block.appendChild(document.createTextNode(""));
        }
        const selection = window.getSelection();
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(block);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function syncAfterManualEdit() {
        state.dirty = true;
        syncDirtyState();
        markDirtyPendingSave();
        const root = getWysiwygRoot();
        if (!root) return;
        requestAnimationFrame(() => {
            root.dispatchEvent(new Event("input", { bubbles: true }));
        });
    }

    function replaceBlockWithHeading(block, level, keepText = true) {
        if (!block || level < 1 || level > 6) return false;
        const heading = document.createElement(`h${level}`);
        const dataBlock = block.getAttribute("data-block");
        if (dataBlock !== null) heading.setAttribute("data-block", dataBlock);
        heading.setAttribute("data-marker", "#".repeat(level));

        if (keepText) {
            while (block.firstChild) heading.appendChild(block.firstChild);
        }

        if (!heading.firstChild) heading.appendChild(document.createTextNode(""));
        block.replaceWith(heading);
        placeCaretAtBlockEnd(heading);
        syncAfterManualEdit();
        return true;
    }

    function applyHeadingShortcut(level) {
        if (getCurrentModeSafe() === "wysiwyg") {
            const block = getCurrentWysiwygBlock();
            if (block) return replaceBlockWithHeading(block, level, true);
        }
        const action = insertActions[`ins-h${level}`];
        if (action) {
            action();
            return true;
        }
        return false;
    }

    function handleWysiwygHeadingMarker(event) {
        if (event.defaultPrevented || event.key !== " " || event.metaKey || event.ctrlKey || event.altKey) {
            return false;
        }
        if (getCurrentModeSafe() !== "wysiwyg") return false;
        const selection = window.getSelection();
        if (!selection || !selection.isCollapsed) return false;
        const block = getCurrentWysiwygBlock(selection);
        if (!block || block.tagName !== "P") return false;
        const text = (block.textContent || "").replace(/\u200b/g, "").trim();
        const match = text.match(/^(#{1,6})$/);
        if (!match) return false;
        event.preventDefault();
        return replaceBlockWithHeading(block, match[1].length, false);
    }

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
            case "toggle-ext-images": return toggleExternalImages();
            case "export-inline-images": return exportInlineImages();
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
    $("preview-close").addEventListener("click", closePreview);
    $("preview-edit").addEventListener("click", promotePreviewToEditor);
    $("btn-mode-wysiwyg").addEventListener("click", () => setMode("wysiwyg"));
    $("btn-mode-ir").addEventListener("click", () => setMode("ir"));
    $("btn-mode-sv").addEventListener("click", () => setMode("sv"));
    $("files-open").addEventListener("click", (e) => { e.stopPropagation(); actionOpenFolder(); });
    $("files-refresh").addEventListener("click", (e) => { e.stopPropagation(); refreshTree(); });

    // =====================================================
    // 全局快捷键
    // =====================================================
    document.addEventListener("keydown", (e) => {
        if (handleWysiwygHeadingMarker(e)) return;
        const mod = e.metaKey || e.ctrlKey;
        if (!mod) return;
        const k = e.key.toLowerCase();
        if (k === "s" && !e.shiftKey) { e.preventDefault(); actionSave(); }
        else if (k === "s" && e.shiftKey) { e.preventDefault(); actionSaveAs(); }
        else if (k === "o" && !e.shiftKey) { e.preventDefault(); actionOpen(); }
        else if (k === "o" && e.shiftKey) { e.preventDefault(); actionOpenFolder(); }
        else if (k === "n") { e.preventDefault(); actionNew(); }
        else if (k === "1") { e.preventDefault(); applyHeadingShortcut(1); }
        else if (k === "2") { e.preventDefault(); applyHeadingShortcut(2); }
        else if (k === "3") { e.preventDefault(); applyHeadingShortcut(3); }
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
        // 双击 .md / 拖到 Dock / 从别的应用打开：主进程会推送 file:opened
        // 一律在编辑器中打开并切换（主进程已负责把窗口带到前台）。
        // 只读预览为手动触发：在文件树里点 md 文件行的 👁 按钮。
        ELECTRON.onFileOpened(({ path: filePath, content }) => {
            const handle = () => applyOpenedFile(filePath, content);
            // 必须等 Vditor 真正就绪（after 回调）后再 setValue，否则冷启动时
            // 文件内容会被构造时的初始内容（localStorage 恢复值）覆盖。
            if (!state.editorReady) {
                const wait = setInterval(() => {
                    if (state.editorReady) {
                        clearInterval(wait);
                        handle();
                    }
                }, 60);
            } else {
                handle();
            }
        });
        if (ELECTRON.ready) ELECTRON.ready();
        // 恢复上次挂载的文件夹
        const lastWs = localStorage.getItem(LS_KEYS.workspace);
        if (lastWs) setWorkspace(lastWs, false).catch(() => {});
    }

    async function applyOpenedFile(filePath, content) {
        if (state.dirty && !confirm("当前文档有未保存的修改，是否丢弃并打开新文件？")) return;
        // 渲染前先把图片基准目录设好，否则相对路径图片会按应用包解析成裂图
        setImageBase(filePath.replace(/[\\/][^\\/]*$/, ""));
        setEditorContent(content);
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
                setImageBase(dir);
                if (!state.workspace || !filePath.startsWith(state.workspace + "/")) {
                    await setWorkspace(dir);
                } else {
                    renderTree(); // 仅刷新高亮
                }
            } catch (_) {}
        }
    }

    // =====================================================
    // 只读侧边预览栏
    // =====================================================
    function openInPreview(filePath, content) {
        state.previewPath = filePath;
        state.previewContent = content;
        const name = String(filePath || "").split(/[\\/]/).pop() || "预览";
        previewTitle.textContent = name;
        previewTitle.title = filePath || "";
        mainEl.classList.add("has-preview");
        renderPreview(content);
        toast(`预览 ${name}`);
    }

    function renderPreview(content) {
        const dark = getCurrentTheme() === "dark";
        if (typeof Vditor === "undefined" || typeof Vditor.preview !== "function") {
            // 退化处理：Vditor 不可用时至少把原文显示出来
            previewBody.textContent = content || "";
            return;
        }
        Vditor.preview(previewBody, escapePipesInTableMath(convertLatexDelimiters(content || "")), {
            mode: dark ? "dark" : "light",
            cdn: "https://cdn.jsdelivr.net/npm/vditor@3.10.4",
            theme: { current: dark ? "dark" : "light" },
            hljs: { enable: true, lineNumber: false, style: dark ? "github-dark" : "github" },
            math: { engine: "KaTeX", inlineDigit: true },
            markdown: {
                autoSpace: true,
                fixTermTypo: false,
                toc: false,
                mark: true,
                footnotes: true,
                listStyle: true,
                sanitize: true,
            },
        });
    }

    function closePreview() {
        mainEl.classList.remove("has-preview");
        state.previewPath = null;
        state.previewContent = null;
        previewBody.innerHTML = "";
    }

    // 把预览中的文件提升到编辑器中打开（按预览头部的 ✎ 按钮）
    function promotePreviewToEditor() {
        if (!state.previewPath) return;
        const p = state.previewPath;
        const c = state.previewContent ?? "";
        closePreview();
        applyOpenedFile(p, c);
    }

    // =====================================================
    // 启动
    // =====================================================
    window.addEventListener("DOMContentLoaded", () => {
        applyTheme(getCurrentTheme());
        setupMenus();
        setupPasteGuard();
        setupElectron();
        updateTitle();
        if (typeof Vditor === "undefined") {
            document.getElementById("editor").innerHTML =
                '<div style="padding:40px;color:#888">加载编辑器失败：请先连接一次网络以缓存 Vditor 资源（之后即可离线使用）。</div>';
            statSaved.textContent = "无法加载 Vditor";
            return;
        }
        // 跨会话恢复的文档：渲染前设好图片基准目录，否则相对路径图片冷启动时裂图
        if (state.filePath) setImageBase(state.filePath.replace(/[\\/][^\\/]*$/, ""));
        initEditor();
    });
})();
