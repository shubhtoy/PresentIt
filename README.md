# Presenter Overlay

A minimal Electron presenter overlay that listens to a Flespi MQTT topic and renders incoming markdown as a live, scrollable message timeline.

## Features

- Transparent, always-on-top presenter overlay
- Best-effort content protection for screen capture paths
- Flespi MQTT over secure WebSocket (`wss://mqtt.flespi.io:443`)
- Rich markdown rendering with syntax-highlighted code blocks
- Session message history with timestamps
- Runtime controls for position, opacity, text size, lock, and click-through
- Local persistence of UI/source settings using browser local storage

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Run the app

```bash
npm start
```

### 3. Connect to Flespi

In the Source panel:

- Flespi token: your token with MQTT access
- MQTT topic: any topic you want (example: `overlay/presenter/markdown`)

Then click Connect.

## Publish Message Format

Publish plain markdown payloads to the same topic.

Example:

````md
## Demo Update

This is **live** markdown from MQTT.

```js
const status = "ok";
console.log(status);
```

- [x] Topic connected
- [ ] Next slide
````

## Shortcuts

- Toggle controls: `Escape`
- Show controls: `Cmd/Ctrl + ;`
- Toggle click-through: `Cmd/Ctrl + Shift + .`
- Nudge overlay: arrow keys (`Shift` for larger step)

## Project Structure

- `src/main.js`: Electron main process, window lifecycle, MQTT client, markdown sanitize pipeline
- `src/preload.js`: safe IPC bridge to renderer
- `src/renderer/index.html`: overlay layout
- `src/renderer/index.js`: renderer interactions, state persistence, message timeline
- `src/renderer/styles.css`: UI and responsive styles

## Contributing

### Local Workflow

1. Install dependencies with `npm install`.
2. Start the app with `npm start`.
3. Make focused changes in small commits.

### Before Opening a PR

1. Run syntax checks:

```bash
node --check src/main.js
node --check src/preload.js
node --check src/renderer/index.js
```

2. Manually verify key behavior:
	- MQTT connect and reconnect states
	- Markdown rendering (including fenced code blocks)
	- Message timeline scrolling and new-message pin behavior
	- Side panel responsiveness on smaller sizes
	- Click-through toggle shortcut (`Cmd/Ctrl + Shift + .`)

### Commit Guidance

- Use short, imperative commit messages.
- Keep unrelated refactors out of feature/fix commits.
- Preserve existing style conventions (2-space indentation, LF endings).

## Notes

- "Hidden from all screen sharing tools" is not guaranteed by any app stack. This project uses Electron best-effort content protection.
- Settings are intentionally local and lightweight (stored in local storage for convenience).

## License

MIT
