// ===== STATE =====
let currentUser = null;
let translationHistory = JSON.parse(localStorage.getItem("transHistory") || "[]");
let cameraStream = null;

// ===== INIT =====
document.addEventListener("DOMContentLoaded", () => {
  renderHistory();
  updateWordCount();
  // Auto-translate on paste
  document.getElementById("inputText").addEventListener("paste", () => {
    setTimeout(translateText, 300);
  });
});

// ===== CORE TRANSLATION =====
async function translateText() {
  const text = document.getElementById("inputText").value.trim();
  if (!text) { showToast("Enter text first"); return; }

  const source = document.getElementById("sourceLang").value;
  const target = document.getElementById("targetLang").value;

  // Loading state
  document.getElementById("translateLabel").style.display = "none";
  document.getElementById("translateSpinner").style.display = "inline";

  try {
    const res = await fetch("/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source, target })
    });
    const data = await res.json();

    if (data.error) { showToast("Error: " + data.error, true); return; }

    document.getElementById("outputText").value = data.translated_text;

    // Show detected language
    if (data.detected_language) {
      const langNames = getLangNames();
      const detected = langNames[data.detected_language] || data.detected_language.toUpperCase();
      document.getElementById("detectedText").textContent = "Detected: " + detected;
      document.getElementById("detectedBanner").style.display = "block";
    }

    // Save to history
    const entry = {
      original: text,
      translated: data.translated_text,
      from: source === "auto" ? data.detected_language : source,
      to: target,
      time: new Date().toLocaleTimeString()
    };
    addToHistory(entry);

    // Save for logged-in user
    if (currentUser) {
      fetch("/save_history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry })
      });
    }

  } catch (e) {
    showToast("Network error", true);
  } finally {
    document.getElementById("translateLabel").style.display = "inline";
    document.getElementById("translateSpinner").style.display = "none";
  }
}

// ===== VOICE INPUT =====
function startVoiceInput() {
  if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
    showToast("Voice not supported in this browser", true);
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SR();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onresult = (e) => {
    document.getElementById("inputText").value = e.results[0][0].transcript;
    updateWordCount();
    translateText();
  };

  recognition.onerror = () => showToast("Voice input failed", true);
  recognition.start();
  showToast("🎤 Listening...");
}

// ===== VOICE SPEED TTS =====
async function speakText() {
  const text = document.getElementById("outputText").value.trim();
  const lang = document.getElementById("targetLang").value;
  const speed = parseFloat(document.getElementById("voiceSpeed").value);

  if (!text) { showToast("Translate something first"); return; }

  try {
    const res = await fetch("/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, lang, speed })
    });
    const data = await res.json();
    if (data.error) { showToast(data.error, true); return; }

    const audio = new Audio(data.audio + "?t=" + Date.now());
    audio.playbackRate = speed;
    audio.play();
  } catch (e) {
    showToast("Speech error", true);
  }
}

function updateSpeedLabel() {
  const val = parseFloat(document.getElementById("voiceSpeed").value).toFixed(1);
  document.getElementById("speedLabel").textContent = val + "x";
}

// ===== AI GRAMMAR CORRECTION =====
async function correctGrammar() {
  const text = document.getElementById("inputText").value.trim();
  if (!text) { showToast("Enter text first"); return; }

  showToast("✨ Correcting grammar...");

  try {
    const res = await fetch("/correct", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (data.corrected) {
      document.getElementById("inputText").value = data.corrected;
      updateWordCount();
      showToast("Grammar corrected!");
    }
  } catch (e) {
    showToast("Grammar correction failed", true);
  }
}

// ===== PDF TRANSLATION =====
function openPDF() {
  document.getElementById("pdfModal").style.display = "flex";
}
function closePDF() {
  document.getElementById("pdfModal").style.display = "none";
  // Reset
  document.getElementById("pdfStatus").style.display = "none";
  document.getElementById("pdfResult").style.display = "none";
  document.getElementById("pdfDownload").style.display = "none";
  document.getElementById("pdfFile").value = "";
}

async function handlePDFSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const target = document.getElementById("targetLang").value;
  const status = document.getElementById("pdfStatus");
  const statusText = document.getElementById("pdfStatusText");
  const progress = document.getElementById("pdfProgress");

  status.style.display = "block";
  statusText.textContent = "Uploading PDF...";
  progress.style.width = "20%";

  const formData = new FormData();
  formData.append("pdf", file);
  formData.append("target", target);

  try {
    statusText.textContent = "Extracting text...";
    progress.style.width = "50%";

    const res = await fetch("/translate_pdf", { method: "POST", body: formData });
    progress.style.width = "90%";

    const data = await res.json();
    progress.style.width = "100%";

    if (data.error) {
      statusText.textContent = "Error: " + data.error;
      return;
    }

    statusText.textContent = `Done! Translated ${data.original_length} characters.`;

    const resultArea = document.getElementById("pdfResult");
    resultArea.value = data.translated_text;
    resultArea.style.display = "block";
    document.getElementById("pdfDownload").style.display = "block";

  } catch (e) {
    statusText.textContent = "Failed: " + e.message;
  }
}

