const STORAGE_KEY = "presenter-overlay:v1";

const connectSheet = document.getElementById("connectSheet");
const tokenInput = document.getElementById("tokenInput");
const topicInput = document.getElementById("topicInput");
const connectButton = document.getElementById("connectButton");
const closeSourceButton = document.getElementById("closeSourceButton");
const editButton = document.getElementById("editButton");
const hidePanelButton = document.getElementById("hidePanelButton");
const showPanelButton = document.getElementById("showPanelButton");
const clearMessagesButton = document.getElementById("clearMessagesButton");
const overlayRoot = document.getElementById("overlayRoot");
const sidePanel = document.getElementById("sidePanel");
const dragRail = document.querySelector(".drag-rail");
const panelHead = document.querySelector(".panel-head");
const resizeHandle = document.getElementById("resizeHandle");
const lockButton = document.getElementById("lockButton");
const clickThroughButton = document.getElementById("clickThroughButton");
const opacityInput = document.getElementById("opacityInput");
const opacityValue = document.getElementById("opacityValue");
const fontSizeInput = document.getElementById("fontSizeInput");
const fontSizeValue = document.getElementById("fontSizeValue");
const positionPreset = document.getElementById("positionPreset");
const stateBadge = document.getElementById("stateBadge");
const markdownView = document.getElementById("markdownView");
const messageList = document.getElementById("messageList");
const emptyState = document.getElementById("emptyState");
const shortcutNote = document.getElementById("shortcutNote");
const toast = document.getElementById("toast");

const defaultSettings = {
  token: "",
  topic: "overlay/presenter/markdown",
  opacity: 0.85,
  fontSize: 24,
  positionPreset: "top-center",
  controlsVisible: true,
  sourceSheetOpen: true,
  clickThrough: false
};

let settings = loadSettings();
let controlsVisible = settings.controlsVisible;
let locked = false;
let clickThroughEnabled = false;
let clickThroughShortcut = "Cmd/Ctrl+Shift+.";
let toastTimer;
let activeGesture = null;
let pendingMove = { dx: 0, dy: 0 };
let pendingResize = { dw: 0, dh: 0 };
let moveFlushRaf = 0;
let resizeFlushRaf = 0;
let pendingOpacity = null;
let opacityFlushRaf = 0;
let messageCount = 0;

function loadSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...defaultSettings };
    }
    return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 2400);
}

function updateOpacityLabel() {
  opacityValue.textContent = `${Math.round(Number(opacityInput.value) * 100)}%`;
}

function updateFontSizeLabel() {
  fontSizeValue.textContent = `${fontSizeInput.value}px`;
}

function applyFontSize(fontSize) {
  const clamped = clamp(Number(fontSize), 12, 40);
  markdownView.style.setProperty("--content-font-size", `${clamped}px`);
  fontSizeInput.value = String(clamped);
  updateFontSizeLabel();
  settings.fontSize = clamped;
  saveSettings();
}

function setPanelVisible(visible) {
  controlsVisible = visible;
  sidePanel.classList.toggle("hidden", !visible);
  showPanelButton.classList.toggle("visible", !visible);
  settings.controlsVisible = visible;
  saveSettings();
}

function setSourceSheetOpen(open) {
  connectSheet.classList.toggle("hidden", !open);
  editButton.textContent = open ? "Source Open" : "Source";
  settings.sourceSheetOpen = open;
  saveSettings();
}

function applyLockedState(nextLocked) {
  locked = nextLocked;
  lockButton.dataset.locked = String(locked);
  lockButton.textContent = locked ? "Movement Locked" : "Movement Unlocked";
  positionPreset.disabled = locked;
  window.overlayApi.setLocked(locked);
}

function updateClickThroughUI() {
  clickThroughButton.textContent = clickThroughEnabled ? "Click-through On" : "Click-through Off";
  shortcutNote.textContent = `Click-through shortcut: ${clickThroughShortcut}`;
}

async function setClickThrough(enabled) {
  const result = await window.overlayApi.setClickThrough(Boolean(enabled));
  clickThroughEnabled = Boolean(result?.enabled ?? enabled);
  settings.clickThrough = clickThroughEnabled;
  saveSettings();
  updateClickThroughUI();
}

