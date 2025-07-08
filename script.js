/*******************************************************************
 * Copyright (C) 2025 大森　俊平 (Shumpei Omori)
 * [shunpei.o@kokushikan.ac.jp]
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *******************************************************************/

// =================================================================================
//  定数定義 (DOM要素の取得)
// =================================================================================
const cprTimeDisplay = document.getElementById("time_cpr");
const ccTimeDisplay = document.getElementById("time_cc");
const rateDisplay = document.getElementById("rate");
const logDisplay = document.getElementById("log_interruption");
const customLogInput = document.getElementById("customLogInput");

const resetButton = document.getElementById("button-reset");
const cprButton = document.getElementById("button-cpr");
const ccButton = document.getElementById("button-cc");
const downloadCsvButton = document.getElementById("button-download-csv");

// =================================================================================
//  グローバル変数 (アプリ全体の状態を管理)
// =================================================================================
let cprTime = 0, ccTime = 0, elapsedSeconds = 0, logText = "";
let isCprRunning = false, isCompressing = false;
let cprStartTime, ccStartTime;
let tickInterval;
let eventLog = [];
let interruptionStartTime = null; // ★追加: 圧迫中断の開始時刻を記録する変数

// =================================================================================
//  グラフ (Chart.js) の設定
// =================================================================================
const ccfData = {
  labels: [],
  datasets: [{
    label: 'CCF (%)', data: [], borderColor: 'rgba(75, 192, 192, 1)',
    backgroundColor: 'rgba(75, 192, 192, 0.2)', fill: true, tension: 0.1, pointRadius: 0
  }]
};
const ccfChart = new Chart(document.getElementById('ccfChart'), {
  type: 'line', data: ccfData,
  options: {
    responsive: true, maintainAspectRatio: false,
    scales: {
      y: { min: 0, max: 100, title: { display: true, text: 'CCF (%)' }},
      x: {
        type: 'linear', title: { display: true, text: '時間 (分:秒)' },
        ticks: {
          callback: function(value) {
            const m = String(Math.floor(value / 60)).padStart(2, '0');
            const s = String(value % 60).padStart(2, '0');
            return `${m}:${s}`;
          }
        }
      }
    },
    plugins: { annotation: { annotations: {} } }
  }
});

// =================================================================================
//  コア機能 (タイマー、表示更新など)
// =================================================================================
function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const minutes = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  const deci = Math.floor((ms % 1000) / 100);
  return `${minutes}:${seconds}.${deci}`;
}

function formatLogTime(seconds) {
  const minutes = String(Math.floor(seconds / 60)).padStart(2, '0');
  const sec = String(seconds % 60).padStart(2, '0');
  return `${minutes}:${sec}`;
}

function updateDisplay() {
  cprTimeDisplay.textContent = `CPR: ${formatTime(cprTime)}`;
  ccTimeDisplay.textContent = `圧迫: ${formatTime(ccTime)}`;
  const rate = cprTime > 0 ? Math.floor((ccTime / cprTime) * 100) : 0;
  rateDisplay.textContent = `圧迫率: ${rate}%`;
}

function updateButtonStates() {
  cprButton.textContent = isCprRunning ? "現場離脱/測定終了" : "傷病者接触";
  cprButton.style.backgroundColor = isCprRunning ? "#D32F2F" : "#4CAF50";
  if (isCprRunning) {
    ccButton.disabled = false;
    ccButton.textContent = isCompressing ? "圧迫 停止" : "圧迫 開始";
    ccButton.style.backgroundColor = isCompressing ? "#1565C0" : "#1976D2";
  } else {
    ccButton.disabled = true;
    ccButton.textContent = "胸骨圧迫";
    ccButton.style.backgroundColor = "#9E9E9E";
  }
}

function tick() {
  const now = Date.now();
  if (isCprRunning) {
    cprTime += now - cprStartTime;
    cprStartTime = now;
    if (isCompressing) {
      ccTime += now - ccStartTime;
      ccStartTime = now;
    }
    const totalElapsed = Math.floor(cprTime / 1000);
    if (totalElapsed > elapsedSeconds) {
      elapsedSeconds = totalElapsed;
      const currentRate = cprTime > 0 ? Math.floor((ccTime / cprTime) * 100) : 0;
      ccfData.labels.push(elapsedSeconds);
      ccfData.datasets[0].data.push(currentRate);
      ccfChart.update('none');
    }
  }
  updateDisplay();
}

