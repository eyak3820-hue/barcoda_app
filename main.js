/*
 * Main JavaScript for the Order Barcode App
 *
 * This script manages application state, UI screens, barcode scanning via QuaggaJS
 * and CSV import via PapaParse. The app stores its data in localStorage so it
 * persists between sessions and works offline.
 */

// Global state
const state = {
  user: null,            // Logged in user name
  db: null,              // Database of orders and parts
  currentOrder: null,    // Currently selected order object
  scannedParts: [],      // List of parts scanned for current order
};

const appEl = document.getElementById('app');

// Detect whether camera can be used (requires secure context for most browsers)
function canUseCamera() {
  return (location.protocol === 'https:' || location.hostname === 'localhost') && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Load database from localStorage (if exists) or create a sample database
function loadDatabase() {
  const dbStr = localStorage.getItem('barcodeAppDb');
  if (dbStr) {
    try {
      state.db = JSON.parse(dbStr);
    } catch (e) {
      console.warn('Failed to parse saved DB, starting fresh.', e);
      state.db = { orders: [] };
    }
  } else {
    // Sample data: one order with three parts
    state.db = {
      orders: [
        {
          orderId: 'ORDER001',
          parts: ['PART001', 'PART002', 'PART003'],
          status: 'Pending',
          packedAt: null,
          packedBy: null
        }
      ]
    };
    saveDatabase();
  }
}

// Persist database to localStorage
function saveDatabase() {
  localStorage.setItem('barcodeAppDb', JSON.stringify(state.db));
}

// Register service worker for offline support (only when running over HTTPS/localhost)
if (location.protocol === 'https:' || location.hostname === 'localhost') {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  }
}

// Utility: clear app container
function clearApp() {
  appEl.innerHTML = '';
}

// Render login screen
function showLogin() {
  clearApp();
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h1>כניסה</h1>
    <label for="username">שם משתמש</label>
    <input id="username" type="text" placeholder="הקלד שם" />
    <button id="loginBtn">התחברות</button>
  `;
  appEl.appendChild(card);
  document.getElementById('loginBtn').addEventListener('click', () => {
    const username = document.getElementById('username').value.trim();
    if (!username) {
      alert('אנא הזן שם משתמש');
      return;
    }
    state.user = username;
    localStorage.setItem('barcodeAppUser', username);
    showHome();
  });
}

// Render home screen: choose between scanning order or importing CSV
function showHome() {
  clearApp();
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h1>ברוך הבא, ${state.user}</h1>
    <button id="scanOrderBtn">סריקת הזמנה</button>
    <button id="importBtn">טעינת קובץ הזמנות (CSV)</button>
    <button id="dbBtn">מסד נתונים</button>
    <button id="logoutBtn">התנתקות</button>
  `;
  appEl.appendChild(card);
  document.getElementById('scanOrderBtn').addEventListener('click', showOrderScan);
  document.getElementById('importBtn').addEventListener('click', showImport);
  document.getElementById('dbBtn').addEventListener('click', showDatabase);
  document.getElementById('logoutBtn').addEventListener('click', () => {
    state.user = null;
    localStorage.removeItem('barcodeAppUser');
    showLogin();
  });
}

