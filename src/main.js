const path = require("path");
const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require("electron");
const mqtt = require("mqtt");
const MarkdownIt = require("markdown-it");
const hljs = require("highlight.js");
const markdownItTaskLists = require("markdown-it-task-lists");
const sanitizeHtml = require("sanitize-html");

let mainWindow;
let mqttClient;
let activeTopic = "";
let isLocked = true;
let clickThroughEnabled = false;

// MarkdownIt + highlight.js parse AI-style markdown while sanitize-html remains
// the final safety boundary before content reaches the renderer.
const markdownRenderer = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight: (str, language) => {
    if (language && hljs.getLanguage(language)) {
      try {
        const highlighted = hljs.highlight(str, { language, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code class="hljs language-${language}">${highlighted}</code></pre>`;
      } catch {
        // Fall through to escaped plain block on parser errors.
      }
    }
    const escaped = MarkdownIt().utils.escapeHtml(str);
    return `<pre class="hljs"><code class="hljs">${escaped}</code></pre>`;
  }
}).use(markdownItTaskLists, { enabled: true, label: true, labelAfter: true });

function sendClickThroughState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("overlay:click-through-state", {
      enabled: clickThroughEnabled,
      shortcut: "CmdOrCtrl+Shift+."
    });
  }
}

function setClickThrough(enabled) {
  clickThroughEnabled = Boolean(enabled);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(clickThroughEnabled, { forward: true });
  }
  sendClickThroughState();
}

function getPresetPosition(preset, winBounds, workArea) {
  const margin = 24;
  if (preset === "top-left") {
    return { x: workArea.x + margin, y: workArea.y + margin };
  }
  if (preset === "top-center") {
    return {
      x: Math.round(workArea.x + (workArea.width - winBounds.width) / 2),
      y: workArea.y + margin
    };
  }
  if (preset === "top-right") {
    return {
      x: workArea.x + workArea.width - winBounds.width - margin,
      y: workArea.y + margin
    };
  }
  return {
    x: Math.round(workArea.x + (workArea.width - winBounds.width) / 2),
    y: workArea.y + workArea.height - winBounds.height - margin
  };
}

function sendState(state, details = "") {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mqtt:state", { state, details, topic: activeTopic });
  }
}

function sendInfo(message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("ui:info", message);
  }
}

function renderMarkdownToSafeHtml(markdown) {
  const rawHtml = markdownRenderer.render(markdown);

  // Keep rich markdown formatting, but whitelist tags/attributes explicitly.
  return sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "pre",
      "code",
      "blockquote",
      "hr",
      "span",
      "input"
    ]),
    allowedAttributes: {
      "*": ["class"],
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "title"],
      code: ["class"],
      pre: ["class"],
      span: ["class"],
      input: ["type", "checked", "disabled"],
      th: ["colspan", "rowspan", "align"],
      td: ["colspan", "rowspan", "align"]
    },
    allowedSchemes: ["http", "https", "data", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noreferrer noopener" })
    }
  });
}

function attachMqttHandlers(client) {
  client.on("connect", () => {
    sendState("connected", "Connected to Flespi MQTT");
    if (activeTopic) {
      client.subscribe(activeTopic, { qos: 1 }, (err) => {
        if (err) {
          sendState("offline", "Subscribed failed");
          sendInfo("Subscription failed. Check topic.");
          return;
        }
        sendInfo("Subscribed and listening for markdown messages.");
      });
    }
  });

  client.on("reconnect", () => {
    sendState("reconnecting", "Trying to reconnect");
  });

  client.on("error", (error) => {
    sendState("offline", "Connection error");
    sendInfo(`MQTT error: ${error.message}`);
  });

  client.on("close", () => {
    sendState("offline", "Connection closed");
  });

  client.on("message", (_topic, payload) => {
    // Cap payload size per message so unexpectedly large publishes don't freeze UI.
    const text = payload.toString("utf8").slice(0, 20000);
    const safeHtml = renderMarkdownToSafeHtml(text);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("content:html", safeHtml);
    }
  });
}

function createWindow() {
  const primary = screen.getPrimaryDisplay();
  const work = primary.workArea;

  mainWindow = new BrowserWindow({
    width: 860,
    height: 320,
    x: Math.round(work.x + (work.width - 860) / 2),
    y: work.y + 28,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,
    movable: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setContentProtection(true);
  mainWindow.setOpacity(0.85);
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.webContents.on("did-finish-load", () => {
    sendClickThroughState();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  globalShortcut.register("CommandOrControl+Shift+.", () => {
    setClickThrough(!clickThroughEnabled);
    sendInfo(
      clickThroughEnabled
        ? "Click-through enabled. Use Cmd/Ctrl+Shift+. to turn it off."
        : "Click-through disabled."
    );
  });

  ipcMain.handle("mqtt:connect", async (_event, { token, topic }) => {
    const trimmedToken = String(token || "").trim();
    const trimmedTopic = String(topic || "").trim();

    if (!trimmedToken || !trimmedTopic) {
      sendInfo("Token and topic are required.");
      sendState("offline", "Missing token/topic");
      return { ok: false };
    }

    activeTopic = trimmedTopic;

    if (mqttClient) {
      mqttClient.end(true);
      mqttClient = null;
    }

    sendState("reconnecting", "Connecting to Flespi MQTT");

    mqttClient = mqtt.connect("wss://mqtt.flespi.io:443", {
      username: trimmedToken,
      password: "",
      reconnectPeriod: 1500,
      connectTimeout: 10000,
      clean: true
    });

    attachMqttHandlers(mqttClient);
    return { ok: true };
  });

  ipcMain.handle("mqtt:disconnect", async () => {
    if (mqttClient) {
      mqttClient.end(true);
      mqttClient = null;
    }
    sendState("offline", "Disconnected");
    return { ok: true };
  });

  ipcMain.handle("overlay:set-opacity", async (_event, value) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    const numeric = Number(value);
    const clamped = Math.max(0.5, Math.min(1, numeric));
    mainWindow.setOpacity(clamped);
  });

  ipcMain.handle("overlay:set-locked", async (_event, locked) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    isLocked = Boolean(locked);
    sendInfo(isLocked ? "Locked: movement is frozen" : "Unlocked: movement enabled");
  });

  ipcMain.handle("overlay:set-click-through", async (_event, enabled) => {
    setClickThrough(enabled);
    return { ok: true, enabled: clickThroughEnabled };
  });

  ipcMain.handle("overlay:move-by", async (_event, { dx, dy }) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    
    const [x, y] = mainWindow.getPosition();
    mainWindow.setPosition(x + Number(dx || 0), y + Number(dy || 0));
  });

  ipcMain.handle("overlay:resize-by", async (_event, { dw, dh }) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    const bounds = mainWindow.getBounds();
    const minWidth = 620;
    const minHeight = 220;
    const nextWidth = Math.max(minWidth, Math.round(bounds.width + Number(dw || 0)));
    const nextHeight = Math.max(minHeight, Math.round(bounds.height + Number(dh || 0)));
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: nextWidth,
      height: nextHeight
    });
  });

  ipcMain.handle("overlay:move-preset", async (_event, preset) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    const workArea = display.workArea;
    const bounds = mainWindow.getBounds();
    const next = getPresetPosition(String(preset || "bottom-center"), bounds, workArea);
    mainWindow.setPosition(next.x, next.y);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
