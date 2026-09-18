// ============================================================
// SMOKE DETECTOR APP - LOGIC CHÍNH
// ============================================================

// ===== CẤU HÌNH MẶC ĐỊNH =====
const DEFAULT_CONFIG = {
  mainHost: 'duchieu.local',
  camHost: 'duchieu_esp32cam.local',
  username: 'duchieu',
  password: '123456789'
};

// ===== TRẠNG THÁI =====
let config = { ...DEFAULT_CONFIG };
let isStreaming = false;
let streamTimer = null;
let lastCaptureTime = 0;

let isConnected = false;
let failCount = 0;
let consecutiveFails = 0;
const MAX_FAILS = 3;

let lastAlertCount = 0;
let appStartTime = Date.now();

// Chart
let chart = null;
const MAX_CHART_POINTS = 60;

// ============================================================
// KHỞI ĐỘNG
// ============================================================
window.addEventListener('load', () => {
  loadConfig();
  initChart();
  setupUI();

  // Ẩn splash sau 1.2s
  setTimeout(() => {
    document.getElementById('splash').classList.add('hide');
  }, 1200);

  // Bắt đầu vòng lặp cập nhật
  setInterval(fetchStatus, 1000);
  setInterval(updateAppUptime, 1000);

  // Fetch lần đầu
  fetchStatus();

  addLog('📡 Khởi động app Smoke Detector', 'ok');
  addLog(`🎯 Target S3: ${config.mainHost}`, 'ok');
  addLog(`🎥 Target CAM: ${config.camHost}`, 'ok');
});