function beginGesture(type, startX, startY) {
  if (locked || clickThroughEnabled) {
    return;
  }
  document.body.classList.add("perf-dragging");
  activeGesture = { type, lastX: startX, lastY: startY };
}

function flushMove() {
  moveFlushRaf = 0;
  if (!pendingMove.dx && !pendingMove.dy) {
    return;
  }
  window.overlayApi.moveBy(pendingMove.dx, pendingMove.dy);
  pendingMove.dx = 0;
  pendingMove.dy = 0;
}

function flushResize() {
  resizeFlushRaf = 0;
  if (!pendingResize.dw && !pendingResize.dh) {
    return;
  }
  window.overlayApi.resizeBy(pendingResize.dw, pendingResize.dh);
  pendingResize.dw = 0;
  pendingResize.dh = 0;
}

function setOpacityThrottled(nextOpacity) {
  pendingOpacity = nextOpacity;
  if (opacityFlushRaf) {
    return;
  }
  opacityFlushRaf = window.requestAnimationFrame(() => {
    opacityFlushRaf = 0;
    if (pendingOpacity === null) {
      return;
    }
    window.overlayApi.setOpacity(pendingOpacity);
    pendingOpacity = null;
  });
}

function stopGesture() {
  document.body.classList.remove("perf-dragging");
  activeGesture = null;
}

function onGestureMove(event) {
  if (!activeGesture || locked || clickThroughEnabled) {
    return;
  }

  const dx = event.screenX - activeGesture.lastX;
  const dy = event.screenY - activeGesture.lastY;
  activeGesture.lastX = event.screenX;
  activeGesture.lastY = event.screenY;

  if (activeGesture.type === "move") {
    pendingMove.dx += dx;
    pendingMove.dy += dy;
    if (!moveFlushRaf) {
      moveFlushRaf = window.requestAnimationFrame(flushMove);
    }
    return;
  }

  pendingResize.dw += dx;
  pendingResize.dh += dy;
  if (!resizeFlushRaf) {
    resizeFlushRaf = window.requestAnimationFrame(flushResize);
  }
}

function bindMoveGesture(element) {
  if (!element) {
    return;
  }
  element.addEventListener("mousedown", (event) => {
    if (locked || clickThroughEnabled || event.button !== 0) {
      return;
    }
    if (event.target.closest("button, input, select, textarea, a, .message-list")) {
      return;
    }
    event.preventDefault();
    beginGesture("move", event.screenX, event.screenY);
  });
}

function renderMessageCard(html) {
  if (emptyState.isConnected) {
    emptyState.remove();
  }

  messageCount += 1;

  const card = document.createElement("section");
  card.className = "message-card";

  const meta = document.createElement("div");
  meta.className = "message-meta";

  const index = document.createElement("span");
  index.className = "message-index";
  index.textContent = `Message ${messageCount}`;

  const timestamp = document.createElement("time");
  timestamp.dateTime = new Date().toISOString();
  timestamp.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });

  meta.append(index, timestamp);

  const body = document.createElement("div");
  body.className = "message-body";
  body.innerHTML = html;

  card.append(meta, body);
  messageList.appendChild(card);
  card.scrollIntoView({ block: "start", behavior: "auto" });
}

function clearMessages() {
  messageCount = 0;
  messageList.replaceChildren(emptyState);
  markdownView.scrollTop = 0;
}

function setConnectionState(state, details = "") {
  const label = state.charAt(0).toUpperCase() + state.slice(1);
  stateBadge.textContent = label;
  stateBadge.title = label;
  stateBadge.classList.remove("connected", "reconnecting", "offline");
  stateBadge.classList.add(state);
  if (details) {
    showToast(details);
  }
}

function restoreSettings() {
  tokenInput.value = settings.token;
  topicInput.value = settings.topic;
  opacityInput.value = String(settings.opacity);
  positionPreset.value = settings.positionPreset;
  updateOpacityLabel();
  applyFontSize(settings.fontSize);
  setPanelVisible(settings.controlsVisible);
  setSourceSheetOpen(settings.sourceSheetOpen);
  setOpacityThrottled(settings.opacity);
}

function connectNow() {
  const token = tokenInput.value.trim();
  const topic = topicInput.value.trim();

  if (!token || !topic) {
    showToast("Token and topic are required.");
    return;
  }

  settings.token = token;
  settings.topic = topic;
  saveSettings();

  window.overlayApi.connect(token, topic).then((result) => {
    if (result && result.ok) {
      setSourceSheetOpen(false);
      setPanelVisible(true);
      showToast("Connecting...");
    }
  });
}

