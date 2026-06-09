// ── DOM References ────────────────────────────────────────────────────────────
const video           = document.getElementById('video');
const videoPlaceholder= document.getElementById('videoPlaceholder');
const cameraToggle    = document.getElementById('cameraToggle');
const detectionToggle = document.getElementById('detectionToggle');
const alertBox        = document.getElementById('alertBox');
const safeBox         = document.getElementById('safeBox');
const cameraLabel     = document.getElementById('cameraLabel');
const cameraDot       = document.getElementById('cameraDot');
const detectionLabel  = document.getElementById('detectionLabel');
const detectionDot    = document.getElementById('detectionDot');
const detectionHint   = document.getElementById('detectionHint');
const log             = document.getElementById('log');
const downloadLog     = document.getElementById('downloadLog');
const clearLog        = document.getElementById('clearLog');

// ── State ─────────────────────────────────────────────────────────────────────
let stream               = null;
let sessionLog           = [];
let isAlertActive        = false;
let beepTimer            = null;
let detectionRunning     = false;
let apiSupportsDetection = true;
let cameraRunning        = false;

// ── Logging ───────────────────────────────────────────────────────────────────
function logEvent(text) {
  const li = document.createElement('li');
  const ts = new Date().toLocaleTimeString();
  li.textContent = `[${ts}] ${text}`;
  log.prepend(li);
  sessionLog.push({ t: new Date().toISOString(), text });
}

// ── API helper ────────────────────────────────────────────────────────────────
function callApi(url, options = {}) {
  return fetch(url, options).then(resp => {
    if (!resp.ok) throw new Error('API error');
    return resp.json();
  });
}

// ── Beep (Web Audio — continuous while alert is active) ───────────────────────
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.35;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, 600);
  } catch (e) { /* ignore */ }
}

function startBeeping() {
  if (beepTimer) return;           // already beeping
  playBeep();                      // immediate first beep
  beepTimer = setInterval(playBeep, 1000);  // then every 1 second
}

function stopBeeping() {
  if (beepTimer) { clearInterval(beepTimer); beepTimer = null; }
}

// ── Alert display ─────────────────────────────────────────────────────────────
function updateAlertDisplay(active) {
  if (active) {
    if (!isAlertActive) {
      logEvent('⚠️ Drowsiness detected — ALERT ACTIVE');
      startBeeping();
    }
    isAlertActive = true;
    alertBox.classList.add('active');
    safeBox.classList.remove('visible');
    cameraLabel.textContent = 'Drowsy!';
    cameraDot.classList.add('dot-danger');
    cameraDot.classList.remove('dot-ok');
  } else {
    if (isAlertActive) {
      logEvent('✅ Eyes open — Alert CLEARED');
      stopBeeping();
    }
    isAlertActive = false;
    alertBox.classList.remove('active');
    if (detectionRunning) {
      safeBox.classList.add('visible');
      cameraLabel.textContent = 'Awake';
      cameraDot.classList.add('dot-ok');
      cameraDot.classList.remove('dot-danger');
    } else {
      safeBox.classList.remove('visible');
      cameraLabel.textContent = cameraRunning ? 'Running' : 'Idle';
      cameraDot.classList.remove('dot-ok', 'dot-danger');
    }
  }
}

// ── Poll alert-status.json (written by drowsiness.py) ────────────────────────
function refreshAlertStatus() {
  fetch(`alert-status.json?ts=${Date.now()}`)
    .then(r => { if (!r.ok) throw new Error(); return r.json(); })
    .then(data => updateAlertDisplay(data.alert))
    .catch(() => {});
}