// ============================================================
// CẤU HÌNH
// ============================================================
function loadConfig() {
  const saved = localStorage.getItem('smoke_config');
  if (saved) {
    try {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch (e) {
      config = { ...DEFAULT_CONFIG };
    }
  }

  // Điền vào form
  document.getElementById('cfgMainHost').value = config.mainHost;
  document.getElementById('cfgCamHost').value = config.camHost;
  document.getElementById('cfgUser').value = config.username;
  document.getElementById('cfgPass').value = config.password;

  document.getElementById('mainHost').textContent = config.mainHost;
  document.getElementById('camHost').textContent = config.camHost;
}

function saveSettings() {
  const newConfig = {
    mainHost: document.getElementById('cfgMainHost').value.trim(),
    camHost: document.getElementById('cfgCamHost').value.trim(),
    username: document.getElementById('cfgUser').value.trim(),
    password: document.getElementById('cfgPass').value
  };

  if (!newConfig.mainHost || !newConfig.camHost) {
    alert('Vui lòng nhập hostname/IP!');
    return;
  }

  config = newConfig;
  localStorage.setItem('smoke_config', JSON.stringify(config));

  document.getElementById('mainHost').textContent = config.mainHost;
  document.getElementById('camHost').textContent = config.camHost;

  addLog(`✅ Đã lưu cài đặt: S3=${config.mainHost}, CAM=${config.camHost}`, 'ok');
  alert('Đã lưu cài đặt!');
  fetchStatus();
}

// ============================================================
// HTTP FETCH VỚI BASIC AUTH
// ============================================================
function authHeader() {
  return {
    'Authorization': 'Basic ' + btoa(config.username + ':' + config.password)
  };
}

async function httpGet(url, timeoutMs = 3000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeader(),
      signal: controller.signal,
      cache: 'no-cache'
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ============================================================
// FETCH TRẠNG THÁI S3
// ============================================================
async function fetchStatus() {
  // Xử lý URL: nếu là IP thì thêm http://, nếu là hostname .local cũng thêm http://
  const host = config.mainHost;
  const url = host.startsWith('http') ? `${host}/data` : `http://${host}/data`;

  try {
    const text = await httpGet(url, 2500);
    const parts = text.split('|');

    if (parts.length >= 4) {
      const v1 = parseInt(parts[0]) || 0;
      const v2 = parseInt(parts[1]) || 0;
      const t1 = parseInt(parts[2]) || 0;
      const t2 = parseInt(parts[3]) || 0;

      updateSensorUI(v1, v2, t1, t2);
      updateChart(v1, v2);

      if (!isConnected) {
        isConnected = true;
        consecutiveFails = 0;
        setConnStatus(true);
        addLog('✅ Kết nối S3 thành công', 'ok');
      }
      consecutiveFails = 0;
    }
  } catch (err) {
    consecutiveFails++;
    if (consecutiveFails >= MAX_FAILS && isConnected) {
      isConnected = false;
      failCount++;
      document.getElementById('failCount').textContent = failCount;
      setConnStatus(false);
      addLog(`❌ Mất kết nối S3 (${err.message})`, 'err');
    } else if (!isConnected && consecutiveFails === MAX_FAILS) {
      setConnStatus(false);
      addLog(`❌ Không kết nối được S3 (${err.message})`, 'err');
    }
  }
}

function setConnStatus(ok) {
  const dot = document.querySelector('#connStatus .dot');
  const text = document.getElementById('connText');
  const banner = document.getElementById('connBanner');
  const bannerText = document.getElementById('bannerText');

  if (ok) {
    dot.className = 'dot dot-ok';
    text.textContent = 'Đã kết nối';
    banner.classList.add('banner-hidden');
  } else {
    dot.className = 'dot dot-bad';
    text.textContent = 'Mất kết nối';
    banner.classList.remove('banner-hidden');
    bannerText.textContent = `Không kết nối được ${config.mainHost}`;
  }
}

// ============================================================
// CẬP NHẬT UI CẢM BIẾN
// ============================================================
function updateSensorUI(v1, v2, t1, t2) {
  // Cảm biến 1
  const el1 = document.getElementById('val1');
  el1.textContent = v1;
  el1.classList.remove('warn', 'danger');
  if (v1 >= t1) el1.classList.add('danger');
  else if (v1 >= t1 * 0.7) el1.classList.add('warn');

  document.getElementById('bar1').style.width = Math.min(100, (v1 / 4095) * 100) + '%';
  document.getElementById('thresh1').textContent = t1;

  // Cảm biến 2
  const el2 = document.getElementById('val2');
  el2.textContent = v2;
  el2.classList.remove('warn', 'danger');
  if (v2 >= t2) el2.classList.add('danger');
  else if (v2 >= t2 * 0.7) el2.classList.add('warn');

  document.getElementById('bar2').style.width = Math.min(100, (v2 / 4095) * 100) + '%';
  document.getElementById('thresh2').textContent = t2;

  // Điền vào input nếu chưa chỉnh
  const inp1 = document.getElementById('inputTh1');
  const inp2 = document.getElementById('inputTh2');
  if (!inp1.value) inp1.value = t1;
  if (!inp2.value) inp2.value = t2;
}

// ============================================================
// LƯU NGƯỠNG
// ============================================================
async function saveThresholds() {
  const th1 = parseInt(document.getElementById('inputTh1').value);
  const th2 = parseInt(document.getElementById('inputTh2').value);

  if (isNaN(th1) || isNaN(th2) || th1 < 0 || th2 < 0 || th1 > 4095 || th2 > 4095) {
    alert('Ngưỡng phải là số từ 0 đến 4095');
    return;
  }

  const host = config.mainHost;
  const url = host.startsWith('http')
    ? `${host}/set_threshold?th1=${th1}&th2=${th2}`
    : `http://${host}/set_threshold?th1=${th1}&th2=${th2}`;

  try {
    const res = await httpGet(url, 5000);
    addLog(`✅ Lưu ngưỡng OK: TH1=${th1}, TH2=${th2}`, 'ok');
    alert('Đã lưu ngưỡng!\n' + res);
  } catch (err) {
    addLog(`❌ Lỗi lưu ngưỡng: ${err.message}`, 'err');
    alert('Lỗi lưu ngưỡng: ' + err.message);
  }
}

// ============================================================
// CHART
// ============================================================
function initChart() {
  const ctx = document.getElementById('sensorChart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Cảm biến 1',
          data: [],
          borderColor: '#00ff88',
          backgroundColor: 'rgba(0,255,136,0.1)',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
          fill: true
        },
        {
          label: 'Cảm biến 2',
          data: [],
          borderColor: '#00d4ff',
          backgroundColor: 'rgba(0,212,255,0.1)',
          borderWidth: 2,
          tension: 0.3,
          pointRadius: 0,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      scales: {
        y: {
          beginAtZero: true,
          max: 4095,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#888', font: { size: 10 } }
        },
        x: {
          grid: { display: false },
          ticks: { display: false }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#eee', font: { size: 11 }, boxWidth: 12 }
        }
      }
    }
  });
}

function updateChart(v1, v2) {
  if (!chart) return;

  chart.data.labels.push('');
  chart.data.datasets[0].data.push(v1);
  chart.data.datasets[1].data.push(v2);

  if (chart.data.labels.length > MAX_CHART_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
    chart.data.datasets[1].data.shift();
  }

  chart.update();
}

// ============================================================
// CAMERA
// ============================================================
function toggleStream() {
  if (isStreaming) {
    // Dừng stream
    isStreaming = false;
    if (streamTimer) clearTimeout(streamTimer);
    streamTimer = null;
    document.getElementById('btnStreamToggle').textContent = '▶ BẮT ĐẦU';
    document.getElementById('camStream').style.display = 'none';
    document.getElementById('camPlaceholder').style.display = 'block';
    document.getElementById('camPlaceholder').textContent = 'Đã dừng stream';
    addLog('⏹ Dừng camera stream', 'warn');
  } else {
    // Bắt đầu stream
    isStreaming = true;
    document.getElementById('btnStreamToggle').textContent = '⏹ DỪNG';
    document.getElementById('camPlaceholder').style.display = 'none';
    document.getElementById('camStream').style.display = 'block';
    addLog('▶ Bắt đầu camera stream', 'ok');
    loadNextFrame();
  }
}