// Render CSV import screen
function showImport() {
  clearApp();
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h1>טעינת CSV</h1>
    <p>בחר קובץ CSV המכיל את נתוני ההזמנות והחלקים. יש לכלול לפחות עמודות עבור מספר הזמנה ומזהה חלק.</p>
    <input id="csvInput" type="file" accept=".csv" />
    <button id="loadSampleBtn">שימוש בדוגמה מובנית</button>
    <button id="backHomeBtn">חזרה</button>
  `;
  appEl.appendChild(card);
  document.getElementById('backHomeBtn').addEventListener('click', showHome);
  document.getElementById('loadSampleBtn').addEventListener('click', () => {
    // restore sample DB
    state.db = {
      orders: [
        {
          orderId: 'ORDER001',
          parts: ['PART001', 'PART002', 'PART003'],
          status: 'Pending',
          packedAt: null,
          packedBy: null
        }
      ]
    };
    saveDatabase();
    alert('Sample database loaded!');
    showHome();
  });
  document.getElementById('csvInput').addEventListener('change', (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        const data = results.data;
        const ordersMap = {};
        // Determine column names by inspecting the keys of the first row
        const firstRow = data[0] || {};
        const keys = Object.keys(firstRow || {});
        // Helper to find a key by patterns (case-insensitive)
        function findKey(patterns) {
          return keys.find((k) => {
            const lower = k.toLowerCase();
            return patterns.some((p) => lower.includes(p));
          });
        }
        const orderKey = findKey(['order', 'מספר הזמנה']);
        const partKey = findKey(['partid', 'part_id', 'part', 'מספר חלק']);
        const customerKey = findKey(['customer', 'לקוח']);
        const projectKey = findKey(['project', 'פרויקט']);
        const dateKey = findKey(['date', 'תאריך']);
        data.forEach((row) => {
          let orderId = row[orderKey];
          let partUid = row[partKey];
          // Fallback if not found
          if (!orderId || !partUid) {
            const rowKeys = Object.keys(row);
            if (!orderId && rowKeys.length >= 1) orderId = row[rowKeys[0]];
            if (!partUid && rowKeys.length >= 2) partUid = row[rowKeys[1]];
          }
          if (orderId) orderId = orderId.toString().trim();
          if (partUid) partUid = partUid.toString().trim();
          if (!orderId || !partUid) return;
          if (!ordersMap[orderId]) {
            ordersMap[orderId] = {
              orderId: orderId,
              parts: [],
              customer: row[customerKey] ? row[customerKey].toString().trim() : '',
              project: row[projectKey] ? row[projectKey].toString().trim() : '',
              supplyDate: row[dateKey] ? row[dateKey].toString().trim() : '',
              status: 'Pending',
              packedAt: null,
              packedBy: null
            };
          }
          ordersMap[orderId].parts.push(partUid);
        });
        // Convert map to array
        const orders = Object.values(ordersMap);
        state.db = { orders };
        saveDatabase();
        alert('המסד נתונים נטען בהצלחה!');
        showHome();
      },
      error: function(err) {
        alert('שגיאה בקריאת CSV: ' + err.message);
      }
    });
  });
}

// Render order scanning screen
function showOrderScan() {
  clearApp();
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <h1>סריקת הזמנה</h1>
    <p>סרוק את ברקוד ההזמנה או הקלד את מספר ההזמנה:</p>
    <div id="scanner-container"></div>
    <input id="orderInput" type="text" placeholder="מספר הזמנה" />
    <p class="warning" id="orderCameraWarn"></p>
    <button id="manualOrderBtn">בחירה ידנית</button>
    <button id="cancelBtn">ביטול</button>
  `;
  appEl.appendChild(card);
  // Start scanner
  startScanner((code) => {
    handleOrderDetected(code);
  });
  document.getElementById('manualOrderBtn').addEventListener('click', () => {
    const val = document.getElementById('orderInput').value.trim();
    if (!val) {
      alert('אנא הזן מספר הזמנה');
      return;
    }
    stopScanner();
    handleOrderDetected(val);
  });
  document.getElementById('cancelBtn').addEventListener('click', () => {
    stopScanner();
    showHome();
  });
  // Show camera warning if camera unavailable
  updateCameraWarning('orderCameraWarn');
}

// Handle detected order number: validate and proceed to part scanning
function handleOrderDetected(orderId) {
  const order = state.db.orders.find((o) => o.orderId === orderId);
  if (!order) {
    alert('הזמנה ' + orderId + ' לא נמצאה במסד הנתונים.');
    // Return to scanning
    showOrderScan();
    return;
  }
  if (order.status === 'Packed') {
    alert('הזמנה זו כבר נארזה.');
    showOrderScan();
    return;
  }
  state.currentOrder = order;
  state.scannedParts = [];
  showPartScan();
}

// Render part scanning screen
function showPartScan() {
  clearApp();
  const card = document.createElement('div');
  card.className = 'card';
  const totalParts = state.currentOrder.parts.length;
  card.innerHTML = `
    <h1>סריקת חלקים</h1>
    <div id="progress">0 / ${totalParts}</div>
    <p>סרוק את החלקים של הזמנה ${state.currentOrder.orderId}:</p>
    <div id="scanner-container"></div>
    <input id="partInput" type="text" placeholder="מספר חלק" />
    <p class="warning" id="partCameraWarn"></p>
    <button id="manualPartBtn">הוסף ידנית</button>
    <button id="cancelPartsBtn">ביטול</button>
  `;
  appEl.appendChild(card);
  updateProgress();
  startScanner((code) => {
    handlePartDetected(code);
  });
  document.getElementById('manualPartBtn').addEventListener('click', () => {
    const val = document.getElementById('partInput').value.trim();
    if (!val) {
      alert('אנא הזן מספר חלק');
      return;
    }
    handlePartDetected(val);
  });
  document.getElementById('cancelPartsBtn').addEventListener('click', () => {
    stopScanner();
    // back to order scanning or home
    showOrderScan();
  });
  // Show camera warning
  updateCameraWarning('partCameraWarn');
}

// Update progress display
function updateProgress() {
  const progressEl = document.getElementById('progress');
  if (progressEl) {
    progressEl.textContent = `${state.scannedParts.length} / ${state.currentOrder.parts.length}`;
  }
}

// Update camera warning message for given element ID
function updateCameraWarning(elementId) {
  const warnEl = document.getElementById(elementId);
  if (!warnEl) return;
  if (canUseCamera()) {
    warnEl.textContent = '';
  } else {
    warnEl.textContent = 'סריקת ברקודים בעזרת מצלמה זמינה רק בעת הרצת האפליקציה משרת מאובטח (HTTPS) או localhost. ניתן להזין ידנית.';
  }
}

// Handle detected part
function handlePartDetected(partId) {
  partId = partId.trim();
  if (!partId) return;
  // Check duplicate
  if (state.scannedParts.includes(partId)) {
    alert('חלק ' + partId + ' כבר נסרק.');
    return;
  }
  // Check if part exists in order
  if (!state.currentOrder.parts.includes(partId)) {
    alert('חלק ' + partId + ' לא שייך להזמנה זו.');
    return;
  }
  state.scannedParts.push(partId);
  updateProgress();
  // Check if finished
  if (state.scannedParts.length === state.currentOrder.parts.length) {
    stopScanner();
    showSummary();
  }
}