function downloadPDFResult() {
  const text = document.getElementById("pdfResult").value;
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pdf_translation.txt";
  a.click();
}

// ===== CAMERA TRANSLATION =====
function openCamera() {
  document.getElementById("cameraModal").style.display = "flex";
  startCamera();
}

function closeCamera() {
  document.getElementById("cameraModal").style.display = "none";
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  document.getElementById("cameraResult").style.display = "none";
}

async function startCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    document.getElementById("cameraFeed").srcObject = cameraStream;
  } catch (e) {
    showToast("Camera not available", true);
  }
}

function captureImage() {
  const video = document.getElementById("cameraFeed");
  const canvas = document.getElementById("cameraCanvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  processImageForOCR(canvas.toDataURL("image/jpeg"));
}

function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => processImageForOCR(ev.target.result);
  reader.readAsDataURL(file);
}

async function processImageForOCR(imageData) {
  showToast("📷 Extracting text from image...");

  // Use Tesseract.js via CDN for OCR
  if (!window.Tesseract) {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = () => runOCR(imageData);
    document.head.appendChild(script);
  } else {
    runOCR(imageData);
  }
}

async function runOCR(imageData) {
  try {
    const { createWorker } = Tesseract;
    const worker = await createWorker("eng");
    const { data: { text } } = await worker.recognize(imageData);
    await worker.terminate();

    if (text.trim()) {
      document.getElementById("inputText").value = text.trim();
      updateWordCount();
      document.getElementById("extractedText").textContent = "Extracted: " + text.trim().substring(0, 100) + "...";
      document.getElementById("cameraResult").style.display = "block";
      closeCamera();
      translateText();
    } else {
      showToast("No text found in image", true);
    }
  } catch (e) {
    showToast("OCR failed: " + e.message, true);
  }
}

// ===== AUTH =====
function openAuth() {
  document.getElementById("authModal").style.display = "flex";
  document.getElementById("authMsg").textContent = "";
}

function closeAuth() {
  document.getElementById("authModal").style.display = "none";
}

function switchAuthTab(tab) {
  document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
  event.target.classList.add("active");
  document.getElementById("loginForm").style.display = tab === "login" ? "block" : "none";
  document.getElementById("registerForm").style.display = tab === "register" ? "block" : "none";
  document.getElementById("authMsg").textContent = "";
}

async function doLogin() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  if (!username || !password) {
    showAuthMsg("Enter username and password", true);
    return;
  }
  const res = await fetch("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (data.error) { showAuthMsg(data.error, true); return; }

  currentUser = data.username;
  closeAuth();
  updateUserUI();
  if (data.history) {
    translationHistory = data.history;
    renderHistory();
  }
  showToast("Welcome back, " + data.username + "!");
}

