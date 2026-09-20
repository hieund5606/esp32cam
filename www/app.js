// ============================================================
// SMOKE DETECTOR APP - v6.1
// Fix notification sound + bỏ BackgroundFetch
// ============================================================

const DEFAULT_CONFIG = {
  mainHost: '',
  camHost: '',
  username: 'duchieu',
  password: '123456789'
};

let config = { ...DEFAULT_CONFIG };
let isStreaming = false;
let isConnected = false;
let lastOkTime = 0;
let failCount = 0;
let alertCount = 0;
let appStartTime = Date.now();

const DISCONNECT_THRESHOLD_MS = 5000;
const HTTP_TIMEOUT_MS = 4000;

let chart = null;
const MAX_CHART_POINTS = 60;

// ============================================================
// NOTIFICATION STATE
// ============================================================
let notifConfig = {
  enabled: true,
  vibrate: true,
  sound: true,
  cooldown: 60
};

let lastNotifTime = { 1: 0, 2: 0 };
let isAlerting = { 1: false, 2: false };

const isNative = typeof window.Capacitor !== 'undefined'
                 && window.Capacitor.isNativePlatform
                 && window.Capacitor.isNativePlatform();

// ============================================================
// URL HELPERS
// ============================================================
function buildUrl(host, path) {
  let base = (host || '').trim();
  if (!base) return '';
  if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
  base = base.replace(/\/+$/, '');
  return base + (path.startsWith('/') ? path : '/' + path);
}

// ============================================================
// HTTP GET
// ============================================================
async function httpGet(url, timeoutMs = HTTP_TIMEOUT_MS) {
  if (!url) throw new Error('Chưa cấu hình host');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-cache'
    });
    clearTimeout(timer);
    if (res.status === 401) throw new Error('401 - Sai username/password');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.text();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Timeout - ESP32 không phản hồi');
    if (err.message === 'Failed to fetch' || err.message.includes('NetworkError')) {
      throw new Error('Lỗi mạng/CORS - kiểm tra IP + firmware');
    }
    throw err;
  }
}

