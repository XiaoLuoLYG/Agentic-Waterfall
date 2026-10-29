(function initializeRenderingDisplay() {
  "use strict";

  var reloadMessageType = "reload";
  var reconnectDelayMs = 1000;
  var outboundQueue = [];
  var socket = null;
  var reconnectTimer = null;

  function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function socketUrl() {
    var protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + window.location.host;
  }

  function flushQueue() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    while (outboundQueue.length > 0) {
      socket.send(outboundQueue.shift());
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer !== null) {
      return;
    }

    reconnectTimer = window.setTimeout(function reconnect() {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  }

  function handleServerMessage(event) {
    var payload;

    try {
      payload = JSON.parse(event.data);
    } catch (_error) {
      return;
    }

    if (payload && payload.type === reloadMessageType) {
      window.location.reload();
    }
  }

  function connect() {
    socket = new WebSocket(socketUrl());

    socket.addEventListener("open", flushQueue);
    socket.addEventListener("message", handleServerMessage);
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", function handleError() {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    });
  }

  function enqueueEvent(eventObject) {
    if (!isPlainObject(eventObject)) {
      throw new TypeError("window.renderingDisplay.send expects a JSON object");
    }

    var payload = Object.assign({}, eventObject, { timestamp: Date.now() });
    var serialized = JSON.stringify(payload);

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(serialized);
      return;
    }

    outboundQueue.push(serialized);
  }

  function deriveTopic(card) {
    var section = card.closest(".section");
    if (!section) {
      return null;
    }

    var heading = section.querySelector("h2");
    var topic = normalizeWhitespace(heading ? heading.textContent : "");
    return topic || null;
  }

  function deriveSource(card) {
    var source = normalizeWhitespace(card.getAttribute("data-source") || "");
    if (source) {
      return source;
    }

    var label = card.querySelector(".label");
    source = normalizeWhitespace(label ? label.textContent : "");
    return source || null;
  }

  function deriveText(card) {
    var heading = card.querySelector("h3");
    var text = normalizeWhitespace(heading ? heading.textContent : "");
    if (text) {
      return text;
    }

    text = normalizeWhitespace(card.textContent);
    return text || null;
  }

  document.addEventListener("click", function handleCardClick(event) {
    if (!(event.target instanceof Element)) {
      return;
    }

    var card = event.target.closest("a.card[href]");
    if (!card) {
      return;
    }

    enqueueEvent({
      type: "link-click",
      href: card.href,
      text: deriveText(card),
      source: deriveSource(card),
      topic: deriveTopic(card),
      cardId: card.getAttribute("data-card-id") || null,
      external: true
    });
  });

  window.renderingDisplay = {
    send: enqueueEvent
  };

  connect();
})();
