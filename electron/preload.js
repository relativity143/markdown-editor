/* =========================================================
 * Electron 预加载脚本
 * 通过 contextBridge 向渲染进程暴露安全的原生能力。
 * ======================================================= */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    // 元信息
    isElectron: true,
    platform: () => ipcRenderer.invoke("app:platform"),

    // 文件
    openDialog: () => ipcRenderer.invoke("dialog:open"),
    saveDialog: (defaultName) => ipcRenderer.invoke("dialog:save", defaultName),
    openFolderDialog: () => ipcRenderer.invoke("dialog:open-folder"),
    readFile: (p) => ipcRenderer.invoke("fs:read", p),
    writeFile: (p, content) => ipcRenderer.invoke("fs:write", p, content),
    writeImage: (dir, filename, base64) => ipcRenderer.invoke("fs:write-image", dir, filename, base64),
    copyFile: (src, dest) => ipcRenderer.invoke("fs:copy", src, dest),
    basename: (p) => ipcRenderer.invoke("fs:basename", p),
    dirname: (p) => ipcRenderer.invoke("fs:dirname", p),
    listDir: (p) => ipcRenderer.invoke("fs:list-dir", p),

    // 状态
    setDirty: (dirty) => ipcRenderer.send("app:set-dirty", dirty),
    setTitle: (title, filePath) => ipcRenderer.send("app:set-title", title, filePath),
    ready: () => ipcRenderer.send("renderer:ready"),
    print: () => ipcRenderer.send("app:print"),

    // 事件
    onMenuAction: (cb) => {
        ipcRenderer.removeAllListeners("menu:action");
        ipcRenderer.on("menu:action", (_e, action) => cb(action));
    },
    onFileOpened: (cb) => {
        ipcRenderer.removeAllListeners("file:opened");
        ipcRenderer.on("file:opened", (_e, payload) => cb(payload));
    },
});