// ============================================================
// KHỞI ĐỘNG
// ============================================================
window.addEventListener('load', () => {
  loadConfig();
  initNotifications();
  initChart();
  setupUI();

  setTimeout(() => {
    document.getElementById('splash').classList.add('hide');
  }, 1200);

  setInterval(fetchStatus, 1000);
  setInterval(updateAppUptime, 1000);
  setInterval(checkDisconnect, 1000);
  fetchStatus();

  addLog('📡 Khởi động app v6.1', 'ok');
  if (!config.mainHost) {
    addLog('⚠️ Chưa cấu hình ESP32-S3! Vào tab Cài đặt.', 'warn');
  } else {
    addLog(`🎯 S3: ${config.mainHost}`, 'ok');
    addLog(`🎥 CAM: ${config.camHost || 'chưa cấu hình'}`, 'ok');
  }
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

  document.getElementById('cfgMainHost').value = config.mainHost || '';
  document.getElementById('cfgCamHost').value = config.camHost || '';
  document.getElementById('cfgUser').value = config.username || '';
  document.getElementById('cfgPass').value = config.password || '';

  document.getElementById('mainHost').textContent = config.mainHost || '--';
  document.getElementById('camHost').textContent = config.camHost || '--';
}

function saveSettings() {
  const newConfig = {
    mainHost: document.getElementById('cfgMainHost').value.trim(),
    camHost: document.getElementById('cfgCamHost').value.trim(),
    username: document.getElementById('cfgUser').value.trim() || 'duchieu',
    password: document.getElementById('cfgPass').value || '123456789'
  };

  if (!newConfig.mainHost) {
    alert('Vui lòng nhập IP/hostname của ESP32-S3!');
    return;
  }

  config = newConfig;
  localStorage.setItem('smoke_config', JSON.stringify(config));

  document.getElementById('mainHost').textContent = config.mainHost;
  document.getElementById('camHost').textContent = config.camHost || '--';

  isConnected = false;
  lastOkTime = 0;

  addLog(`✅ Đã lưu: S3=${config.mainHost}, CAM=${config.camHost || '--'}`, 'ok');
  alert('Đã lưu cài đặt!');
  fetchStatus();
}

// ============================================================
// NOTIFICATION SETUP
// ============================================================
async function initNotifications() {
  const saved = localStorage.getItem('smoke_notif_config');
  if (saved) {
    try {
      notifConfig = { ...notifConfig, ...JSON.parse(saved) };
    } catch (e) {}
  }

  const en = document.getElementById('notifEnabled');
  const vi = document.getElementById('notifVibrate');
  const so = document.getElementById('notifSound');
  const co = document.getElementById('notifCooldown');

  if (en) en.checked = notifConfig.enabled;
  if (vi) vi.checked = notifConfig.vibrate;
  if (so) so.checked = notifConfig.sound;
  if (co) co.value = notifConfig.cooldown;

  if (isNative && notifConfig.enabled) {
    await setupNativeNotifications();
  }

  addLog('🔔 Notification: ' + (notifConfig.enabled ? 'BẬT' : 'TẮT'), notifConfig.enabled ? 'ok' : 'warn');
}

async function setupNativeNotifications() {
  try {
    const { LocalNotifications } = Capacitor.Plugins;
    if (!LocalNotifications) {
      addLog('⚠️ Plugin Local Notifications không có', 'warn');
      return false;
    }

    const perm = await LocalNotifications.requestPermissions();
    if (perm.display !== 'granted') {
      addLog('❌ Chưa được cấp quyền thông báo', 'err');
      return false;
    }

    try {
      await LocalNotifications.createChannel({
        id: 'smoke_alert',
        name: 'Cảnh báo khói',
        description: 'Thông báo khi có khói',
        importance: 5,
        visibility: 1,
        vibration: notifConfig.vibrate,
        sound: 'default',
        lights: true,
        lightColor: '#00ff88'
      });
    } catch (e) {
      // iOS không cần channel
    }

    addLog('✅ Notification đã sẵn sàng', 'ok');
    return true;
  } catch (err) {
    addLog('❌ Lỗi setup notification: ' + err.message, 'err');
    return false;
  }
}

async function checkPermission() {
  if (!isNative) {
    alert('Tính năng này chỉ hoạt động trên app iOS/Android.');
    return;
  }

  try {
    const { LocalNotifications } = Capacitor.Plugins;
    const perm = await LocalNotifications.checkPermissions();
    alert('Trạng thái quyền thông báo:\n' + JSON.stringify(perm, null, 2));
  } catch (err) {
    alert('Lỗi: ' + err.message);
  }
}

async function toggleNotifications() {
  notifConfig.enabled = document.getElementById('notifEnabled').checked;
  saveNotifSettings();

  if (notifConfig.enabled && isNative) {
    await setupNativeNotifications();
  }
}

function saveNotifSettings() {
  notifConfig.vibrate = document.getElementById('notifVibrate').checked;
  notifConfig.sound = document.getElementById('notifSound').checked;
  notifConfig.cooldown = parseInt(document.getElementById('notifCooldown').value) || 60;

  localStorage.setItem('smoke_notif_config', JSON.stringify(notifConfig));
  addLog(`🔔 Đã lưu cài đặt thông báo`, 'ok');
}

async function testNotification() {
  await sendNotification(
    999,
    '🧪 Thông báo thử',
    'Đây là thông báo test từ Smoke Detector'
  );
}

// ============================================================
// GỬI THÔNG BÁO (đã fix tiếng)
// ============================================================
async function sendNotification(id, title, body) {
  if (!notifConfig.enabled) return;

  if (isNative) {
    try {
      const { LocalNotifications } = Capacitor.Plugins;
      await LocalNotifications.schedule({
        notifications: [{
          id: id,
          title: title,
          body: body,
          channelId: 'smoke_alert',
          schedule: { at: new Date(Date.now() + 100) },
          sound: notifConfig.sound ? 'default' : null,
          actionTypeId: '',
          extra: null
        }]
      });
      addLog(`🔔 Đã gửi: ${title}`, 'ok');
    } catch (err) {
      addLog(`❌ Lỗi gửi thông báo: ${err.message}`, 'err');
    }
  } else if ('Notification' in window) {
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
    if (Notification.permission === 'granted') {
      new Notification(title, { body: body });
      addLog(`🔔 Đã gửi (web): ${title}`, 'ok');
    }
  }

  if (notifConfig.vibrate && navigator.vibrate) {
    navigator.vibrate([200, 100, 200]);
  }
}

// ============================================================
// KIỂM TRA VƯỢT NGƯỠNG
// ============================================================
function checkThresholdAlert(v1, v2, t1, t2) {
  const now = Date.now();

  if (v1 >= t1) {
    if (!isAlerting[1]) {
      isAlerting[1] = true;
      if (now - lastNotifTime[1] > notifConfig.cooldown * 1000) {
        sendNotification(
          1,
          '🚨 CẢNH BÁO KHÓI — Kênh 1',
          `Giá trị: ${v1} (ngưỡng ${t1})`
        );
        lastNotifTime[1] = now;
        alertCount++;
        const el = document.getElementById('alertCount');
        if (el) el.textContent = alertCount;
      }
    }
  } else {
    if (isAlerting[1]) {
      isAlerting[1] = false;
      addLog(`✅ Kênh 1 an toàn (${v1})`, 'ok');
    }
  }

  if (v2 >= t2) {
    if (!isAlerting[2]) {
      isAlerting[2] = true;
      if (now - lastNotifTime[2] > notifConfig.cooldown * 1000) {
        sendNotification(
          2,
          '🚨 CẢNH BÁO KHÓI — Kênh 2',
          `Giá trị: ${v2} (ngưỡng ${t2})`
        );
        lastNotifTime[2] = now;
        alertCount++;
        const el = document.getElementById('alertCount');
        if (el) el.textContent = alertCount;
      }
    }
  } else {
    if (isAlerting[2]) {
      isAlerting[2] = false;
      addLog(`✅ Kênh 2 an toàn (${v2})`, 'ok');
    }
  }
}

// ============================================================
// TEST KẾT NỐI
// ============================================================
async function testConnection() {
  addLog('🔍 Bắt đầu test kết nối...', 'warn');

  if (config.mainHost) {
    const s3Url = buildUrl(config.mainHost, '/data');
    addLog(`→ S3: ${s3Url}`, '');
    try {
      const res = await httpGet(s3Url, 5000);
      addLog(`✅ S3 OK: "${res}"`, 'ok');
    } catch (err) {
      addLog(`❌ S3 lỗi: ${err.message}`, 'err');
    }
  } else {
    addLog('⚠️ Chưa nhập IP S3', 'warn');
  }

  if (config.camHost) {
    const camUrl = buildUrl(config.camHost, '/photo') + '?t=' + Date.now();
    addLog(`→ CAM: ${buildUrl(config.camHost, '/photo')}`, '');
    await new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => {
        addLog('❌ CAM timeout', 'err');
        resolve();
      }, 5000);
      img.onload = () => {
        clearTimeout(timer);
        addLog('✅ CAM OK', 'ok');
        setCamStatus(true);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        addLog('❌ CAM lỗi', 'err');
        setCamStatus(false);
        resolve();
      };
      img.src = camUrl;
    });
  }

  addLog('🏁 Test xong', 'warn');
}