connectButton.addEventListener("click", connectNow);
clearMessagesButton.addEventListener("click", clearMessages);

tokenInput.addEventListener("input", () => {
  settings.token = tokenInput.value;
  saveSettings();
});

topicInput.addEventListener("input", () => {
  settings.topic = topicInput.value;
  saveSettings();
});

tokenInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    connectNow();
  }
});

topicInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    connectNow();
  }
});

editButton.addEventListener("click", () => {
  setPanelVisible(true);
  const nextOpen = connectSheet.classList.contains("hidden");
  setSourceSheetOpen(nextOpen);
  if (nextOpen) {
    if (!tokenInput.value.trim()) {
      tokenInput.focus();
    } else {
      topicInput.focus();
    }
  }
});

closeSourceButton.addEventListener("click", () => {
  setSourceSheetOpen(false);
});

hidePanelButton.addEventListener("click", () => {
  setPanelVisible(false);
});

showPanelButton.addEventListener("click", () => {
  setPanelVisible(true);
});

lockButton.addEventListener("click", () => {
  applyLockedState(!locked);
});

clickThroughButton.addEventListener("click", async () => {
  await setClickThrough(!clickThroughEnabled);
  showToast(
    clickThroughEnabled
      ? `Click-through enabled. Disable with ${clickThroughShortcut}.`
      : "Click-through disabled."
  );
});

opacityInput.addEventListener("input", () => {
  const next = clamp(Number(opacityInput.value), 0.5, 1);
  settings.opacity = next;
  saveSettings();
  updateOpacityLabel();
  setOpacityThrottled(next);
});

fontSizeInput.addEventListener("input", () => {
  applyFontSize(fontSizeInput.value);
});

positionPreset.addEventListener("change", () => {
  settings.positionPreset = positionPreset.value;
  saveSettings();
  if (locked || clickThroughEnabled) {
    return;
  }
  window.overlayApi.moveToPreset(positionPreset.value);
});

// Keep wheel behavior dedicated to scrolling the message feed.

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setPanelVisible(!controlsVisible);
    showToast(controlsVisible ? "Side panel shown" : "Side panel hidden");
    return;
  }

  if ((event.metaKey || event.ctrlKey) && event.key === ";") {
    setPanelVisible(true);
    return;
  }

  const step = event.shiftKey ? 20 : 5;
  if (locked || clickThroughEnabled) {
    return;
  }

  if (event.key === "ArrowLeft") {
    window.overlayApi.moveBy(-step, 0);
  } else if (event.key === "ArrowRight") {
    window.overlayApi.moveBy(step, 0);
  } else if (event.key === "ArrowUp") {
    window.overlayApi.moveBy(0, -step);
  } else if (event.key === "ArrowDown") {
    window.overlayApi.moveBy(0, step);
  }
});

window.addEventListener("dblclick", () => {
  if (!clickThroughEnabled) {
    applyLockedState(!locked);
  }
});

bindMoveGesture(dragRail);
bindMoveGesture(panelHead);
bindMoveGesture(overlayRoot);

resizeHandle.addEventListener("mousedown", (event) => {
  if (locked || clickThroughEnabled || event.button !== 0) {
    return;
  }
  event.preventDefault();
  beginGesture("resize", event.screenX, event.screenY);
});

window.addEventListener("mousemove", onGestureMove);
window.addEventListener("mouseup", stopGesture);
window.addEventListener("mouseleave", stopGesture);

window.overlayApi.onRenderedHtml((html) => {
  renderMessageCard(html);
});

window.overlayApi.onState((data) => {
  setConnectionState(data.state, data.details);
});

window.overlayApi.onInfo((message) => {
  showToast(message);
});

window.overlayApi.onClickThroughState((data) => {
  clickThroughEnabled = Boolean(data.enabled);
  clickThroughShortcut = data.shortcut || clickThroughShortcut;
  settings.clickThrough = clickThroughEnabled;
  saveSettings();
  updateClickThroughUI();
});

restoreSettings();
clearMessages();
applyLockedState(false);
setClickThrough(Boolean(settings.clickThrough));
updateClickThroughUI();
