# Markdown Editor

一个本地、轻量、类 **Typora** 的 Markdown 编辑器，支持 **KaTeX 公式块**。

## 📦 下载

| 芯片 | 推荐 (.dmg) | 便携 (.zip) |
| --- | --- | --- |
| **Apple Silicon** (M1 / M2 / M3 / M4) | [arm64 dmg](https://github.com/relativity143/markdown-editor/releases/download/v1.0.2/Markdown.Editor-1.0.2-arm64.dmg) | [arm64 zip](https://github.com/relativity143/markdown-editor/releases/download/v1.0.2/Markdown.Editor-1.0.2-arm64-mac.zip) |
| **Intel** | [x64 dmg](https://github.com/relativity143/markdown-editor/releases/download/v1.0.2/Markdown.Editor-1.0.2.dmg) | [x64 zip](https://github.com/relativity143/markdown-editor/releases/download/v1.0.2/Markdown.Editor-1.0.2-mac.zip) |

或访问 [Releases 页面](https://github.com/relativity143/markdown-editor/releases/latest) 看所有版本。

> **首次启动若提示「无法验证开发者」**：右键 App → **打开** → 弹窗里点 **打开**；或终端执行 `xattr -dr com.apple.quarantine "/Applications/Markdown Editor.app"`。  
> 本版本是 ad-hoc 自签名（未购买 Apple Developer 公证）。

## 更新日志

### v1.0.2 (2026-05-15)

- 修复首次打开或切换文件时误判为“未保存”的问题
- 修复即时渲染 / IR / 分屏预览切换不生效的问题
- 在标题栏新增 `即渲 / IR / 分屏` 直接切换按钮

### v1.0.1 (2026-05-14)

- 书写区从居中改为靠左，左侧仅 24 px 留白，优化视觉效果
- 修复 README 中部分残留的旧版本路径

### v1.0.0 (2026-05-14)

- 首个正式版本，Electron 打包的 macOS 原生 App
- 文件树侧栏（`⌘⇧O` 选文件夹），双击 `.md` 自动以本 App 打开
- KaTeX 公式块按钮、原生菜单与文件关联

---

提供两种使用方式：

1. **零安装：双击 `index.html`** 在浏览器里直接用。
2. **原生 macOS 应用**：用 Electron 打包成 `.app`，双击启动、原生菜单、`.md` 文件双击关联。

## 特性

- **三种编辑模式**
  - 即时渲染（WYSIWYG，默认，最接近 Typora 的体验）
  - 所见即所得（IR，源码与渲染混排）
  - 分屏预览（SV，左源码 / 右预览）
- **公式块**：行内 `$E=mc^2$`、块级 `$$ ... $$`，使用 KaTeX 渲染；工具栏直接有「公式块」「行内公式」按钮
- **代码高亮**、表格、任务列表、引用、脚注、Emoji
- **Mermaid / 流程图 / 时序图**（由 Vditor 提供）
- **文件树侧栏**：选一个文件夹挂载为工作区，左侧树状浏览、点击直接打开；打开任意 `.md` 时也会自动把所在目录挂为工作区
- **本地文件读写**：新建 / 打开 / 保存 / 另存为
  - Electron 版：调用 macOS 原生对话框 + 直接读写文件
  - 浏览器版：优先用 File System Access API，可直接覆盖原文件
- **导出**：HTML 文件 / 通过系统打印为 PDF
- **自动保存**到本地存储，下次打开自动恢复；窗口关闭不再阻塞
- **大纲**：根据 `#` 标题自动生成，点击跳转
- **明 / 暗主题**、打字机模式、字数 / 字符统计

## 使用方法

1. 双击 `index.html`，在浏览器（推荐 Chrome、Edge、Arc 等 Chromium 内核）中打开。
2. 第一次需要联网，浏览器会缓存编辑器引擎；之后即可完全离线使用。
3. 开始书写。

### 推荐：完全离线使用

将本项目放在你常用的文件夹中，把 `index.html` 加入浏览器书签或放到 Dock。第一次打开后，CDN 资源会被浏览器缓存，之后断网也能用。

如果希望 **彻底零依赖**（不需要网络的首次访问），可以：

```bash
# 任选一种本地静态服务器，并将 CDN 资源下载到本地
npx http-server . -p 5173
# 然后访问 http://localhost:5173
```

或将 Vditor 资源下载下来：

```bash
mkdir -p vendor/vditor
curl -L https://cdn.jsdelivr.net/npm/vditor@3.10.4/dist/index.css -o vendor/vditor/index.css
curl -L https://cdn.jsdelivr.net/npm/vditor@3.10.4/dist/index.min.js -o vendor/vditor/index.min.js
```

然后把 `index.html` 中的 CDN 链接改为 `vendor/vditor/...` 即可。

## 快捷键

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 新建 | ⌘N | Ctrl+N |
| 打开文件 | ⌘O | Ctrl+O |
| 打开文件夹 | ⌘⇧O | Ctrl+Shift+O |
| 保存 | ⌘S | Ctrl+S |
| 另存为 | ⌘⇧S | Ctrl+Shift+S |
| 公式块 | ⌘⇧M | Ctrl+Shift+M |
| 行内公式 | ⌘⌥M | Ctrl+Alt+M |
| 撤销 / 重做 | ⌘Z / ⌘⇧Z | Ctrl+Z / Ctrl+Shift+Z |
| 查找 | ⌘F | Ctrl+F |

编辑器自身的 Markdown 快捷键（粗体 `⌘B`、斜体 `⌘I` 等）由 Vditor 提供。

## 公式语法（KaTeX）

行内：`$E = mc^{2}$` → $E=mc^{2}$

块级：

```tex
$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$
```

更多语法见菜单：**帮助 → 公式语法 (KaTeX)**。

## 打包为 macOS 应用

需要 Node.js（推荐 brew install node）。

```bash
# 安装依赖（首次运行）
npm install

# 开发模式（带 DevTools，热重载）
npm start

# 打包为 .app + .dmg（Apple Silicon）
npm run build:mac-arm

# 打包为 .app + .dmg（Intel x86_64）
npm run build:mac-x64

# 同时打包两种架构
npm run build:mac
```

产物在 `dist/`（版本号跟随 `package.json` 中的 `version` 字段）：

- `dist/mac-arm64/Markdown Editor.app` — Apple Silicon，直接双击运行
- `dist/mac/Markdown Editor.app` — Intel x86_64，直接双击运行
- `dist/Markdown Editor-<ver>-arm64.dmg` / `<ver>.dmg` — 拖拽到 Applications 的安装镜像
- `dist/Markdown Editor-<ver>-arm64-mac.zip` / `<ver>-mac.zip` — 便携 zip

首次右键 → 打开（一次性绕过 Gatekeeper 提示），之后直接双击即可。

### Electron 原生集成

- **原生菜单**：`文件 / 编辑 / 插入 / 视图 / 窗口 / 帮助`，全套快捷键
- **文件关联**：Finder 双击 `.md / .markdown / .mdown` 直接用本 App 打开
- **原生对话框**：`⌘O / ⌘⇧O / ⌘S` 调起系统的文件 / 文件夹选择框
- **文件树**：菜单「文件 → 打开文件夹...」或左上角文件夹按钮挂载工作区
- **窗口标题**：跟随文档文件名，未保存时显示修改点（红绿灯下方）

## 加速 GitHub / Homebrew 下载（国内）

Electron 打包时需要从 `github.com/electron/electron/releases` 拉二进制（~120MB × 2），国内直连基本会卡。如果你本机已有 Clash / Surge / V2Ray 等代理（HTTP 代理端口比如 7897），可以这样加速：

```bash
# 临时（仅当前 shell）
export HTTPS_PROXY=http://127.0.0.1:7897
export HTTP_PROXY=http://127.0.0.1:7897
npm run build:mac-arm

# 或者直接用本仓库附带的脚本
./scripts/build-with-proxy.sh
```

如果只是装 Homebrew 包慢，用国内镜像即可（无需代理）：

```bash
export HOMEBREW_API_DOMAIN="https://mirrors.ustc.edu.cn/homebrew-bottles/api"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.ustc.edu.cn/homebrew-bottles"
```

npm 镜像已在仓库 `.npmrc` 里写死（`registry.npmmirror.com`）。

## 自定义图标

`assets/icon.svg` 是图标源文件。改完后执行：

```bash
npm run make-icon
```

会自动调用 macOS 系统的 `qlmanage / sips / iconutil` 生成 `build/icon.icns`，electron-builder 下次打包会自动使用。

## 文件结构

```text
.
├── index.html              # 主页面（标题栏 / 文件树 / 大纲 / 编辑器）
├── styles.css              # 类 Typora 的主题样式
├── app.js                  # 渲染进程（编辑器、文件树、菜单、文件、大纲、主题）
├── electron/
│   ├── main.js             # 主进程（窗口、原生菜单、IPC、文件关联、文件夹遍历）
│   └── preload.js          # 安全桥（contextBridge 暴露 electronAPI）
├── assets/
│   └── icon.svg            # 图标源
├── build/
│   └── icon.icns           # 生成的 macOS 图标（被 electron-builder 自动拾取）
├── scripts/
│   ├── make-icon.js        # SVG → .icns
│   └── build-with-proxy.sh # 走代理打包（解决国内 electron 二进制下载慢）
├── package.json            # version、electron-builder 配置、scripts
├── .gitignore
├── .npmrc                  # 国内 npm 镜像
└── README.md
```

## 关于浏览器兼容性

- 推荐 Chromium 内核浏览器（Chrome / Edge / Arc / Brave），支持 **File System Access API**，可像本地软件一样直接保存文件。
- Safari / Firefox 也能使用，但保存时会以"下载"形式弹出，需手动选择路径。

## 致谢

- 编辑器内核：[Vditor](https://github.com/Vanessa219/vditor)
- 公式：[KaTeX](https://katex.org/)
- 灵感来源：[Typora](https://typora.io/)
