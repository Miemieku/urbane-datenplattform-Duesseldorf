const API_BASE_URL = "https://datenplattform-essen.netlify.app/.netlify/functions/ubaProxy?";
let stationCoords = {}; // 存储Düsseldorf测量站点
let components = {}; // 存储污染物 ID → 名称
let mapMarkers = {};

// 获取污染物 ID → 名称
fetch("./components.json") // 确保路径正确
    .then(response => response.json())
    .then(data => {
        console.log("Komponenten JSON Datei geladen:", data);

        if (!data || !data[1]) {
            console.warn("⚠️ Keine gültigen Schadstoffdaten gefunden!");
            return;
        }

        // 遍历 JSON 数据，将污染物 ID 映射到名称和单位
        Object.values(data).forEach(entry => {
            const pollutantId = entry[0]; // 例如 "1"
            const pollutantCode = entry[1]; // 例如 "PM2"
            const pollutantSymbol = entry[2]
            const pollutantUnit = entry[3]; // 例如 "µg/m³"

            components[pollutantId] = { code: pollutantCode, symbol: pollutantSymbol, unit: pollutantUnit };
        });

        console.log("Schadstoff-Komponenten gespeichert:", components);
    })
    .catch(error => {
        console.error("❌Fehler beim Laden der Schadstoff-Komponenten:", error);
    });

// 获取Düsseldorf测量站坐标
function fetchStationCoordinates() {
    const apiUrl = `${API_BASE_URL}api=stationCoordinates`;

    return fetch(apiUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error('Netzwerkantwort war nicht ok');
            }
            return response.json();
        })
        .then(data => {
            if (!data || !data.data) {
                throw new Error('Ungültige Datenstruktur');
            }

            console.log("📌Alle Messstationen Daten:", data);

            // 🚀 **确保 `data.data` 是数组**
            let stations = Array.isArray(data.data) ? data.data : Object.values(data.data);

            // 过滤出 Düsseldorf
            let filteredStations = stations.filter(entry => 
                entry[3] === "Düsseldorf" && entry[6] === null
            );
            
            // 先检查是否有匹配的 Düsseldorf 站点
            console.log("📌过滤后的 Düsseldorf 站点:", filteredStations);
            // `3` 是城市名称字段

            if (filteredStations.length === 0) {
                console.warn("⚠️Keine Messstationen für Düsseldorf gefunden!");
                return;
            }

            filteredStations.forEach(entry => {
                let stationId = entry[1];  // Code，例如 "DENW134"
                let stationName = entry[2];  // 名称，例如 "Essen-Steele"
                let city = entry[3];        // 城市名 "Essen"
                let lat = parseFloat(entry[8]); // 纬度
                let lon = parseFloat(entry[7]); // 经度

                stationCoords[stationId] = { city, stationName, lat, lon };
            });

            console.log("Stationen in Düsseldorf gespeichert:", stationCoords);
        })
        .catch(error => {
            console.error('Fehler beim Abrufen der Messstationen:', error);
        });
}

// 获取当前时间
function getCurrentTime() {
    const now = new Date();
    console.log("当前时间:", now.toISOString());
    console.log("时区偏移:", now.getTimezoneOffset());
    const date = now.toISOString().split("T")[0]; // YYYY-MM-DD
    let hour = now.getHours() - 2; // 🚀 取上2个小时的数据

    if (hour < 0) {
        hour = 23; // 取前一天的 23:00 数据
        date = new Date(now.setDate(now.getDate() - 1)).toISOString().split("T")[0]; // 取前一天的日期
    }
    return { date, hour };
}

// 获取空气质量数据
function fetchAirQualityData(stationId) {
    const { date, hour } = getCurrentTime();
    const apiUrl = `${API_BASE_URL}api=airQuality&date_from=${date}&date_to=${date}&time_from=${hour}&time_to=${hour}&station=${stationId}`;

    return fetch(apiUrl)
    .then(response => response.json())
    .then(data => {
        console.log(`API Antwort für ${stationId}:`, data);

        if (!data || !data.data) {
            return null;
        }

        const actualStationId = data.request?.station; // 确保 ID 正确
        const timeto = data.request?.time_to;
        const dateto = data.request?.date_to;
        console.log(`Station ID Mapping: ${stationId} → ${actualStationId}`);

        return { stationId: actualStationId, data: data.data[0],endtime: timeto, enddate: dateto };
    })
        .catch(error => {
            console.error(`Fehler beim Laden der Luftqualität für ${stationId}:`, error);
            return null;
        });
}