// ============================================================
// FETCH STATUS
// ============================================================
async function fetchStatus() {
  if (!config.mainHost) return;

  const url = buildUrl(config.mainHost, '/data');

  try {
    const text = await httpGet(url, HTTP_TIMEOUT_MS);
    const parts = text.split('|');

    if (parts.length >= 4) {
      const v1 = parseInt(parts[0]) || 0;
      const v2 = parseInt(parts[1]) || 0;
      const t1 = parseInt(parts[2]) || 0;
      const t2 = parseInt(parts[3]) || 0;

      updateSensorUI(v1, v2, t1, t2);
      updateChart(v1, v2);

      lastOkTime = Date.now();

      if (!isConnected) {
        isConnected = true;
        setConnStatus(true);
        addLog('✅ Kết nối S3 thành công', 'ok');
      }
    }
  } catch (err) {
    // checkDisconnect() xử lý
  }
}

function checkDisconnect() {
  if (!config.mainHost) return;
  if (lastOkTime === 0) return;

  const elapsed = Date.now() - lastOkTime;

  if (isConnected && elapsed > DISCONNECT_THRESHOLD_MS) {
    isConnected = false;
    failCount++;
    const el = document.getElementById('failCount');
    if (el) el.textContent = failCount;
    setConnStatus(false);
    addLog(`❌ Mất kết nối S3 (${Math.round(elapsed / 1000)}s)`, 'err');
  }
}

