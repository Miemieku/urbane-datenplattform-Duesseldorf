const fetch = require("node-fetch");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const STATION_API = "https://www.umweltbundesamt.de/api/air_data/v2/stations/json?use=airquality&lang=de";
const AIR_API = "https://www.umweltbundesamt.de/api/air_data/v2/airquality/json";

// 获取所有 Düsseldorf 测站
async function getDusseldorfStations() {
  const res = await fetch(STATION_API);
  const json = await res.json();
  const stations = json.data || [];
  
  return stations
    .filter(st => st[3] === "Düsseldorf") // 城市字段 = Düsseldorf
    .map(st => ({
      id: st[1],       // stationId
      name: st[2],     // stationName
      city: st[3],
      lat: st[8],
      lon: st[7]
    }));
}

// 获取单个站点的最新数据
async function fetchAirQuality(stationId) {
  const now = new Date();
  const hour = now.getHours() === 0 ? 23 : now.getHours() - 1;
  const date = now.getHours() === 0
    ? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split("T")[0]
    : now.toISOString().split("T")[0];

  const apiUrl = `${AIR_API}?date_from=${date}&date_to=${date}&time_from=${hour}&time_to=${hour}&station=${stationId}`;
  console.log(`📡 Fetching data for station ${stationId} ...`);
  
  const response = await fetch(apiUrl);
  const data = await response.json();

  if (!data || !data.data) return null;

  const entry = Object.values(data.data)[0];
  const latestKey = Object.keys(entry).pop();
  const latestValues = entry[latestKey].slice(3);

  const pollutants = {};
  latestValues.forEach(([id, val]) => {
    if (id == 5) pollutants.no2 = val;
    if (id == 1) pollutants.pm10 = val;
    if (id == 9) pollutants.pm25 = val;
    if (id == 3) pollutants.o3 = val;
  });

  return { timestamp: latestKey, ...pollutants };
}

// 插入数据到 Supabase
async function insertIntoSupabase(station, data) {
  if (!data) return;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/luftqualitaet`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    },
    body: JSON.stringify({
      station_id: station.id,
      station_name: station.name,
      timestamp: data.timestamp,
      no2: data.no2,
      pm10: data.pm10,
      pm25: data.pm25,
      o3: data.o3
    })
  });

  if (!res.ok) {
    console.error(`❌ Fehler bei Insert (${station.id}):`, await res.text());
  } else {
    console.log(`✅ Erfolgreich gespeichert: ${station.name} (${station.id})`);
  }
}

async function main() {
  const stations = await getDusseldorfStations();
  console.log(`📍 ${stations.length} Stationen in Düsseldorf gefunden`);

  for (const st of stations) {
    const data = await fetchAirQuality(st.id);
    await insertIntoSupabase(st, data);
  }
}

main();