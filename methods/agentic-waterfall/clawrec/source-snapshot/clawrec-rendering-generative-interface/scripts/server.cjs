"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const fsp = fs.promises;

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const CONTENT_MARKER = "<!-- CONTENT_SLOT -->";
const WATCH_DEBOUNCE_MS = 150;
const LIFECYCLE_CHECK_MS = 60_000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MIME_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

const scriptDir = __dirname;
const contentDir = path.resolve(readRequiredEnv("SCREEN_DIR"));
const stateDir = path.resolve(readRequiredEnv("STATE_DIR"));
const assetsDir = path.join(contentDir, "assets");
const serverInfoPath = path.join(stateDir, "server-info");
const serverStoppedPath = path.join(stateDir, "server-stopped");
const eventsPath = path.join(stateDir, "events");
const serverPidPath = path.join(stateDir, "server.pid");
const bindHost = process.env.HOST || "127.0.0.1";
const urlHost = process.env.URL_HOST || bindHost;
const bindPort = Number.parseInt(process.env.PORT || "0", 10) || 0;
const ownerPid = parsePositiveInteger(process.env.OWNER_PID);
const templatePath = path.join(scriptDir, "frame-template.html");
const helperPath = path.join(scriptDir, "helper.js");

let templateHtml = "";
let helperSource = "";
let knownScreens = new Set();
let watcher = null;
let shuttingDown = false;
let activeOwnerPid = ownerPid;
let lastActivityAt = Date.now();
let lifecycleTimer = null;
let eventWriteChain = Promise.resolve();

const debounceTimers = new Map();
const sockets = new Set();

function readRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error("Missing required environment variable: " + name);
  }
  return value;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function now() {
  return Date.now();
}

function jsonLine(value) {
  return JSON.stringify(value) + "\n";
}

function logRecord(record) {
  process.stdout.write(jsonLine(record));
}

function updateActivity() {
  lastActivityAt = now();
}

function placeholderFragment() {
  return [
    '<section class="section empty-state">',
    '  <p class="label">Awaiting content</p>',
    "  <h2>No recommendation fragment has been written yet.</h2>",
    "  <p>Write a structural HTML fragment into the session content directory to populate this view. New filenames reset the interaction log, while updates to an existing filename keep it.</p>",
    "</section>"
  ].join("\n");
}

async function listHtmlScreens() {
  const entries = await fsp.readdir(contentDir, { withFileTypes: true });
  const screens = [];

  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".html") {
      continue;
    }

    const fullPath = path.join(contentDir, entry.name);
    const stats = await fsp.stat(fullPath);
    screens.push({
      fullPath,
      name: entry.name,
      mtimeMs: stats.mtimeMs
    });
  }

  screens.sort((left, right) => {
    if (right.mtimeMs !== left.mtimeMs) {
      return right.mtimeMs - left.mtimeMs;
    }
    return left.name.localeCompare(right.name);
  });

  return screens;
}

async function readActiveFragment() {
  const screens = await listHtmlScreens();
  if (screens.length === 0) {
    return placeholderFragment();
  }

  return fsp.readFile(screens[0].fullPath, "utf8");
}

function composePage(fragment) {
  return templateHtml.replace(CONTENT_MARKER, fragment);
}

function sendResponse(response, statusCode, headers, body) {
  response.writeHead(statusCode, headers);
  response.end(body);
}

function contentTypeForExtension(extension) {
  return MIME_TYPES[extension.toLowerCase()] || "application/octet-stream";
}

