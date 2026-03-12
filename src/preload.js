const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayApi", {
  connect: (token, topic) => ipcRenderer.invoke("mqtt:connect", { token, topic }),
  disconnect: () => ipcRenderer.invoke("mqtt:disconnect"),
  setOpacity: (value) => ipcRenderer.invoke("overlay:set-opacity", value),
  setLocked: (locked) => ipcRenderer.invoke("overlay:set-locked", locked),
  setClickThrough: (enabled) => ipcRenderer.invoke("overlay:set-click-through", enabled),
  moveBy: (dx, dy) => ipcRenderer.invoke("overlay:move-by", { dx, dy }),
  resizeBy: (dw, dh) => ipcRenderer.invoke("overlay:resize-by", { dw, dh }),
  moveToPreset: (preset) => ipcRenderer.invoke("overlay:move-preset", preset),
  onState: (handler) => {
    const wrapped = (_event, data) => handler(data);
    ipcRenderer.on("mqtt:state", wrapped);
    return () => ipcRenderer.removeListener("mqtt:state", wrapped);
  },
  onRenderedHtml: (handler) => {
    const wrapped = (_event, html) => handler(html);
    ipcRenderer.on("content:html", wrapped);
    return () => ipcRenderer.removeListener("content:html", wrapped);
  },
  onInfo: (handler) => {
    const wrapped = (_event, message) => handler(message);
    ipcRenderer.on("ui:info", wrapped);
    return () => ipcRenderer.removeListener("ui:info", wrapped);
  },
  onClickThroughState: (handler) => {
    const wrapped = (_event, data) => handler(data);
    ipcRenderer.on("overlay:click-through-state", wrapped);
    return () => ipcRenderer.removeListener("overlay:click-through-state", wrapped);
  }
});