function loadNextFrame() {
  if (!isStreaming) return;

  const img = document.getElementById('camStream');
  const host = config.camHost;
  const base = host.startsWith('http') ? host : `http://${host}`;
  const t = Date.now();

  // Set timeout phòng trường hợp ảnh không load
  const timeout = setTimeout(() => {
    if (isStreaming) {
      addLog('⚠️ Timeout frame, thử lại...', 'warn');
      loadNextFrame();
    }
  }, 5000);

  img.onload = () => {
    clearTimeout(timeout);
    setCamStatus(true);
    if (isStreaming) {
      setTimeout(loadNextFrame, 50); // Load frame tiếp theo
    }
  };

  img.onerror = () => {
    clearTimeout(timeout);
    setCamStatus(false);
    if (isStreaming) {
      setTimeout(loadNextFrame, 1000);
    }
  };

  // Basic auth trong URL để browser có thể load ảnh (vì thẻ img không gửi header)
  img.src = `${base}/photo?t=${t}&user=${encodeURIComponent(config.username)}&pass=${encodeURIComponent(config.password)}`;
  // Chú ý: ESP32-CAM của mày dùng Basic Auth qua header, không phải query string
  // → cần thêm endpoint /photo_auth hoặc tắt auth cho /photo
}

function setCamStatus(ok) {
  const dot = document.querySelector('#camStatus .dot');
  const text = document.getElementById('camStatusText');
  if (ok) {
    dot.className = 'dot dot-ok';
    text.textContent = 'Camera OK';
  } else {
    dot.className = 'dot dot-bad';
    text.textContent = 'Camera lỗi';
  }
}

async function captureAndSave() {
  const host = config.camHost;
  const base = host.startsWith('http') ? host : `http://${host}`;
  const url = `${base}/save`;

  const logEl = document.getElementById('camLog');
  addCamLog('📸 Gửi lệnh chụp...');

  try {
    const res = await httpGet(url, 15000);
    addCamLog('✅ ' + res, 'ok');
    // Reload frame
    if (isStreaming) {
      // Trigger immediate next frame
    }
  } catch (err) {
    addCamLog('❌ Lỗi: ' + err.message, 'err');
  }
}

function addCamLog(msg, type = '') {
  const logEl = document.getElementById('camLog');
  const time = new Date().toLocaleTimeString('vi-VN');
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.textContent = `[${time}] ${msg}`;
  logEl.insertBefore(line, logEl.firstChild);

  while (logEl.children.length > 30) {
    logEl.removeChild(logEl.lastChild);
  }
}

// ============================================================
// OTA
// ============================================================
function openOTA(which) {
  const host = which === 'main' ? config.mainHost : config.camHost;
  const base = host.startsWith('http') ? host : `http://${host}`;

  document.getElementById('otaTitle').textContent =
    which === 'main' ? '🔄 OTA S3 Firmware' : '🔄 OTA CAM Firmware';
  document.getElementById('otaFrame').src = `${base}/update`;
  document.getElementById('otaModal').classList.remove('hidden');
}

function closeOTA() {
  document.getElementById('otaFrame').src = '';
  document.getElementById('otaModal').classList.add('hidden');
}

// ============================================================
// TAB SWITCHING
// ============================================================
function switchTab(name) {
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));

  document.getElementById('tab-' + name).classList.add('active');
  document.querySelector(`.tab-item[data-tab="${name}"]`).classList.add('active');
}

// ============================================================
// LOG
// ============================================================
function addLog(msg, type = '') {
  const el = document.getElementById('sysLog');
  const time = new Date().toLocaleTimeString('vi-VN');
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.textContent = `[${time}] ${msg}`;
  el.insertBefore(line, el.firstChild);

  while (el.children.length > 50) {
    el.removeChild(el.lastChild);
  }
}

function clearLog() {
  document.getElementById('sysLog').innerHTML = '';
  addLog('🗑️ Đã xóa log', 'ok');
}

// ============================================================
// UPTIME
// ============================================================
function updateAppUptime() {
  const sec = Math.floor((Date.now() - appStartTime) / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  let text = '';
  if (h > 0) text = `${h}h ${m}m ${s}s`;
  else if (m > 0) text = `${m}m ${s}s`;
  else text = `${s}s`;

  document.getElementById('appUptime').textContent = text;
  document.getElementById('uptimeText').textContent = 'Uptime: ' + text;
}

// ============================================================
// UI SETUP
// ============================================================
function setupUI() {
  // Ngăn scroll body khi ở modal
  document.addEventListener('touchmove', (e) => {
    if (e.target.closest('.content')) return;
    e.preventDefault();
  }, { passive: false });
}