function isPathInside(parentPath, childPath) {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function serveRoot(response) {
  updateActivity();
  const fragment = await readActiveFragment();
  const html = composePage(fragment);
  sendResponse(
    response,
    200,
    {
      "cache-control": "no-store",
      "content-type": "text/html; charset=utf-8"
    },
    html
  );
}

function serveHelper(response) {
  sendResponse(
    response,
    200,
    {
      "cache-control": "no-store",
      "content-type": contentTypeForExtension(".js")
    },
    helperSource
  );
}

async function serveAsset(response, requestPath) {
  let decodedPath;

  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch (_error) {
    sendResponse(response, 400, { "content-type": "text/plain; charset=utf-8" }, "Bad asset path");
    return;
  }

  const assetPath = path.resolve(assetsDir, decodedPath.replace(/^\/+/, ""));
  if (!isPathInside(assetsDir, assetPath)) {
    sendResponse(response, 404, { "content-type": "text/plain; charset=utf-8" }, "Not found");
    return;
  }

  let stats;
  try {
    stats = await fsp.stat(assetPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      sendResponse(response, 404, { "content-type": "text/plain; charset=utf-8" }, "Not found");
      return;
    }
    throw error;
  }

  if (!stats.isFile()) {
    sendResponse(response, 404, { "content-type": "text/plain; charset=utf-8" }, "Not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": contentTypeForExtension(path.extname(assetPath))
  });
  fs.createReadStream(assetPath).pipe(response);
}

async function handleHttpRequest(request, response) {
  if (request.method !== "GET") {
    sendResponse(response, 404, { "content-type": "text/plain; charset=utf-8" }, "Not found");
    return;
  }

  const url = new URL(request.url || "/", "http://localhost");
  const pathname = url.pathname;

  try {
    if (pathname === "/") {
      await serveRoot(response);
      return;
    }

    if (pathname === "/helper.js") {
      serveHelper(response);
      return;
    }

    if (pathname.startsWith("/files/assets/")) {
      await serveAsset(response, pathname.slice("/files/assets/".length));
      return;
    }

    sendResponse(response, 404, { "content-type": "text/plain; charset=utf-8" }, "Not found");
  } catch (error) {
    logRecord({
      type: "server-error",
      message: error instanceof Error ? error.message : String(error),
      phase: "http-request",
      timestamp: now()
    });
    sendResponse(response, 500, { "content-type": "text/plain; charset=utf-8" }, "Internal server error");
  }
}

function createWebSocketAccept(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

function isValidWebSocketKey(key) {
  if (typeof key !== "string") {
    return false;
  }

  try {
    return Buffer.from(key, "base64").length === 16;
  } catch (_error) {
    return false;
  }
}

function sendWebSocketFrame(socket, opcode, payload) {
  const message = payload || Buffer.alloc(0);
  let header;

  if (message.length < 126) {
    header = Buffer.alloc(2);
    header[1] = message.length;
  } else if (message.length < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(message.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(message.length, 6);
  }

  header[0] = 0x80 | opcode;
  socket.write(Buffer.concat([header, message]));
}

function closeSocket(socket, code, reason) {
  if (socket.destroyed || socket._wsClosing) {
    return;
  }

  socket._wsClosing = true;
  const reasonBuffer = Buffer.from(reason || "", "utf8");
  const payload = Buffer.alloc(2 + reasonBuffer.length);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  sendWebSocketFrame(socket, 0x8, payload);
  socket.end();
}

async function appendEventRecord(eventObject) {
  eventWriteChain = eventWriteChain.then(() => fsp.appendFile(eventsPath, jsonLine(eventObject), "utf8"));
  await eventWriteChain;
}

async function handleBrowserTextMessage(socket, text) {
  updateActivity();

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_error) {
    closeSocket(socket, 1007, "Invalid JSON");
    return;
  }

  logRecord({
    type: "browser-event",
    event: payload,
    timestamp: now()
  });

  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    await appendEventRecord(payload);
  }
}

function sendReloadMessage(socket) {
  sendWebSocketFrame(socket, 0x1, Buffer.from(JSON.stringify({ type: "reload" }), "utf8"));
}

function broadcastReload() {
  for (const socket of sockets) {
    if (socket.destroyed) {
      continue;
    }
    sendReloadMessage(socket);
  }
}

async function processWebSocketFrame(socket, frame) {
  switch (frame.opcode) {
    case 0x1:
      await handleBrowserTextMessage(socket, frame.payload.toString("utf8"));
      return;
    case 0x8:
      socket._wsClosing = true;
      sendWebSocketFrame(socket, 0x8, frame.payload);
      socket.end();
      return;
    case 0x9:
      sendWebSocketFrame(socket, 0xA, frame.payload);
      return;
    case 0xA:
      return;
    default:
      closeSocket(socket, 1003, "Unsupported opcode");
  }
}

function extractFrames(socket, incomingChunk) {
  socket._wsBuffer = Buffer.concat([socket._wsBuffer, incomingChunk]);

  while (socket._wsBuffer.length >= 2) {
    const firstByte = socket._wsBuffer[0];
    const secondByte = socket._wsBuffer[1];
    const finalFrame = (firstByte & 0x80) === 0x80;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) === 0x80;
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (!finalFrame) {
      closeSocket(socket, 1003, "Fragmentation unsupported");
      return [];
    }

    if (!masked) {
      closeSocket(socket, 1002, "Client frames must be masked");
      return [];
    }

    if (payloadLength === 126) {
      if (socket._wsBuffer.length < offset + 2) {
        break;
      }
      payloadLength = socket._wsBuffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (socket._wsBuffer.length < offset + 8) {
        break;
      }

      const highBits = socket._wsBuffer.readUInt32BE(offset);
      const lowBits = socket._wsBuffer.readUInt32BE(offset + 4);
      if (highBits !== 0) {
        closeSocket(socket, 1009, "Frame too large");
        return [];
      }

      payloadLength = lowBits;
      offset += 8;
    }

    if (socket._wsBuffer.length < offset + 4 + payloadLength) {
      break;
    }

    const mask = socket._wsBuffer.subarray(offset, offset + 4);
    offset += 4;

    const maskedPayload = socket._wsBuffer.subarray(offset, offset + payloadLength);
    const payload = Buffer.alloc(payloadLength);
    for (let index = 0; index < payloadLength; index += 1) {
      payload[index] = maskedPayload[index] ^ mask[index % 4];
    }

    socket._wsBuffer = socket._wsBuffer.subarray(offset + payloadLength);
    socket._wsFrames.push({ opcode, payload });
  }

  const frames = socket._wsFrames;
  socket._wsFrames = [];
  return frames;
}

function pidExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === "EPERM") {
      return true;
    }
    return false;
  }
}

async function writeStoppedRecord(reason) {
  const stopRecord = {
    reason,
    timestamp: now()
  };

  await fsp.writeFile(serverStoppedPath, jsonLine(stopRecord), "utf8");
}

async function shutdown(server, reason) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  if (lifecycleTimer !== null) {
    clearInterval(lifecycleTimer);
    lifecycleTimer = null;
  }

  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();

  logRecord({
    type: "server-stopping",
    reason,
    timestamp: now()
  });

  if (watcher) {
    watcher.close();
    watcher = null;
  }

  for (const socket of sockets) {
    closeSocket(socket, 1001, "Server stopping");
  }

  await Promise.allSettled([
    fsp.rm(serverInfoPath, { force: true }),
    fsp.rm(serverPidPath, { force: true }),
    writeStoppedRecord(reason)
  ]);

  await new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(resolve, 1000).unref();
  });

  process.exit(0);
}

async function checkLifecycle(server) {
  if (shuttingDown) {
    return;
  }

  if (activeOwnerPid !== null && !pidExists(activeOwnerPid)) {
    await shutdown(server, "owner-exited");
    return;
  }

  if (now() - lastActivityAt >= IDLE_TIMEOUT_MS) {
    await shutdown(server, "idle-timeout");
  }
}