function setConnStatus(ok) {
  const dot = document.querySelector('#connStatus .dot');
  const text = document.getElementById('connText');
  const banner = document.getElementById('connBanner');
  const bannerText = document.getElementById('bannerText');

  if (!dot || !text || !banner || !bannerText) return;

  if (ok) {
    dot.className = 'dot dot-ok';
    text.textContent = 'Đã kết nối';
    banner.classList.add('banner-hidden');
  } else {
    dot.className = 'dot dot-bad';
    text.textContent = 'Mất kết nối';
    banner.classList.remove('banner-hidden');
    bannerText.textContent = `Không kết nối được ${config.mainHost || 'S3'}`;
  }
}

// ============================================================
// UI CẢM BIẾN
// ============================================================
function updateSensorUI(v1, v2, t1, t2) {
  const el1 = document.getElementById('val1');
  el1.textContent = v1;
  el1.classList.remove('warn', 'danger');
  if (v1 >= t1) el1.classList.add('danger');
  else if (v1 >= t1 * 0.7) el1.classList.add('warn');
  document.getElementById('bar1').style.width = Math.min(100, (v1 / 4095) * 100) + '%';
  document.getElementById('thresh1').textContent = t1;

  const el2 = document.getElementById('val2');
  el2.textContent = v2;
  el2.classList.remove('warn', 'danger');
  if (v2 >= t2) el2.classList.add('danger');
  else if (v2 >= t2 * 0.7) el2.classList.add('warn');
  document.getElementById('bar2').style.width = Math.min(100, (v2 / 4095) * 100) + '%';
  document.getElementById('thresh2').textContent = t2;

  const inp1 = document.getElementById('inputTh1');
  const inp2 = document.getElementById('inputTh2');
  if (!inp1.value) inp1.value = t1;
  if (!inp2.value) inp2.value = t2;

  checkThresholdAlert(v1, v2, t1, t2);
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

  const url = buildUrl(config.mainHost, `/set_threshold?th1=${th1}&th2=${th2}`);

  try {
    const res = await httpGet(url, 5000);
    addLog(`✅ Lưu ngưỡng: TH1=${th1}, TH2=${th2}`, 'ok');
    alert('Đã lưu ngưỡng!\n' + res);
  } catch (err) {
    addLog(`❌ Lỗi lưu ngưỡng: ${err.message}`, 'err');
    alert('Lỗi: ' + err.message);
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
        x: { grid: { display: false }, ticks: { display: false } }
      },
      plugins: {
        legend: { labels: { color: '#eee', font: { size: 11 }, boxWidth: 12 } }
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
    isStreaming = false;
    document.getElementById('btnStreamToggle').textContent = '▶ BẮT ĐẦU';
    document.getElementById('camStream').style.display = 'none';
    const ph = document.getElementById('camPlaceholder');
    ph.style.display = 'block';
    ph.textContent = 'Đã dừng stream';
    addLog('⏹ Dừng camera', 'warn');
  } else {
    if (!config.camHost) {
      alert('Chưa cấu hình ESP32-CAM!');
      return;
    }
    isStreaming = true;
    document.getElementById('btnStreamToggle').textContent = '⏹ DỪNG';
    document.getElementById('camPlaceholder').style.display = 'none';
    document.getElementById('camStream').style.display = 'block';
    addLog('▶ Bắt đầu camera', 'ok');
    loadNextFrame();
  }
}

