const form = document.getElementById("tts-form");
const modeSingleButton = document.getElementById("mode-single");
const modeBatchButton = document.getElementById("mode-batch");
const singleEditor = document.getElementById("single-editor");
const batchEditor = document.getElementById("batch-editor");

const textInput = document.getElementById("text");
const batchTextInput = document.getElementById("batch-text");
const voiceSelect = document.getElementById("voice");
const searchInput = document.getElementById("search");
const localeInput = document.getElementById("locale");
const genderSelect = document.getElementById("gender");
const rateInput = document.getElementById("rate");
const pitchInput = document.getElementById("pitch");

const rateValue = document.getElementById("rate-value");
const pitchValue = document.getElementById("pitch-value");
const charsCount = document.getElementById("chars-count");
const estimate = document.getElementById("estimate");
const batchLines = document.getElementById("batch-lines");
const batchChars = document.getElementById("batch-chars");
const voiceSummary = document.getElementById("voice-summary");

const presetsContainer = document.getElementById("presets");
const submitButton = document.getElementById("submit");
const clearButton = document.getElementById("clear-input");
const refreshVoicesButton = document.getElementById("refresh-voices");
const resetFiltersButton = document.getElementById("reset-filters");

const statusText = document.getElementById("status");
const loadedVoices = document.getElementById("loaded-voices");
const historyCount = document.getElementById("history-count");
const totalChars = document.getElementById("total-chars");

const resultPanel = document.getElementById("result");
const resultMeta = document.getElementById("result-meta");
const audioPlayer = document.getElementById("audio-player");
const downloadLink = document.getElementById("download");
const copyLinkButton = document.getElementById("copy-link");
const waveformCanvas = document.getElementById("waveform");
const waveState = document.getElementById("wave-state");

const batchProgress = document.getElementById("batch-progress");
const batchProgressLabel = document.getElementById("batch-progress-label");
const batchProgressFill = document.getElementById("batch-progress-fill");
const batchReport = document.getElementById("batch-report");

const historyList = document.getElementById("history-list");
const clearHistoryButton = document.getElementById("clear-history");
const apiPreview = document.getElementById("api-preview");
const copyCurlButton = document.getElementById("copy-curl");

const state = {
  mode: "single",
  history: [],
  loadedVoices: [],
  currentAudioUrl: "",
  progressTimer: null,
  wave: {
    context: null,
    analyser: null,
    source: null,
    data: null,
    canvasCtx: null,
    raf: null,
    ready: false,
  },
};

const setStatus = (message, tone = "neutral") => {
  statusText.textContent = message;
  statusText.classList.remove("ok", "error");
  if (tone === "ok") {
    statusText.classList.add("ok");
  }
  if (tone === "error") {
    statusText.classList.add("error");
  }
};

const debounce = (fn, wait = 280) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

const formatRelative = (isoTime) => {
  const stamp = new Date(isoTime);
  if (Number.isNaN(stamp.getTime())) {
    return "just now";
  }

  const delta = Math.floor((Date.now() - stamp.getTime()) / 1000);
  if (delta < 45) {
    return "just now";
  }
  if (delta < 3600) {
    return `${Math.round(delta / 60)}m ago`;
  }
  if (delta < 86400) {
    return `${Math.round(delta / 3600)}h ago`;
  }
  return `${Math.round(delta / 86400)}d ago`;
};

const setWaveState = (label, tone = "") => {
  waveState.textContent = label;
  waveState.classList.remove("live", "paused", "error");
  if (tone) {
    waveState.classList.add(tone);
  }
};

const syncWaveCanvas = () => {
  if (!waveformCanvas) {
    return { width: 0, height: 0, dpr: 1 };
  }

  const dpr = window.devicePixelRatio || 1;
  const rect = waveformCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (waveformCanvas.width !== width || waveformCanvas.height !== height) {
    waveformCanvas.width = width;
    waveformCanvas.height = height;
  }

  return { width, height, dpr };
};

const clearWaveform = (label = "Idle") => {
  if (!waveformCanvas) {
    return;
  }
  const wave = state.wave;
  const { width, height, dpr } = syncWaveCanvas();
  if (!wave.canvasCtx) {
    wave.canvasCtx = waveformCanvas.getContext("2d");
  }
  if (!wave.canvasCtx) {
    return;
  }

  const ctx = wave.canvasCtx;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const baseline = Math.floor(height * 0.55);
  ctx.strokeStyle = "rgba(39, 98, 214, 0.26)";
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  ctx.moveTo(0, baseline);
  ctx.lineTo(width, baseline);
  ctx.stroke();

  setWaveState(label);
};