function scheduleScreenReaction(server, filename) {
  const existingTimer = debounceTimers.get(filename);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(async () => {
    debounceTimers.delete(filename);
    const filePath = path.join(contentDir, filename);

    let stats;
    try {
      stats = await fsp.stat(filePath);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    if (!stats.isFile() || path.extname(filename).toLowerCase() !== ".html") {
      return;
    }

    updateActivity();

    if (!knownScreens.has(filename)) {
      knownScreens.add(filename);
      await fsp.rm(eventsPath, { force: true });
      logRecord({
        type: "screen-added",
        file: filename,
        timestamp: now()
      });
      broadcastReload();
      return;
    }

    logRecord({
      type: "screen-updated",
      file: filename,
      timestamp: now()
    });
    broadcastReload();
  }, WATCH_DEBOUNCE_MS);

  debounceTimers.set(filename, timer);
}

function attachWatcher(server) {
  watcher = fs.watch(contentDir, (eventType, rawFilename) => {
    const filename = Buffer.isBuffer(rawFilename) ? rawFilename.toString("utf8") : rawFilename;
    if (!filename || path.extname(filename).toLowerCase() !== ".html") {
      return;
    }

    scheduleScreenReaction(server, filename);
  });

  watcher.on("error", (error) => {
    logRecord({
      type: "server-error",
      message: error.message,
      phase: "content-watch",
      timestamp: now()
    });
  });
}

async function bootstrap() {
  templateHtml = await fsp.readFile(templatePath, "utf8");
  helperSource = await fsp.readFile(helperPath, "utf8");
  knownScreens = new Set((await listHtmlScreens()).map((screen) => screen.name));

  if (activeOwnerPid !== null && !pidExists(activeOwnerPid)) {
    logRecord({
      type: "owner-pid-rejected",
      owner_pid: activeOwnerPid,
      timestamp: now()
    });
    activeOwnerPid = null;
  }

  const server = http.createServer((request, response) => {
    void handleHttpRequest(request, response);
  });

  server.on("upgrade", (request, socket) => {
    const websocketKey = request.headers["sec-websocket-key"];
    const websocketVersion = request.headers["sec-websocket-version"];

    if (websocketVersion !== "13" || !isValidWebSocketKey(websocketKey)) {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    const acceptKey = createWebSocketAccept(websocketKey);
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Accept: " + acceptKey,
        "\r\n"
      ].join("\r\n")
    );

    socket._wsBuffer = Buffer.alloc(0);
    socket._wsFrames = [];
    socket._wsClosing = false;
    sockets.add(socket);

    socket.on("data", (chunk) => {
      const frames = extractFrames(socket, chunk);
      for (const frame of frames) {
        void processWebSocketFrame(socket, frame).catch((error) => {
          logRecord({
            type: "server-error",
            message: error instanceof Error ? error.message : String(error),
            phase: "websocket-frame",
            timestamp: now()
          });
          closeSocket(socket, 1011, "Internal server error");
        });
      }
    });

    socket.on("close", () => {
      sockets.delete(socket);
    });

    socket.on("end", () => {
      sockets.delete(socket);
    });

    socket.on("error", () => {
      sockets.delete(socket);
    });
  });

  process.on("SIGINT", () => {
    void shutdown(server, "signal-int");
  });

  process.on("SIGTERM", () => {
    void shutdown(server, "signal-term");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(bindPort, bindHost, resolve);
  });

  attachWatcher(server);
  lifecycleTimer = setInterval(() => {
    void checkLifecycle(server);
  }, LIFECYCLE_CHECK_MS);
  lifecycleTimer.unref();

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : bindPort;
  const startupRecord = {
    type: "server-started",
    port,
    host: bindHost,
    url_host: urlHost,
    url: "http://" + urlHost + ":" + port + "/",
    screen_dir: contentDir,
    state_dir: stateDir
  };

  await fsp.writeFile(serverInfoPath, jsonLine(startupRecord), "utf8");
  logRecord(startupRecord);
}

void bootstrap().catch(async (error) => {
  logRecord({
    type: "server-error",
    message: error instanceof Error ? error.message : String(error),
    phase: "bootstrap",
    timestamp: now()
  });

  try {
    await fsp.rm(serverInfoPath, { force: true });
  } catch (_ignored) {
    // Ignore cleanup failures during bootstrap termination.
  }

  process.exit(1);
});