function loadNextFrame() {
  if (!isStreaming) return;

  const img = document.getElementById('camStream');
  const url = buildUrl(config.camHost, '/photo') + '?t=' + Date.now();

  const timeout = setTimeout(() => {
    if (isStreaming) {
      addLog('⚠️ Timeout frame', 'warn');
      loadNextFrame();
    }
  }, 5000);

  img.onload = () => {
    clearTimeout(timeout);
    setCamStatus(true);
    if (isStreaming) setTimeout(loadNextFrame, 50);
  };

  img.onerror = () => {
    clearTimeout(timeout);
    setCamStatus(false);
    if (isStreaming) setTimeout(loadNextFrame, 1000);
  };

  img.src = url;
}

function setCamStatus(ok) {
  const dot = document.querySelector('#camStatus .dot');
  const text = document.getElementById('camStatusText');
  if (!dot || !text) return;
  if (ok) {
    dot.className = 'dot dot-ok';
    text.textContent = 'Camera OK';
  } else {
    dot.className = 'dot dot-bad';
    text.textContent = 'Camera lỗi';
  }
}

async function captureAndSave() {
  if (!config.camHost) {
    alert('Chưa cấu hình ESP32-CAM!');
    return;
  }
  const url = buildUrl(config.camHost, '/save');
  addCamLog('📸 Gửi lệnh chụp...');
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    const text = await res.text();
    addCamLog('✅ ' + text, 'ok');
  } catch (err) {
    addCamLog('❌ Lỗi: ' + err.message, 'err');
  }
}

function addCamLog(msg, type = '') {
  const logEl = document.getElementById('camLog');
  if (!logEl) return;
  const time = new Date().toLocaleTimeString('vi-VN');
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.textContent = `[${time}] ${msg}`;
  logEl.insertBefore(line, logEl.firstChild);
  while (logEl.children.length > 30) logEl.removeChild(logEl.lastChild);
}

// ============================================================
// OTA
// ============================================================
function openOTA(which) {
  const host = which === 'main' ? config.mainHost : config.camHost;
  if (!host) { alert('Chưa cấu hình host!'); return; }
  const url = buildUrl(host, '/update');
  document.getElementById('otaTitle').textContent =
    which === 'main' ? '🔄 OTA S3' : '🔄 OTA CAM';
  document.getElementById('otaFrame').src = url;
  document.getElementById('otaModal').classList.remove('hidden');
}

function closeOTA() {
  document.getElementById('otaFrame').src = '';
  document.getElementById('otaModal').classList.add('hidden');
}

// ============================================================
// TAB
// ============================================================
function switchTab(name) {
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  const tabItem = document.querySelector(`.tab-item[data-tab="${name}"]`);
  if (tabItem) tabItem.classList.add('active');
}

// ============================================================
// LOG
// ============================================================
function addLog(msg, type = '') {
  const el = document.getElementById('sysLog');
  if (!el) return;
  const time = new Date().toLocaleTimeString('vi-VN');
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  line.textContent = `[${time}] ${msg}`;
  el.insertBefore(line, el.firstChild);
  while (el.children.length > 50) el.removeChild(el.lastChild);
}

function clearLog() {
  const el = document.getElementById('sysLog');
  if (el) el.innerHTML = '';
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
  let text = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  const el1 = document.getElementById('appUptime');
  const el2 = document.getElementById('uptimeText');
  if (el1) el1.textContent = text;
  if (el2) el2.textContent = 'Uptime: ' + text;
}

// ============================================================
// UI
// ============================================================
function setupUI() {
  document.addEventListener('touchmove', (e) => {
    if (e.target.closest('.content')) return;
    e.preventDefault();
  }, { passive: false });
}