// ── Detection process state ───────────────────────────────────────────────────
function setDetectionState(running) {
  detectionRunning = running;
  detectionLabel.textContent        = running ? 'Running' : 'Stopped';
  detectionToggle.textContent       = running ? 'Stop Detection' : 'Start Detection';
  detectionDot.classList.toggle('dot-ok',     running);
  detectionDot.classList.toggle('dot-danger', false);

  if (running) {
    detectionHint.textContent = 'OpenCV detection window is now open on your desktop.';
    // Disable camera toggle while detection owns the camera
    cameraToggle.disabled = true;
    cameraToggle.classList.add('btn-disabled');
  } else {
    detectionHint.textContent = '';
    cameraToggle.disabled = false;
    cameraToggle.classList.remove('btn-disabled');
    updateAlertDisplay(false);     // clear any stale alert when detection stops
  }
}

function refreshDetectionState() {
  if (!apiSupportsDetection) return;
  callApi('/api/process')
    .then(data => { if (typeof data.running === 'boolean') setDetectionState(data.running); })
    .catch(() => {
      apiSupportsDetection = false;
      logEvent('ℹ️ Detection API unavailable — run py web/server.py');
    });
}

// ── Camera (browser preview only) ────────────────────────────────────────────
function startCamera() {
  navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
    .then(s => {
      stream = s;
      video.srcObject = s;
      videoPlaceholder.style.display = 'none';
      video.style.display = 'block';
      cameraToggle.textContent = 'Stop Camera';
      cameraLabel.textContent  = 'Running';
      cameraDot.classList.add('dot-ok');
      logEvent('✅ Camera preview started');
      cameraRunning = true;
    })
    .catch(err => {
      logEvent('✗ Camera error: ' + err.message);
    });
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
    stream = null;
  }
  video.style.display = 'none';
  videoPlaceholder.style.display = 'flex';
  cameraToggle.textContent = 'Start Camera';
  cameraLabel.textContent  = 'Idle';
  cameraDot.classList.remove('dot-ok', 'dot-danger');
  logEvent('✅ Camera preview stopped');
  cameraRunning = false;
}

function toggleCamera() {
  if (cameraRunning) stopCamera();
  else startCamera();
}

// ── Detection (spawns drowsiness.py via server API) ───────────────────────────
function startDetection() {
  if (!apiSupportsDetection) {
    logEvent('✗ Server not running — launch py web/server.py first');
    return;
  }

  // Release browser camera so drowsiness.py can own camera 0 exclusively
  if (cameraRunning) {
    stopCamera();
    logEvent('ℹ️ Browser camera released — detection process will use it');
  }

  callApi('/api/start', { method: 'POST' })
    .then(data => {
      if (typeof data.running === 'boolean') {
        setDetectionState(data.running);
        logEvent(data.message || '✅ Detection started');
      }
    })
    .catch(() => {
      apiSupportsDetection = false;
      logEvent('✗ Unable to start detection — check server');
    });
}

function stopDetection() {
  if (!apiSupportsDetection) return;
  callApi('/api/stop', { method: 'POST' })
    .then(data => {
      if (typeof data.running === 'boolean') {
        setDetectionState(data.running);
        logEvent(data.message || '✅ Detection stopped');
      }
    })
    .catch(() => {
      apiSupportsDetection = false;
      logEvent('✗ Unable to stop detection');
    });
}

function toggleDetection() {
  if (detectionRunning) stopDetection();
  else startDetection();
}

// ── Event Listeners ───────────────────────────────────────────────────────────
cameraToggle.addEventListener('click', toggleCamera);
detectionToggle.addEventListener('click', toggleDetection);

downloadLog.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(sessionLog, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'drowsiness_session_log.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});

clearLog.addEventListener('click', () => {
  sessionLog = []; log.innerHTML = '';
  logEvent('Log cleared');
});

// ── Init ──────────────────────────────────────────────────────────────────────
function initPage() {
  video.style.display = 'none';           // hide until camera starts
  refreshDetectionState();
  setInterval(refreshAlertStatus,   1000); // poll alert status every 1 s
  setInterval(refreshDetectionState, 3000); // sync detection state every 3 s
  logEvent('Page ready — press Start Detection to begin');
}

window.addEventListener('load', initPage);