// Render summary screen
function showSummary() {
  clearApp();
  const card = document.createElement('div');
  card.className = 'card';
  const missing = state.currentOrder.parts.filter((p) => !state.scannedParts.includes(p));
  const scannedList = state.scannedParts.map((p) => `<li>${p}</li>`).join('');
  const missingList = missing.map((p) => `<li>${p}</li>`).join('');
  card.innerHTML = `
    <h1>סיכום הזמנה ${state.currentOrder.orderId}</h1>
    <p>חלקים שנסרקו (${state.scannedParts.length}):</p>
    <ul class="list">${scannedList || '<li>אין</li>'}</ul>
    <p>חלקים חסרים (${missing.length}):</p>
    <ul class="list">${missingList || '<li>אין</li>'}</ul>
    <button id="markPackedBtn" ${missing.length ? 'disabled' : ''}>סמן כהוזמן נארז</button>
    <button id="backBtn">חזור להתחלה</button>
  `;
  appEl.appendChild(card);
  document.getElementById('backBtn').addEventListener('click', () => {
    showHome();
  });
  const markBtn = document.getElementById('markPackedBtn');
  if (markBtn) {
    markBtn.addEventListener('click', () => {
      // Update order status
      state.currentOrder.status = 'Packed';
      state.currentOrder.packedAt = new Date().toISOString();
      state.currentOrder.packedBy = state.user;
      saveDatabase();
      alert('הזמנה עודכנה כנארזה בהצלחה!');
      showHome();
    });
  }
}

// Render database page with list of orders
function showDatabase() {
  clearApp();
  const card = document.createElement('div');
  card.className = 'card';
  let tableRows = '';
  if (state.db.orders && state.db.orders.length > 0) {
    state.db.orders.forEach((order) => {
      const numParts = order.parts ? order.parts.length : 0;
      const status = order.status || 'Pending';
      const customer = order.customer || '';
      const project = order.project || '';
      const supplyDate = order.supplyDate || '';
      tableRows += `<tr><td>${order.orderId}</td><td>${customer}</td><td>${project}</td><td>${supplyDate}</td><td>${numParts}</td><td>${status}</td></tr>`;
    });
  }
  const tableHtml = state.db.orders && state.db.orders.length > 0
    ? `<table dir="rtl"><thead><tr><th>מספר הזמנה</th><th>לקוח</th><th>פרויקט</th><th>תאריך אספקה</th><th>מספר חלקים</th><th>סטטוס</th></tr></thead><tbody>${tableRows}</tbody></table>`
    : '<p>אין הזמנות במסד הנתונים.</p>';
  card.innerHTML = `
    <h1>מסד נתונים - רשימת הזמנות</h1>
    ${tableHtml}
    <button id="backFromDbBtn">חזרה</button>
  `;
  appEl.appendChild(card);
  document.getElementById('backFromDbBtn').addEventListener('click', () => {
    showHome();
  });

  // End of showDatabase function
}

// Start Quagga scanner with callback on detection
let quaggaActive = false;
function startScanner(onDetected) {
  const scannerEl = document.getElementById('scanner-container');
  if (!scannerEl) return;
  // Clean previous
  scannerEl.innerHTML = '';
  // Check if camera supported
  if (!navigator.mediaDevices || typeof Quagga === 'undefined') {
    // Fallback: no camera or Quagga not loaded; skip scanning
    console.warn('Camera or Quagga not available.');
    return;
  }
  quaggaActive = true;
  Quagga.init({
    inputStream: {
      type: 'LiveStream',
      target: scannerEl,
      constraints: {
        width: 320,
        height: 240,
        facingMode: 'environment'
      },
      area: { // define rectangle of the detection/localization area
        top: '0%',    // top offset
        right: '0%',  // right offset
        left: '0%',   // left offset
        bottom: '0%'  // bottom offset
      }
    },
    decoder: {
      readers: [
        'code_128_reader',
        'ean_reader',
        'ean_8_reader',
        'code_39_reader',
        'upc_reader',
        'codabar_reader',
        'i2of5_reader'
      ]
    },
    locate: true
  }, function(err) {
    if (err) {
      console.error(err);
      return;
    }
    Quagga.start();
  });
  Quagga.onDetected(function(result) {
    if (!quaggaActive) return;
    const code = result.codeResult.code;
    if (code) {
      quaggaActive = false;
      Quagga.stop();
      onDetected(code);
    }
  });
}

// Stop Quagga scanner
function stopScanner() {
  if (quaggaActive && typeof Quagga !== 'undefined') {
    Quagga.stop();
  }
  quaggaActive = false;
}

// Initialise app
function init() {
  // Load DB and user from storage
  loadDatabase();
  const savedUser = localStorage.getItem('barcodeAppUser');
  if (savedUser) {
    state.user = savedUser;
    showHome();
  } else {
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', init);