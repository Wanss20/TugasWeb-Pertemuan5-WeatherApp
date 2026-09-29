/* =========================================================
   Cuaca — Weather App
   Tugas Rutin 5 — Pemrograman Web
   Tampilan mengikuti aplikasi Cuaca bawaan iPhone.
   Dibangun dengan ES6+, async/await + Fetch API ke OpenWeatherMap.
   ========================================================= */

// ---------------------------------------------------------
// 1. KONFIGURASI
// ---------------------------------------------------------
// Daftar gratis di https://openweathermap.org/api lalu tempel API key
// Anda di sini. JANGAN commit API key asli ke repo publik di proyek
// nyata — untuk tugas ini menempelnya langsung di file cukup.
const CONFIG = {
  API_KEY: "4e05b4e4873f8ee4b314d1abd216aa72",
  BASE_URL: "https://api.openweathermap.org/data/2.5",
  HISTORY_KEY: "cuacaKini.history",
  MAX_HISTORY: 5,
};

// ---------------------------------------------------------
// 2. STATE APLIKASI
// ---------------------------------------------------------
const state = {
  unit: "metric", // 'metric' = °C; 'imperial' dihitung via konversi manual
  current: null, // respons /weather apa adanya (selalu dalam Celsius)
  tz: 0, // offset zona waktu kota (detik dari UTC), dari field `timezone`
  hourly: [], // [{ label, temp, icon }]
  daily: [], // [{ dt, min, max, icon, main }]
  history: loadHistory(),
  activeSkyLayer: "a", // layer sky yang sedang tampil, untuk crossfade
};

// ---------------------------------------------------------
// 3. REFERENSI DOM
// ---------------------------------------------------------
const els = {
  form: document.getElementById("searchForm"),
  input: document.getElementById("cityInput"),
  unitButtons: document.querySelectorAll(".unit-switch__btn"),
  historyRow: document.getElementById("historyRow"),
  content: document.getElementById("content"),
  skyA: document.querySelector(".sky__layer--a"),
  skyB: document.querySelector(".sky__layer--b"),
};

// ---------------------------------------------------------
// 4. ERROR KUSTOM
// ---------------------------------------------------------
class WeatherError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "WeatherError";
    this.code = code; // 'NOT_FOUND' | 'NETWORK' | 'NO_API_KEY' | 'UNAUTHORIZED' | 'UNKNOWN'
  }
}

// ---------------------------------------------------------
// 5. PEMANGGILAN API
// ---------------------------------------------------------
async function fetchCurrentWeather(city) {
  if (CONFIG.API_KEY === "GANTI_DENGAN_API_KEY_ANDA") {
    throw new WeatherError(
      "API key belum diisi. Buka script.js, ganti CONFIG.API_KEY dengan API key OpenWeatherMap Anda sendiri (lihat README.md bagian 'Cara Mendapatkan API Key').",
      "NO_API_KEY"
    );
  }

  const url = `${CONFIG.BASE_URL}/weather?q=${encodeURIComponent(
    city
  )}&units=metric&lang=id&appid=${CONFIG.API_KEY}`;

  let response;
  try {
    response = await fetch(url);
  } catch (networkErr) {
    throw new WeatherError(
      "Gangguan jaringan. Periksa koneksi internet Anda dan coba lagi.",
      "NETWORK"
    );
  }

  if (response.status === 404) {
    throw new WeatherError(
      "Kota tidak ditemukan. Periksa kembali penulisan nama kota.",
      "NOT_FOUND"
    );
  }

  if (response.status === 401) {
    throw new WeatherError(
      "API key ditolak. Jika baru saja membuat API key, tunggu hingga ± 2 jam sampai aktif, atau periksa kembali penulisannya di script.js.",
      "UNAUTHORIZED"
    );
  }

  if (!response.ok) {
    throw new WeatherError(
      "Terjadi kesalahan saat mengambil data cuaca. Coba lagi sebentar lagi.",
      "UNKNOWN"
    );
  }

  return response.json();
}