// 返回污染物值的等级（1=Sehr gut, 5=Sehr schlecht）
function getPollutantLevel(code, value) {
    if (value === null || value === undefined) return 1;

    switch (code) {
        case "NO2":
            if (value > 200) return 5;
            else if (value > 100) return 4;
            else if (value > 40) return 3;
            else if (value > 20) return 2;
            else return 1;

        case "PM10":
            if (value > 100) return 5;
            else if (value > 50) return 4;
            else if (value > 35) return 3;
            else if (value > 20) return 2;
            else return 1;

        case "PM2":  
            if (value > 50) return 5;
            else if (value > 25) return 4;
            else if (value > 20) return 3;
            else if (value > 10) return 2;
            else return 1;

        case "O3":
            if (value > 240) return 5;
            else if (value > 180) return 4;
            else if (value > 120) return 3;
            else if (value > 60) return 2;
            else return 1;

        default:
            return 1; // 默认很好
    }
}


//  获得最差等级
function getWorstIndexLevel(NO2, PM10, PM2, O3) {
  let level = 1; // 默认最优（sehr gut）

  if (NO2 > 200 || PM10> 100 || PM2 > 50 || O3 > 240) level = 5;
  else if (NO2 > 100 || PM10 > 50 || PM2 > 25 || O3 > 180) level = 4;
  else if (NO2 > 40 || PM10 > 35 || PM2 > 20 || O3 > 120) level = 3;
  else if (NO2 > 20 || PM10 > 20 || PM2 > 10 || O3 > 60) level = 2;

  return level;
}

//  获得颜色
function getWorstIndexColor(NO2, PM10, PM2, O3) {
  const level = getWorstIndexLevel(NO2, PM10, PM2, O3);
  
  const colorMap = {
    1: '#00cccc', // sehr gut
    2: '#00cc99', // gut
    3: '#ffff66', // mäßig
    4: '#cc6666', // schlecht
    5: '#990033'  // sehr schlecht
  };

  return colorMap[level];
}

//  在地图上添加测量站点
function addStationsToMap() {
    Object.keys(stationCoords).forEach(stationId => {
        fetchAirQualityData(stationId).then(result => {
            if (!result || !result.data) {
                console.warn(`⚠️Keine Luftqualitätsdaten ${stationId}`);
                return;
            }

            let actualStationId = result.stationId;
            let timestamps = Object.keys(result.data);
            if (timestamps.length === 0) {
                console.warn(`⚠️Keine Messwerte für ${actualStationId}`);
                return;
            }

            let latestTimestamp = timestamps[timestamps.length - 1];
            let actualTimestamp = result.data[latestTimestamp][0];
            let pollutantData = result.data[latestTimestamp].slice(3);

            // 从污染物数据中提取数值
            let valueMap = {};
            pollutantData.forEach(entry => {
                const pollutantId = entry[0];
                const value = entry[1];
                const code = components[pollutantId]?.code|| `ID ${pollutantId}`;
                valueMap[code] = value;
            });

            //  从值中提取目标污染物（默认为 0）
            const NO2 = valueMap["NO2"] || 0;
            const PM10 = valueMap["PM10"] || 0;
            const PM2 = valueMap["PM2"] || 0;
            const O3  = valueMap["O3"]  || 0;
            const color = getWorstIndexColor(NO2, PM10, PM2, O3);
            const latLng = [stationCoords[stationId].lat, stationCoords[stationId].lon];
            const level = getWorstIndexLevel(NO2, PM10, PM2, O3);
            const qualityTextMap = {
                1: "Sehr gut",
                2: "Gut",
                3: "Mäßig",
                4: "Schlecht",
                5: "Sehr schlecht"
            };
            const qualityLabel = qualityTextMap[level];
            console.log("🧪 valueMap 检查", valueMap);

            //  使用 Leaflet CircleMarker
            const circle = L.circleMarker(latLng, {
                radius: 10,
                fillColor: color,
                fillOpacity: 0.8,
                color: "#333",
                weight: 1
            });

            // Tooltip（站点名）
            circle.bindTooltip(stationCoords[stationId].stationName || actualStationId, {
                permanent: false,
                sticky: true
            });

            // Popup 内容（详细数据）
            let popupContent = `
            <h3>${stationCoords[stationId].stationName}</h3>
            `;

            // 点击显示右侧信息栏
            circle.on("click", () => {
                showDataInPanel(
                    stationCoords[stationId].stationName,
                    actualTimestamp,
                    pollutantData,
                    stationId,
                    result.enddate,
                    result.endtime
                );
            });

            circle.addTo(map);
            mapMarkers[actualStationId] = circle;
        });
    });
}