const ensureWavePipeline = async () => {
  const wave = state.wave;
  if (!waveformCanvas || !audioPlayer) {
    return false;
  }

  if (wave.ready) {
    return true;
  }

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    setWaveState("Unsupported", "error");
    return false;
  }

  try {
    wave.context = new AudioCtx();
    wave.analyser = wave.context.createAnalyser();
    wave.analyser.fftSize = 256;
    wave.analyser.smoothingTimeConstant = 0.82;
    wave.data = new Uint8Array(wave.analyser.frequencyBinCount);
    wave.canvasCtx = waveformCanvas.getContext("2d");

    wave.source = wave.context.createMediaElementSource(audioPlayer);
    wave.source.connect(wave.analyser);
    wave.analyser.connect(wave.context.destination);
    wave.ready = true;
    return true;
  } catch {
    setWaveState("Unavailable", "error");
    return false;
  }
};

const stopWaveform = (label = "Paused", tone = "paused") => {
  const wave = state.wave;
  if (wave.raf) {
    cancelAnimationFrame(wave.raf);
    wave.raf = null;
  }
  setWaveState(label, tone);
};

const drawWaveform = () => {
  const wave = state.wave;
  if (!wave.analyser || !wave.canvasCtx || !wave.data) {
    return;
  }

  const { width, height } = syncWaveCanvas();
  const ctx = wave.canvasCtx;

  wave.analyser.getByteFrequencyData(wave.data);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const bars = 54;
  const gap = Math.max(1, Math.floor(width / 360));
  const barWidth = Math.max(2, Math.floor((width - gap * (bars - 1)) / bars));
  const usableHeight = height - 12;
  const step = Math.max(1, Math.floor(wave.data.length / bars));

  for (let i = 0; i < bars; i += 1) {
    const sample = wave.data[i * step] || 0;
    const magnitude = sample / 255;
    const barHeight = Math.max(3, Math.floor(magnitude * usableHeight));
    const x = i * (barWidth + gap);
    const y = Math.floor((height - barHeight) / 2);

    ctx.fillStyle = i % 2 === 0 ? "rgba(218, 93, 27, 0.85)" : "rgba(39, 98, 214, 0.85)";
    ctx.fillRect(x, y, barWidth, barHeight);
  }

  wave.raf = requestAnimationFrame(drawWaveform);
};

const startWaveform = async () => {
  const wave = state.wave;
  const ready = await ensureWavePipeline();
  if (!ready || !wave.context) {
    return;
  }

  if (wave.context.state === "suspended") {
    await wave.context.resume();
  }

  if (wave.raf) {
    cancelAnimationFrame(wave.raf);
  }

  setWaveState("Live", "live");
  drawWaveform();
};

const updateSingleMetrics = () => {
  const text = textInput.value.trim();
  const chars = text.length;
  const sec = chars === 0 ? 0 : Math.max(1, Math.round(chars / 14));
  charsCount.textContent = `${chars} chars`;
  estimate.textContent = `~${sec} sec`;
};

const parseBatchLines = () => {
  return batchTextInput.value
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .slice(0, 20);
};

const updateBatchMetrics = () => {
  const rows = parseBatchLines();
  const charTotal = rows.reduce((sum, row) => sum + row.length, 0);
  batchLines.textContent = `${rows.length} lines`;
  batchChars.textContent = `${charTotal} chars`;
};

const currentPayload = () => {
  if (state.mode === "single") {
    return {
      text: textInput.value,
      voice: voiceSelect.value || undefined,
      rate: Number.parseInt(rateInput.value, 10),
      pitch: Number.parseInt(pitchInput.value, 10),
      format: "mp3",
    };
  }

  return {
    texts: parseBatchLines(),
    voice: voiceSelect.value || undefined,
    rate: Number.parseInt(rateInput.value, 10),
    pitch: Number.parseInt(pitchInput.value, 10),
    format: "mp3",
  };
};

const renderApiPreview = () => {
  const payload = currentPayload();
  if (state.mode === "single") {
    apiPreview.textContent = `curl -X POST ${window.location.origin}/api/speak \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload, null, 2)}'`;
  } else {
    apiPreview.textContent = `curl -X POST ${window.location.origin}/api/speak/batch \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(payload, null, 2)}'`;
  }
};