async function fetchForecastList(city) {
  const url = `${CONFIG.BASE_URL}/forecast?q=${encodeURIComponent(
    city
  )}&units=metric&lang=id&appid=${CONFIG.API_KEY}`;

  let response;
  try {
    response = await fetch(url);
  } catch (networkErr) {
    return []; // ramalan bersifat pelengkap — gagal diam-diam, hero tetap tampil
  }

  if (!response.ok) return [];

  const data = await response.json();
  return data.list || [];
}

// ---------------------------------------------------------
// 6. OLAH DATA RAMALAN (map / reduce / sort / flatMap)
// ---------------------------------------------------------
function localDateKey(unixSeconds, tzOffsetSeconds) {
  const d = new Date((unixSeconds + tzOffsetSeconds) * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function buildHourly(current, list) {
  const now = {
    label: "Sekarang",
    temp: current.main.temp,
    icon: current.weather[0].icon,
  };
  const rest = list.slice(0, 7).map((item) => ({
    label: formatLocalTime(item.dt, state.tz),
    temp: item.main.temp,
    icon: item.weather[0].icon,
  }));
  return [now, ...rest];
}

function buildDailyForecast(list, tzOffsetSeconds) {
  // Kelompokkan 40 entri 3-jam-an menjadi per hari menggunakan reduce
  const groups = list.reduce((acc, item) => {
    const key = localDateKey(item.dt, tzOffsetSeconds);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  // map: ubah setiap kelompok menjadi ringkasan { min, max, icon }
  return Object.values(groups)
    .map((entries) => {
      const temps = entries.map((e) => e.main.temp);
      const middle = entries[Math.floor(entries.length / 2)];
      return {
        dt: entries[0].dt,
        min: Math.min(...temps),
        max: Math.max(...temps),
        icon: middle.weather[0].icon,
        main: middle.weather[0].main,
      };
    })
    .sort((a, b) => a.dt - b.dt)
    .slice(0, 5);
}

// ---------------------------------------------------------
// 7. TEMA LANGIT DINAMIS (berdasarkan kondisi cuaca sungguhan)
// ---------------------------------------------------------
function skyThemeFor(main, iconCode) {
  const isNight = iconCode.endsWith("n");
  const map = {
    Thunderstorm: "thunderstorm",
    Drizzle: "rain",
    Rain: "rain",
    Snow: "snow",
    Mist: "mist",
    Smoke: "mist",
    Haze: "mist",
    Dust: "mist",
    Fog: "mist",
    Sand: "mist",
    Ash: "mist",
    Squall: "mist",
    Tornado: "mist",
    Clouds: "clouds",
    Clear: isNight ? "clear-night" : "clear-day",
  };
  return map[main] || "clouds";
}

function setSkyTheme(themeName) {
  const layers = { a: els.skyA, b: els.skyB };
  const current = layers[state.activeSkyLayer];
  const nextKey = state.activeSkyLayer === "a" ? "b" : "a";
  const next = layers[nextKey];

  next.className = `sky__layer sky__layer--${nextKey} sky--${themeName} is-visible`;
  current.classList.remove("is-visible");
  state.activeSkyLayer = nextKey;
}

// ---------------------------------------------------------
// 8. HELPER FORMAT
// ---------------------------------------------------------
function celsiusToFahrenheit(celsius) {
  return celsius * (9 / 5) + 32;
}

function formatTemp(celsiusValue) {
  const value =
    state.unit === "imperial" ? celsiusToFahrenheit(celsiusValue) : celsiusValue;
  const unitLabel = state.unit === "imperial" ? "°F" : "°C";
  return `${Math.round(value)}${unitLabel}`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatLocalTime(unixSeconds, tzOffsetSeconds) {
  const d = new Date((unixSeconds + tzOffsetSeconds) * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}.${mm}`;
}

function formatDayLabel(unixSeconds, tzOffsetSeconds) {
  const days = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const d = new Date((unixSeconds + tzOffsetSeconds) * 1000);
  return days[d.getUTCDay()];
}

function degToCompass(deg) {
  const dirs = ["U", "TL", "T", "TG", "S", "BD", "B", "BL"];
  return dirs[Math.round(deg / 45) % 8];
}

function iconUrl(iconCode, size = "@2x") {
  return `https://openweathermap.org/img/wn/${iconCode}${size}.png`;
}

// Interpolasi warna dingin → hangat → panas untuk bar rentang suhu
function tempToColor(temp, min, max) {
  const stops = [
    [90, 200, 250], // dingin — biru
    [255, 214, 10], // sedang — kuning
    [255, 69, 58], // panas — merah
  ];
  const range = max - min || 1;
  const pct = Math.min(1, Math.max(0, (temp - min) / range));
  const segment = pct <= 0.5 ? 0 : 1;
  const localPct = pct <= 0.5 ? pct / 0.5 : (pct - 0.5) / 0.5;
  const [r1, g1, b1] = stops[segment];
  const [r2, g2, b2] = stops[segment + 1];
  const r = Math.round(r1 + (r2 - r1) * localPct);
  const g = Math.round(g1 + (g2 - g1) * localPct);
  const b = Math.round(b1 + (b2 - b1) * localPct);
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------
// 9. TEKS KONTEKSTUAL UNTUK KARTU DETAIL
// ---------------------------------------------------------
function feelsLikeDesc(feelsC, actualC) {
  const diff = feelsC - actualC;
  if (diff >= 2) return "Terasa lebih panas karena kelembapan udara.";
  if (diff <= -2) return "Terasa lebih dingin karena embusan angin.";
  return "Mirip dengan suhu sebenarnya.";
}

function humidityDesc(h) {
  if (h <= 30) return "Udara terasa kering.";
  if (h <= 60) return "Tingkat kelembapan terasa nyaman.";
  return "Udara terasa lembap.";
}

function visibilityDesc(km) {
  if (km == null) return "Data jarak pandang tidak tersedia.";
  if (km >= 10) return "Jarak pandang sangat baik.";
  if (km >= 4) return "Jarak pandang cukup baik.";
  return "Jarak pandang agak terbatas.";
}

function pressureDesc(p) {
  if (p > 1015) return "Sedikit lebih tinggi dari tekanan standar.";
  if (p < 1010) return "Sedikit lebih rendah dari tekanan standar.";
  return "Sesuai dengan tekanan standar.";
}

// ---------------------------------------------------------
// 10. IKON SVG INLINE (ringan, konsisten di semua browser)
// ---------------------------------------------------------
const ICONS = {
  clock:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>',
  feelsLike:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 14.8V3.5a2 2 0 10-4 0v11.3a4 4 0 104 0z"/></svg>',
  humidity:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5s6.5 7.4 6.5 11.8a6.5 6.5 0 11-13 0C5.5 9.9 12 2.5 12 2.5z"/></svg>',
  wind:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8h9.5a2.5 2.5 0 10-2.4-3.2M3 12h13a2.5 2.5 0 11-2.4 3.2M3 16h7.5a2 2 0 11-1.9 2.6"/></svg>',
  eye:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  gauge:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 14l3-4M4 14a8 8 0 1116 0"/></svg>',
  sun:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.29 3.86L2.11 18.05A1.5 1.5 0 003.5 20.5h17a1.5 1.5 0 001.39-2.45L13.71 3.86a1.5 1.5 0 00-2.42 0z"/></svg>',
};

// ---------------------------------------------------------
// 11. RENDER: LOADING / ERROR
// ---------------------------------------------------------
function renderLoading() {
  els.content.innerHTML = `
    <div class="loading">
      <div class="spinner" role="status" aria-label="Memuat"></div>
      <p>Mengambil data cuaca…</p>
    </div>
  `;
}

function renderError(err) {
  const titles = {
    NOT_FOUND: "Kota tidak ditemukan",
    NETWORK: "Tidak ada koneksi",
    NO_API_KEY: "API key belum diisi",
    UNAUTHORIZED: "API key bermasalah",
  };
  const title = titles[err.code] || "Terjadi kesalahan";

  els.content.innerHTML = `
    <div class="error-panel">
      ${ICONS.warning}
      <p class="error-panel__title">${title}</p>
      <p class="error-panel__message">${err.message}</p>
    </div>
  `;
}

// ---------------------------------------------------------
// 12. RENDER: HASIL CUACA (gaya Weather iOS)
// ---------------------------------------------------------
function renderWeather() {
  const current = state.current;
  const theme = skyThemeFor(current.weather[0].main, current.weather[0].icon);
  setSkyTheme(theme);

  // ---- Hero ----
  const todayRange = state.daily[0]
    ? `<p class="hero__range">H:${formatTemp(state.daily[0].max)} L:${formatTemp(
        state.daily[0].min
      )}</p>`
    : "";

  // ---- Prakiraan per jam ----
  const hourlyHtml =
    state.hourly.length > 0
      ? `<section class="card">
           <div class="card__title">${ICONS.clock} Prakiraan Per Jam</div>
           <div class="hourly">
             ${state.hourly
               .map(
                 (h) => `
               <div class="hourly__item">
                 <span class="hourly__time">${h.label}</span>
                 <img class="wx" src="${iconUrl(h.icon, "")}" alt="" loading="lazy" />
                 <span class="hourly__temp">${formatTemp(h.temp)}</span>
               </div>`
               )
               .join("")}
           </div>
         </section>`
      : "";

  // ---- Prakiraan 5 hari (bar rentang suhu) ----
  let dailyHtml = "";
  if (state.daily.length > 0) {
    const allTemps = state.daily.flatMap((d) => [d.min, d.max]);
    const weekMin = Math.min(...allTemps);
    const weekMax = Math.max(...allTemps);
    const span = weekMax - weekMin || 1;

    const rows = state.daily
      .map((day, idx) => {
        const leftPct = ((day.min - weekMin) / span) * 100;
        const widthPct = Math.max(((day.max - day.min) / span) * 100, 8);
        const gradient = `linear-gradient(90deg, ${tempToColor(
          day.min,
          weekMin,
          weekMax
        )}, ${tempToColor(day.max, weekMin, weekMax)})`;

        return `
          <li class="daily__row">
            <span class="daily__day">${idx === 0 ? "Hari Ini" : formatDayLabel(day.dt, state.tz)}</span>
            <img class="wx" src="${iconUrl(day.icon, "")}" alt="${day.main}" loading="lazy" />
            <span class="daily__min">${formatTemp(day.min)}</span>
            <div class="daily__bar">
              <div class="daily__fill" style="left:${leftPct}%;width:${widthPct}%;background:${gradient}"></div>
            </div>
            <span class="daily__max">${formatTemp(day.max)}</span>
          </li>`;
      })
      .join("");

    dailyHtml = `
      <section class="card">
        <div class="card__title">${ICONS.calendar} Prakiraan 5 Hari</div>
        <ul class="daily">${rows}</ul>
      </section>`;
  }

  // ---- Kartu detail ----
  const visKm =
    typeof current.visibility === "number" ? (current.visibility / 1000).toFixed(1) : null;

  const now = Math.floor(Date.now() / 1000);
  const beforeSunrise = now < current.sys.sunrise;
  const afterSunset = now > current.sys.sunset;
  let sunTitle, sunMain, sunSub;
  if (beforeSunrise) {
    sunTitle = "Matahari Terbit";
    sunMain = formatLocalTime(current.sys.sunrise, state.tz);
    sunSub = `Terbenam pukul ${formatLocalTime(current.sys.sunset, state.tz)}`;
  } else if (afterSunset) {
    sunTitle = "Matahari Terbit";
    sunMain = formatLocalTime(current.sys.sunrise, state.tz);
    sunSub = "Perkiraan waktu terbit besok pagi";
  } else {
    sunTitle = "Matahari Terbenam";
    sunMain = formatLocalTime(current.sys.sunset, state.tz);
    sunSub = `Terbit pukul ${formatLocalTime(current.sys.sunrise, state.tz)}`;
  }

  const tilesHtml = `
    <div class="tiles">
      <div class="tile">
        <div class="tile__title">${ICONS.feelsLike} Terasa Seperti</div>
        <p class="tile__value">${formatTemp(current.main.feels_like)}</p>
        <p class="tile__desc">${feelsLikeDesc(current.main.feels_like, current.main.temp)}</p>
      </div>
      <div class="tile">
        <div class="tile__title">${ICONS.humidity} Kelembapan</div>
        <p class="tile__value">${current.main.humidity}<small>%</small></p>
        <p class="tile__desc">${humidityDesc(current.main.humidity)}</p>
      </div>
      <div class="tile">
        <div class="tile__title">${ICONS.wind} Angin</div>
        <p class="tile__value">${current.wind.speed}<small> m/s</small></p>
        <p class="tile__desc">${
          current.wind.deg != null
            ? `Dari arah ${degToCompass(current.wind.deg)} (${Math.round(current.wind.deg)}°)`
            : "Arah angin tidak tersedia."
        }</p>
      </div>
      <div class="tile">
        <div class="tile__title">${ICONS.eye} Jarak Pandang</div>
        <p class="tile__value">${visKm ?? "N/A"}${visKm ? "<small> km</small>" : ""}</p>
        <p class="tile__desc">${visibilityDesc(visKm ? parseFloat(visKm) : null)}</p>
      </div>
      <div class="tile">
        <div class="tile__title">${ICONS.gauge} Tekanan</div>
        <p class="tile__value">${current.main.pressure}<small> hPa</small></p>
        <p class="tile__desc">${pressureDesc(current.main.pressure)}</p>
      </div>
      <div class="tile">
        <div class="tile__title">${ICONS.sun} ${sunTitle}</div>
        <p class="tile__value">${sunMain}</p>
        <p class="tile__desc">${sunSub}</p>
      </div>
    </div>
  `;

  els.content.innerHTML = `
    <div class="result">
      <div class="hero">
        <p class="hero__city">${current.name}${current.sys.country ? ", " + current.sys.country : ""}</p>
        <p class="hero__temp">${formatTemp(current.main.temp)}</p>
        <p class="hero__desc">${capitalize(current.weather[0].description)}</p>
        ${todayRange}
      </div>
      ${hourlyHtml}
      ${dailyHtml}
      ${tilesHtml}
      <p class="credit">Data oleh OpenWeatherMap</p>
    </div>
  `;
}

function renderHistory() {
  els.historyRow.innerHTML = state.history
    .map((city) => `<button type="button" class="history__chip">${city}</button>`)
    .join("");
}

// ---------------------------------------------------------
// 13. LOCALSTORAGE — RIWAYAT PENCARIAN (FITUR BONUS)
// ---------------------------------------------------------
function loadHistory() {
  try {
    const raw = localStorage.getItem(CONFIG.HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveHistory(city) {
  const withoutDuplicate = state.history.filter(
    (item) => item.toLowerCase() !== city.toLowerCase()
  );
  state.history = [city, ...withoutDuplicate].slice(0, CONFIG.MAX_HISTORY);
  localStorage.setItem(CONFIG.HISTORY_KEY, JSON.stringify(state.history));
  renderHistory();
}

// ---------------------------------------------------------
// 14. ALUR UTAMA PENCARIAN
// ---------------------------------------------------------
async function searchCity(rawCity) {
  const city = rawCity.trim();
  if (!city) return;

  renderLoading();

  try {
    const current = await fetchCurrentWeather(city);
    state.tz = current.timezone ?? 0;

    const forecastList = await fetchForecastList(city);
    state.hourly = buildHourly(current, forecastList);
    state.daily = buildDailyForecast(forecastList, state.tz);
    state.current = current;

    renderWeather();
    saveHistory(city);
  } catch (err) {
    renderError(
      err instanceof WeatherError
        ? err
        : new WeatherError("Terjadi kesalahan tak terduga. Coba lagi.", "UNKNOWN")
    );
  }
}

// ---------------------------------------------------------
// 15. TOGGLE °C / °F (FITUR BONUS)
// ---------------------------------------------------------
function setUnit(unit) {
  if (unit === state.unit) return;
  state.unit = unit;
  els.unitButtons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.unit === unit);
  });
  if (state.current) renderWeather(); // render ulang tanpa fetch API lagi
}

// ---------------------------------------------------------
// 16. EVENT LISTENERS
// ---------------------------------------------------------
els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  searchCity(els.input.value);
});

els.unitButtons.forEach((btn) => {
  btn.addEventListener("click", () => setUnit(btn.dataset.unit));
});

els.historyRow.addEventListener("click", (event) => {
  const chip = event.target.closest(".history__chip");
  if (!chip) return;
  els.input.value = chip.textContent;
  searchCity(chip.textContent);
});

// ---------------------------------------------------------
// 17. INISIALISASI
// ---------------------------------------------------------
renderHistory();