function showDataInPanel(stationName, timestamp, pollutantData, stationId, enddate, endtime) {
  const wrapper = document.getElementById("info-panel");
  const content = document.getElementById("air-quality-panel");

  if (!wrapper || !content) return;

  // 计算测量时间段（1小时区间）
  const dateString = `${enddate} ${endtime}`;
  const end = new Date(dateString);
  const formatTime = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`;

  function formatTimeDE(date) {
    return date.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).replace(",", "");
  }

  // 生成污染物值映射
  const values = {};
  pollutantData.forEach(([id, value]) => {
    const info = components[id];
    if (info) {
      values[info.code] = {
        value,
        unit: info.unit,
        symbol: info.symbol,
        level: getPollutantLevel(info.code, value)
      };
    }
  });

  // 从值中提取目标污染物（默认为 0）
  const NO2 = values["NO2"]?.value || 0;
  const PM10 = values["PM10"]?.value || 0;
  const PM2 = values["PM2"]?.value || 0;
  const O3 = values["O3"]?.value || 0;

  // 计算 Luftqualität 总体等级
  const overallLevel = getWorstIndexLevel(NO2, PM10, PM2, O3);

  const qualityTextMap = {
    1: "Sehr gut",
    2: "Gut",
    3: "Mäßig",
    4: "Schlecht",
    5: "Sehr schlecht"
  };
  const qualityLabel = qualityTextMap[overallLevel];

  // 颜色表
  const colorMap = {
    1: "#00cccc",
    2: "#00cc99",
    3: "#ffff66",
    4: "#cc6666",
    5: "#990033"
  };

  // 健康提示
  const healthHints = {
    1: "Beste Voraussetzungen, um sich ausgiebig im Freien aufzuhalten.",
    2: "Genießen Sie Ihre Aktivitäten im Freien, gesundheitlich nachteilige Wirkungen sind nicht zu erwarten.",
    3: "Kurzfristige nachteilige Auswirkungen auf die Gesundheit sind unwahrscheinlich. Allerdings können Effekte durch Luftschadstoffkombinationen und bei langfristiger Einwirkung des Einzelstoffes nicht ausgeschlossen werden. Zusätzliche Reize, z.B. ausgelöst durch Pollenflug, können die Wirkung der Luftschadstoffe verstärken, so dass Effekte bei empfindlichen Personengruppen (z.B. Asthmatikern) wahrscheinlicher werden.",
    4: "Bei empfindlichen Menschen können nachteilige gesundheitliche Wirkungen auftreten. Diese sollten körperlich anstrengende Tätigkeiten im Freien vermeiden. In Kombination mit weiteren Luftschadstoffen können auch weniger empfindliche Menschen auf die Luftbelastung reagieren.",
    5: "Negative gesundheitliche Auswirkungen können auftreten. Wer empfindlich ist oder vorgeschädigte Atemwege hat, sollte körperliche Anstrengungen im Freien vermeiden."
  };
  const healthText = healthHints[overallLevel];

  // 构建 HTML
  const messzeitHtml = `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px;">
      <div>
        <b style="color: #34495e;">Messzeit:</b>
        ${formatTimeDE(end)}
      </div>
      <button class="btn-history" id="btn-history" style="margin-left: 10px;">Vergangene 24 Stunden</button>
    </div>
  `;

  let html = `
    <h3 style="color: #2c3e50; margin-bottom: 15px;">${stationName}</h3>
    <p style="margin-bottom: 10px;"><strong style="color: #34495e;">Luftqualität:</strong> 
      <span style="font-size: 1.5em; font-weight: bold; color: ${
        colorMap[overallLevel]
      };">${qualityLabel}</span>
    </p>
    ${messzeitHtml}
    <hr style="border-color: #ecf0f1;">
    <h4 style="color: #2c3e50; margin: 20px 0 15px 0;">Schadstoffkonzentrationen</h4>
    <ul style="list-style:none; padding:0;">`;

  ["NO2", "PM10", "O3", "PM2"].forEach((code) => {
    if (values[code]) {
      const { value, unit, symbol, level } = values[code];
      const dot = `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${colorMap[level]};margin-right:6px;"></span>`;
      html += `<li style="margin-bottom: 8px; color: #34495e; font-size: 14px;">${dot} <strong style="color: #2c3e50;">${symbol}:</strong> ${
        value !== null ? value : "-"
      } <span style="color: #7f8c8d; font-size: 12px;">${unit}</span></li>`;
    }
  });

  html += `</ul>
  <h4 style="color: #2c3e50; margin: 20px 0 15px 0;">Gesundheitshinweise und Empfehlungen:</h4>
  <p style="font-size:0.95em; color:#34495e; line-height: 1.5; margin-bottom: 20px;">${healthText}</p>
    <hr style="border-color: #ecf0f1;">
    <h4 style="color: #2c3e50; margin: 20px 0 15px 0;">Index-Farblegende</h4>
    <div style="margin-bottom: 20px;">
      <span style="display:inline-block;width:15px;height:15px;background:#00cccc;margin-right:5px;"></span><span style="color: #34495e;">Sehr gut</span>
      <span style="display:inline-block;width:15px;height:15px;background:#00cc99;margin:0 10px;"></span><span style="color: #34495e;">Gut</span>
      <span style="display:inline-block;width:15px;height:15px;background:#ffff66;margin:0 10px;"></span><span style="color: #34495e;">Mäßig</span>
      <span style="display:inline-block;width:15px;height:15px;background:#cc6666;margin:0 10px;"></span><span style="color: #34495e;">Schlecht</span>
      <span style="display:inline-block;width:15px;height:15px;background:#990033;margin:0 10px;"></span><span style="color: #34495e;">Sehr schlecht</span>
    </div>
    <p style="margin-top:15px;font-size:0.85em; color: #7f8c8d;">
      <strong style="color: #34495e;">Quelle:</strong> Umweltbundesamt<br>
      <strong style="color: #34495e;">Weiter Informationen:</strong> <a href="https://www.umweltbundesamt.de/berechnungsgrundlagen-luftqualitaetsindex" target="_blank" style="color: #3498db; text-decoration: none;">
      Umweltbundesamt – Berechnungsgrundlagen Luftqualitätsindex</a>
    </p>
  `;

  content.innerHTML = html;
  wrapper.classList.add("visible");

  // 绑定按钮事件
  const btnHistory = document.getElementById("btn-history");
  if (btnHistory) {
    btnHistory.onclick = function() {
      document.getElementById("history-modal").classList.add("active");
      // 这里调用曲线渲染函数
      loadAndRenderHistoryChart(stationId); // 你需要把当前站点ID传进来
    };
  }

  // 关闭按钮事件建议只绑定一次（在 DOMContentLoaded 里）：
  document.addEventListener("DOMContentLoaded", function () {
    const closeModal = document.getElementById("close-modal");
    if (closeModal) {
      closeModal.onclick = function() {
        document.getElementById("history-modal").classList.remove("active");
      };
    }
  });
}