const applyMode = (mode) => {
  state.mode = mode;

  modeSingleButton.classList.toggle("active", mode === "single");
  modeSingleButton.setAttribute("aria-selected", mode === "single" ? "true" : "false");

  modeBatchButton.classList.toggle("active", mode === "batch");
  modeBatchButton.setAttribute("aria-selected", mode === "batch" ? "true" : "false");

  singleEditor.classList.toggle("active", mode === "single");
  batchEditor.classList.toggle("active", mode === "batch");
  submitButton.textContent = mode === "single" ? "Generate" : "Generate Batch";

  if (mode === "single") {
    batchReport.classList.add("hidden");
    batchProgress.classList.add("hidden");
  }

  renderApiPreview();
};

const buildVoiceQuery = () => {
  const params = new URLSearchParams();
  if (searchInput.value.trim()) {
    params.set("search", searchInput.value.trim());
  }
  if (localeInput.value.trim()) {
    params.set("locale", localeInput.value.trim());
  }
  if (genderSelect.value.trim()) {
    params.set("gender", genderSelect.value.trim());
  }
  params.set("limit", "300");
  return params.toString();
};

const updateVoiceSummary = () => {
  const selected = state.loadedVoices.find((voice) => voice.short_name === voiceSelect.value);
  if (!selected) {
    voiceSummary.textContent = "No voice selected.";
    return;
  }

  const gender = selected.gender ? ` • ${selected.gender}` : "";
  voiceSummary.textContent = `${selected.short_name} • ${selected.locale}${gender}`;
};

const populateVoiceSelect = (voices, preferred = "") => {
  state.loadedVoices = voices;
  voiceSelect.innerHTML = "";

  if (!voices.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No voices found";
    voiceSelect.append(option);
    updateVoiceSummary();
    return;
  }

  for (const voice of voices) {
    const option = document.createElement("option");
    option.value = voice.short_name;
    option.textContent = `${voice.short_name} · ${voice.locale}${voice.gender ? ` · ${voice.gender}` : ""}`;
    voiceSelect.append(option);
  }

  const exists = voices.some((voice) => voice.short_name === preferred);
  voiceSelect.value = exists ? preferred : voices[0].short_name;
  updateVoiceSummary();
};