async function doRegister() {
  const username = document.getElementById("regUsername").value.trim();
  const password = document.getElementById("regPassword").value.trim();
  if (!username || !password) {
    showAuthMsg("Enter username and password", true);
    return;
  }
  const res = await fetch("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (data.error) { showAuthMsg(data.error, true); return; }

  currentUser = data.username;
  closeAuth();
  updateUserUI();
  showToast("Account created! Welcome, " + data.username + "!");
}

async function doLogout() {
  await fetch("/logout", { method: "POST" });
  currentUser = null;
  translationHistory = [];
  updateUserUI();
  renderHistory();
  showToast("Logged out");
}

function showAuthMsg(msg, isError) {
  const el = document.getElementById("authMsg");
  el.textContent = msg;
  el.className = "auth-msg" + (isError ? " error" : "");
}

function updateUserUI() {
  const area = document.getElementById("userArea");
  if (currentUser) {
    area.innerHTML = `
      <div class="user-badge">
        👤 ${currentUser}
        <button onclick="doLogout()">Logout</button>
      </div>`;
  } else {
    area.innerHTML = `<button class="glass-btn small" onclick="openAuth()">Login</button>`;
  }
}

// ===== THEME =====
function toggleTheme() {
  document.body.classList.toggle("light-theme");
  document.body.classList.toggle("dark-theme");
  const isLight = document.body.classList.contains("light-theme");
  document.querySelector(".icon-btn[onclick='toggleTheme()']").textContent = isLight ? "☀️" : "🌙";
  localStorage.setItem("theme", isLight ? "light" : "dark");
}

// Load saved theme
if (localStorage.getItem("theme") === "light") {
  document.body.classList.remove("dark-theme");
  document.body.classList.add("light-theme");
}

// ===== UTILITIES =====
function updateWordCount() {
  const text = document.getElementById("inputText").value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  document.getElementById("wordCount").textContent = words + " words";
  document.getElementById("charCount").textContent = text.length + " chars";
}

function clearInput() {
  document.getElementById("inputText").value = "";
  document.getElementById("outputText").value = "";
  document.getElementById("detectedBanner").style.display = "none";
  updateWordCount();
}

function copyText() {
  const text = document.getElementById("outputText").value;
  if (!text) { showToast("Nothing to copy"); return; }
  navigator.clipboard.writeText(text);
  showToast("Copied to clipboard!");
}

function downloadText() {
  const text = document.getElementById("outputText").value;
  if (!text) { showToast("Nothing to download"); return; }
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "translation.txt";
  a.click();
}

function swapLanguages() {
  const src = document.getElementById("sourceLang");
  const tgt = document.getElementById("targetLang");
  const temp = src.value;
  src.value = tgt.value === "auto" ? "en" : tgt.value;
  tgt.value = temp === "auto" ? "en" : temp;

  // Also swap text
  const srcText = document.getElementById("inputText").value;
  const tgtText = document.getElementById("outputText").value;
  if (tgtText) {
    document.getElementById("inputText").value = tgtText;
    document.getElementById("outputText").value = srcText;
    updateWordCount();
  }
}

// ===== HISTORY =====
function addToHistory(entry) {
  translationHistory.unshift(entry);
  translationHistory = translationHistory.slice(0, 20);
  localStorage.setItem("transHistory", JSON.stringify(translationHistory));
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById("historyList");
  if (!translationHistory.length) {
    list.innerHTML = '<p class="empty-history">No translations yet</p>';
    return;
  }
  list.innerHTML = translationHistory.map((item, i) => `
    <div class="history-item" onclick="loadHistory(${i})">
      <div class="history-orig">${escapeHtml(item.original.substring(0, 80))}${item.original.length > 80 ? "..." : ""}</div>
      <div class="history-trans">${escapeHtml(item.translated.substring(0, 80))}${item.translated.length > 80 ? "..." : ""}</div>
      <div class="history-meta">${item.from || "?"} → ${item.to || "?"} · ${item.time || ""}</div>
    </div>
  `).join("");
}

function loadHistory(i) {
  const item = translationHistory[i];
  document.getElementById("inputText").value = item.original;
  document.getElementById("outputText").value = item.translated;
  updateWordCount();
}

function clearHistory() {
  translationHistory = [];
  localStorage.removeItem("transHistory");
  renderHistory();
}

// ===== TOAST =====
function showToast(msg, isError = false) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    toast.style.cssText = `
      position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
      padding:10px 20px; border-radius:10px; font-size:14px; font-weight:500;
      z-index:9999; transition:opacity 0.3s;
      font-family: 'Inter', sans-serif;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = isError
    ? "rgba(200,60,60,0.85)"
    : "rgba(90,70,200,0.85)";
  toast.style.color = "white";
  toast.style.border = "1px solid " + (isError ? "rgba(255,100,100,0.4)" : "rgba(180,160,255,0.4)");
  toast.style.opacity = "1";
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.opacity = "0"; }, 2500);
}

// ===== HELPERS =====
function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getLangNames() {
  return {
    en: "English", hi: "Hindi", fr: "French", de: "German",
    es: "Spanish", it: "Italian", pt: "Portuguese", ru: "Russian",
    ja: "Japanese", ko: "Korean", "zh-CN": "Chinese", ar: "Arabic",
    tr: "Turkish", nl: "Dutch", bn: "Bengali", ta: "Tamil",
    te: "Telugu", mr: "Marathi", gu: "Gujarati", pa: "Punjabi",
    ur: "Urdu", sw: "Swahili", vi: "Vietnamese", th: "Thai",
    pl: "Polish", uk: "Ukrainian"
  };
}