async function loadAndRenderHistoryChart(stationId) {
  const url = `/.netlify/functions/supabaseProxy?stationId=${stationId}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!data || data.length === 0) {
    alert("Keine Daten in den letzten 24 Stunden verfügbar.");
    return;
  }

  const labels = data.map(row => new Date(row.timestamp).toLocaleTimeString("de-DE", {hour:"2-digit",minute:"2-digit"}));
  const pm10 = data.map(row => row.pm10);
  const no2 = data.map(row => row.no2);
  const pm25 = data.map(row => row.pm25);
  const o3 = data.map(row => row.o3);

  renderLineChart("chart-pm10", labels, pm10, "Feinstaub PM10", "#00e6e6");
  renderLineChart("chart-no2", labels, no2, "Stickstoffdioxid (NO₂)", "#00bfff");
  renderLineChart("chart-pm25", labels, pm25, "Feinstaub PM2,5", "#00ff99");
  renderLineChart("chart-o3", labels, o3, "Ozon (O₃)", "#00ffcc");
}

function renderLineChart(canvasId, labels, data, label, color) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  // 销毁旧图表（防止多次渲染重叠）
  if (window[canvasId + "_chart"]) {
    window[canvasId + "_chart"].destroy();
  }
  window[canvasId + "_chart"] = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: label,
        data: data,
        borderColor: color,
        backgroundColor: color + "33",
        fill: true,
        tension: 0.2
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { title: { display: true, text: "µg/m³" } },
        x: { title: { display: true, text: "Uhrzeit" } }
      }
    }
  });
}



// 6️⃣ 监听 `Luftqualität` 复选框
document.addEventListener("DOMContentLoaded", function () {
    fetchStationCoordinates().then(() => {
        document.getElementById("air-quality").addEventListener("change", function () {
            if (this.checked) {
                addStationsToMap();
            } else {
                Object.keys(mapMarkers).forEach(stationId => map.removeLayer(mapMarkers[stationId]));
                mapMarkers = {};
            }
        });
    });
});