function addLog(action) {
  if (!isCprRunning && action !== "現場離脱/測定終了") return;
  const timeStr = formatLogTime(elapsedSeconds);
  logText += `<div class="log-entry">[${timeStr}] ${action}</div>`;
  logDisplay.innerHTML = logText;
  logDisplay.scrollTop = logDisplay.scrollHeight;
  eventLog.push({ time: elapsedSeconds, event: action });
  if (action === '圧迫開始' || action === '圧迫停止' || action.startsWith('圧迫中断')) {
    ccfChart.update('none');
    return;
  }
  const id = `log-${Date.now()}`;
  ccfChart.options.plugins.annotation.annotations[id] = {
    type: 'line', xMin: elapsedSeconds, xMax: elapsedSeconds, borderColor: 'red', borderWidth: 1,
    label: { content: action, enabled: true, position: 'start', backgroundColor: 'rgba(0,0,0,0.6)', color: 'white', font: { size: 10 }, yAdjust: (Object.keys(ccfChart.options.plugins.annotation.annotations).length % 2 === 0) ? -10 : 10 }
  };
  ccfChart.update('none');
}

function addCustomLog() {
  const value = customLogInput.value.trim();
  if (value && isCprRunning) {
    addLog(value);
    customLogInput.value = "";
  }
}

function generateCsvContent() {
  const header = 'Time (s),Time (mm:ss),CCF (%),Event\n';
  let csvRows = [header];
  const logMap = new Map();
  for (const log of eventLog) {
    if (!logMap.has(log.time)) {
      logMap.set(log.time, []);
    }
    logMap.get(log.time).push(log.event);
  }
  const maxSeconds = ccfData.labels.length;
  for (let i = 0; i < maxSeconds; i++) {
    const timeSec = ccfData.labels[i];
    const timeFormatted = formatLogTime(timeSec);
    const ccf = ccfData.datasets[0].data[i];
    const events = logMap.has(timeSec) ? logMap.get(timeSec).join('; ') : '';
    csvRows.push(`${timeSec},${timeFormatted},${ccf},"${events}"`);
  }
  return csvRows.join('\n');
}

function downloadCsv() {
  const csvContent = generateCsvContent();
  const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
  const blob = new Blob([bom, csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const fileName = `cpr_log_${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}.csv`;
  link.setAttribute("href", url);
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// =================================================================================
//  イベントリスナー
// =================================================================================
cprButton.addEventListener("click", () => {
  isCprRunning = !isCprRunning;
  if (isCprRunning) {
    cprStartTime = Date.now();
    tickInterval = setInterval(tick, 100);
    addLog("傷病者接触");
  } else {
    clearInterval(tickInterval);
    addLog("現場離脱/測定終了");
    isCompressing = false;
    interruptionStartTime = null; // ★変更: CPR終了時にも中断タイマーをリセット
  }
  updateButtonStates();
});

// ★★★ ここが一番の変更点 ★★★
ccButton.addEventListener("click", () => {
  if (!isCprRunning) return;

  isCompressing = !isCompressing;

  if (isCompressing) {
    // === 圧迫を開始した時の処理 ===
    // 中断時間が記録されていれば、ログに出力
    if (interruptionStartTime) {
      const interruptionSeconds = ((Date.now() - interruptionStartTime) / 1000).toFixed(1);
      addLog(`圧迫中断: ${interruptionSeconds}秒`);
      interruptionStartTime = null; // 中断タイマーをリセット
    }
    addLog("圧迫開始");
    ccStartTime = Date.now();
  } else {
    // === 圧迫を停止した時の処理 ===
    addLog("圧迫停止");
    interruptionStartTime = Date.now(); // 中断開始時刻を記録
  }
  
  updateButtonStates();
});

// ★変更: リセット処理に中断タイマーの初期化を追加
resetButton.addEventListener("click", () => {
  clearInterval(tickInterval);
  cprTime = 0; ccTime = 0; elapsedSeconds = 0; logText = "";
  isCprRunning = false; isCompressing = false;
  eventLog = [];
  interruptionStartTime = null; // 中断タイマーをリセット
  
  logDisplay.innerHTML = "";
  updateDisplay();
  updateButtonStates();

  ccfData.labels = [];
  ccfData.datasets[0].data = [];
  ccfChart.options.plugins.annotation.annotations = {};
  ccfChart.update('none');
});

downloadCsvButton.addEventListener("click", downloadCsv);
customLogInput.parentElement.querySelector('button').addEventListener('click', addCustomLog);


// =================================================================================
//  初期化処理
// =================================================================================
updateButtonStates();