const loadVoices = async () => {
  const previous = voiceSelect.value;
  const query = buildVoiceQuery();
  const url = query ? `/api/voices?${query}` : "/api/voices";

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load voices (${response.status})`);
  }

  const voices = await response.json();
  populateVoiceSelect(voices, previous);
  loadedVoices.textContent = `${voices.length} voices`;

  if (!voices.length) {
    setStatus("No voices match filters.", "error");
  } else {
    setStatus(`Loaded ${voices.length} voices.`, "ok");
  }

  renderApiPreview();
};

const renderPresets = (presets) => {
  presetsContainer.innerHTML = "";

  for (const preset of presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-chip";
    button.dataset.text = preset.text;
    button.dataset.locale = preset.locale;
    button.textContent = preset.title;
    presetsContainer.append(button);
  }
};

const loadPresets = async () => {
  const response = await fetch("/api/presets");
  if (!response.ok) {
    throw new Error("Failed to load presets");
  }

  const presets = await response.json();
  renderPresets(presets);
};

const setCurrentOutput = (item, message = "") => {
  resultPanel.classList.remove("empty");
  resultMeta.textContent = `${item.voice} · ${item.locale} · ${item.characters} chars · ${formatRelative(item.created_at)}`;
  audioPlayer.src = item.audio_url;
  downloadLink.href = item.audio_url;
  state.currentAudioUrl = new URL(item.audio_url, window.location.origin).href;
  clearWaveform("Ready");

  if (message) {
    setStatus(message, "ok");
  }
};

const stopProgressTimer = () => {
  if (state.progressTimer) {
    clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
};

const startBatchProgress = (total) => {
  stopProgressTimer();
  batchReport.classList.add("hidden");
  batchProgress.classList.remove("hidden");

  let progress = 4;
  const step = Math.max(2, Math.round(80 / Math.max(1, total * 4)));

  batchProgressFill.style.width = `${progress}%`;
  batchProgressLabel.textContent = `Processing 1/${total} lines...`;

  state.progressTimer = setInterval(() => {
    progress = Math.min(92, progress + step);
    const inferred = Math.max(1, Math.min(total, Math.round((progress / 100) * total)));
    batchProgressFill.style.width = `${progress}%`;
    batchProgressLabel.textContent = `Processing ${inferred}/${total} lines...`;
  }, 220);
};

const completeBatchProgress = (label, keepVisible = false) => {
  stopProgressTimer();
  batchProgressFill.style.width = "100%";
  batchProgressLabel.textContent = label;

  if (!keepVisible) {
    setTimeout(() => {
      batchProgress.classList.add("hidden");
    }, 900);
  }
};

const renderBatchReport = (batchResult) => {
  if (!batchResult) {
    batchReport.innerHTML = "";
    batchReport.classList.add("hidden");
    return;
  }

  const successRate = batchResult.total > 0 ? Math.round((batchResult.success / batchResult.total) * 100) : 0;

  const summary = document.createElement("p");
  summary.className = "batch-summary";
  summary.textContent = `Batch finished in ${batchResult.duration_ms}ms.`;

  const metrics = document.createElement("div");
  metrics.className = "batch-metrics";
  metrics.innerHTML = `
    <span>${batchResult.success} success</span>
    <span>${batchResult.failed} failed</span>
    <span>${successRate}% pass rate</span>
    <span>${batchResult.total} total</span>
  `;

  const meter = document.createElement("div");
  meter.className = "batch-meter";
  const meterFill = document.createElement("span");
  meterFill.className = "batch-meter-fill";
  meterFill.style.width = `${successRate}%`;
  meter.append(meterFill);

  const list = document.createElement("ul");
  list.className = "batch-list";

  for (const item of batchResult.items) {
    const li = document.createElement("li");
    li.className = "batch-item";
    li.dataset.state = item.success ? "ok" : "fail";

    const badge = document.createElement("span");
    badge.className = `badge ${item.success ? "ok" : "fail"}`;
    badge.textContent = item.success ? "OK" : "FAILED";

    const preview = document.createElement("div");
    preview.textContent = `${item.index + 1}. ${item.text_preview}`;

    li.append(badge, preview);

    if (item.success && item.result) {
      const audioLink = document.createElement("a");
      audioLink.href = item.result.audio_url;
      audioLink.download = `${item.result.id}.mp3`;
      audioLink.textContent = "Download";
      li.append(audioLink);
    }

    if (!item.success && item.error) {
      const error = document.createElement("div");
      error.textContent = item.error;
      li.append(error);
    }

    list.append(li);
  }

  batchReport.innerHTML = "";
  batchReport.append(summary, metrics, meter, list);
  batchReport.classList.remove("hidden");
};

const renderHistory = () => {
  historyList.innerHTML = "";

  if (!state.history.length) {
    const empty = document.createElement("li");
    empty.className = "history-item empty";
    empty.textContent = "No renders yet. Create your first voice clip.";
    historyList.append(empty);
    return;
  }

  for (const item of state.history) {
    const li = document.createElement("li");
    li.className = "history-item";

    const top = document.createElement("div");
    top.className = "history-top";
    const left = document.createElement("strong");
    left.textContent = item.voice;
    const right = document.createElement("span");
    right.textContent = formatRelative(item.created_at);
    top.append(left, right);

    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `${item.locale} · ${item.characters} chars · ${item.text_preview}`;

    const actions = document.createElement("div");
    actions.className = "history-actions";

    const play = document.createElement("button");
    play.type = "button";
    play.dataset.action = "play";
    play.dataset.id = item.id;
    play.textContent = "Play";

    const useText = document.createElement("button");
    useText.type = "button";
    useText.dataset.action = "use";
    useText.dataset.id = item.id;
    useText.textContent = "Use Text";

    const download = document.createElement("a");
    download.href = item.audio_url;
    download.download = `${item.id}.mp3`;
    download.textContent = "Download";

    const copy = document.createElement("button");
    copy.type = "button";
    copy.dataset.action = "copy";
    copy.dataset.id = item.id;
    copy.textContent = "Copy";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.action = "delete";
    remove.dataset.id = item.id;
    remove.textContent = "Delete";

    actions.append(play, useText, download, copy, remove);
    li.append(top, meta, actions);
    historyList.append(li);
  }
};

const loadHistory = async () => {
  const response = await fetch("/api/history?limit=20");
  if (!response.ok) {
    throw new Error("Failed to load history");
  }

  state.history = await response.json();
  renderHistory();
  historyCount.textContent = `${state.history.length} renders`;
};

const loadStats = async () => {
  const response = await fetch("/api/stats");
  if (!response.ok) {
    throw new Error("Failed to load stats");
  }

  const stats = await response.json();
  historyCount.textContent = `${stats.history_count} renders`;
  totalChars.textContent = `${stats.total_characters} chars`;
};

const copyText = async (value) => {
  await navigator.clipboard.writeText(value);
};

const generateSingle = async () => {
  const payload = currentPayload();
  if (!payload.text.trim()) {
    throw new Error("Please enter a script.");
  }

  const response = await fetch("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.detail || "Generation failed");
  }

  setCurrentOutput(data);
  renderBatchReport(null);
  batchProgress.classList.add("hidden");
  await Promise.all([loadHistory(), loadStats()]);
  setStatus(`Generated with ${data.voice}.`, "ok");
};

const generateBatch = async () => {
  const payload = currentPayload();
  if (!payload.texts.length) {
    throw new Error("Batch mode requires at least one non-empty line.");
  }

  startBatchProgress(payload.texts.length);

  const response = await fetch("/api/speak/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    completeBatchProgress("Batch failed.", true);
    throw new Error(data.detail || "Batch generation failed");
  }

  completeBatchProgress(`Completed ${data.success}/${data.total} lines.`);
  renderBatchReport(data);

  const firstSuccess = data.items.find((item) => item.success && item.result);
  if (firstSuccess?.result) {
    setCurrentOutput(firstSuccess.result);
  }

  await Promise.all([loadHistory(), loadStats()]);

  if (data.failed > 0) {
    setStatus(`Batch completed with ${data.failed} failed item(s).`, "error");
  } else {
    setStatus(`Batch completed successfully (${data.success}/${data.total}).`, "ok");
  }
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  submitButton.disabled = true;
  setStatus(state.mode === "single" ? "Generating..." : "Generating batch...");

  try {
    if (state.mode === "single") {
      await generateSingle();
    } else {
      await generateBatch();
    }
  } catch (error) {
    setStatus(error.message || "Generation failed", "error");
  } finally {
    submitButton.disabled = false;
    stopProgressTimer();
  }
});

const reloadVoicesDebounced = debounce(async () => {
  try {
    await loadVoices();
  } catch (error) {
    setStatus(error.message || "Voice load failed", "error");
  }
});

modeSingleButton.addEventListener("click", () => applyMode("single"));
modeBatchButton.addEventListener("click", () => applyMode("batch"));

textInput.addEventListener("input", () => {
  updateSingleMetrics();
  renderApiPreview();
});

batchTextInput.addEventListener("input", () => {
  updateBatchMetrics();
  renderApiPreview();
});

rateInput.addEventListener("input", () => {
  rateValue.textContent = `${rateInput.value}%`;
  renderApiPreview();
});

pitchInput.addEventListener("input", () => {
  pitchValue.textContent = `${pitchInput.value}Hz`;
  renderApiPreview();
});

voiceSelect.addEventListener("change", () => {
  updateVoiceSummary();
  renderApiPreview();
});
searchInput.addEventListener("input", reloadVoicesDebounced);
localeInput.addEventListener("input", reloadVoicesDebounced);
genderSelect.addEventListener("change", reloadVoicesDebounced);

refreshVoicesButton.addEventListener("click", async () => {
  refreshVoicesButton.disabled = true;
  try {
    await loadVoices();
  } catch (error) {
    setStatus(error.message || "Voice refresh failed", "error");
  } finally {
    refreshVoicesButton.disabled = false;
  }
});

resetFiltersButton.addEventListener("click", async () => {
  searchInput.value = "";
  localeInput.value = "";
  genderSelect.value = "";

  try {
    await loadVoices();
    setStatus("Voice filters reset.", "ok");
  } catch (error) {
    setStatus(error.message || "Reset failed", "error");
  }
});

clearButton.addEventListener("click", () => {
  if (state.mode === "single") {
    textInput.value = "";
    updateSingleMetrics();
  } else {
    batchTextInput.value = "";
    updateBatchMetrics();
  }
  renderApiPreview();
  setStatus("Input cleared.", "ok");
});

presetsContainer.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.classList.contains("preset-chip")) {
    return;
  }

  const presetText = target.dataset.text || "";
  const presetLocale = target.dataset.locale || "";

  if (state.mode === "single") {
    textInput.value = presetText;
    updateSingleMetrics();
  } else {
    const current = batchTextInput.value.trim();
    batchTextInput.value = current ? `${current}\n${presetText}` : presetText;
    updateBatchMetrics();
  }

  if (presetLocale) {
    localeInput.value = presetLocale;
    try {
      await loadVoices();
    } catch (error) {
      setStatus(error.message || "Voice refresh failed", "error");
    }
  }

  renderApiPreview();
  setStatus(`Preset loaded: ${target.textContent || "template"}.`, "ok");
});

historyList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.dataset.action;
  const itemId = target.dataset.id;
  if (!action || !itemId) {
    return;
  }

  const item = state.history.find((entry) => entry.id === itemId);
  if (!item) {
    setStatus("History item not found.", "error");
    return;
  }

  if (action === "play") {
    setCurrentOutput(item, "Loaded from history.");
    return;
  }

  if (action === "use") {
    if (state.mode === "single") {
      textInput.value = item.text_preview;
      updateSingleMetrics();
    } else {
      const current = batchTextInput.value.trim();
      batchTextInput.value = current ? `${current}\n${item.text_preview}` : item.text_preview;
      updateBatchMetrics();
    }
    renderApiPreview();
    setStatus("History preview inserted into editor.", "ok");
    return;
  }

  if (action === "copy") {
    try {
      await copyText(new URL(item.audio_url, window.location.origin).href);
      setStatus("Audio link copied.", "ok");
    } catch {
      setStatus("Copy failed.", "error");
    }
    return;
  }

  if (action === "delete") {
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(itemId)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "Delete failed");
      }
      await Promise.all([loadHistory(), loadStats()]);
      setStatus("History item deleted.", "ok");
    } catch (error) {
      setStatus(error.message || "Delete failed", "error");
    }
  }
});

clearHistoryButton.addEventListener("click", async () => {
  if (!state.history.length) {
    setStatus("History is already empty.", "ok");
    return;
  }

  clearHistoryButton.disabled = true;
  try {
    const response = await fetch("/api/history", { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || "Clear failed");
    }

    await Promise.all([loadHistory(), loadStats()]);
    resultPanel.classList.add("empty");
    resultMeta.textContent = "Generate audio to preview here.";
    audioPlayer.removeAttribute("src");
    audioPlayer.load();
    state.currentAudioUrl = "";
    renderBatchReport(null);
    batchProgress.classList.add("hidden");
    clearWaveform("Idle");
    setStatus(`Cleared ${payload.removed} history item(s).`, "ok");
  } catch (error) {
    setStatus(error.message || "Clear failed", "error");
  } finally {
    clearHistoryButton.disabled = false;
  }
});

copyLinkButton.addEventListener("click", async () => {
  if (!state.currentAudioUrl) {
    setStatus("No active output to copy.", "error");
    return;
  }

  try {
    await copyText(state.currentAudioUrl);
    setStatus("Output link copied.", "ok");
  } catch {
    setStatus("Copy failed.", "error");
  }
});

copyCurlButton.addEventListener("click", async () => {
  try {
    await copyText(apiPreview.textContent || "");
    setStatus("cURL copied.", "ok");
  } catch {
    setStatus("Copy failed.", "error");
  }
});

audioPlayer.addEventListener("play", () => {
  void startWaveform();
});

audioPlayer.addEventListener("pause", () => {
  stopWaveform("Paused", "paused");
});

audioPlayer.addEventListener("ended", () => {
  stopWaveform("Ended", "paused");
});

audioPlayer.addEventListener("emptied", () => {
  stopWaveform("Idle");
  clearWaveform("Idle");
});

audioPlayer.addEventListener("error", () => {
  stopWaveform("Error", "error");
});

window.addEventListener("resize", () => {
  if (!state.wave.ready || state.wave.raf) {
    return;
  }
  clearWaveform("Ready");
});

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    if (!submitButton.disabled) {
      form.requestSubmit();
    }
  }
});

const initialize = async () => {
  updateSingleMetrics();
  updateBatchMetrics();
  renderApiPreview();
  clearWaveform("Idle");

  try {
    await Promise.all([loadPresets(), loadVoices(), loadHistory(), loadStats()]);
    if (state.history.length) {
      setCurrentOutput(state.history[0]);
    }
    setStatus("Studio ready.", "ok");
  } catch (error) {
    setStatus(error.message || "Failed to initialize", "error");
  }
};

initialize();
