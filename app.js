const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const key = () => $("#apikey").value.trim();
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { "X-API-Key": key(), ...(opts.headers || {}) } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
  return r.json();
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STATUS = { queued: "в очереди", running: "обработка", done: "готово", error: "ошибка" };
let REF = null, current = null, chatHistory = [];

// ---------- навигация
$$(".nav").forEach((b) => b.onclick = () => {
  $$(".nav").forEach((x) => x.classList.toggle("active", x === b));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + b.dataset.view));
  if (b.dataset.view === "jobs") loadJobs();
  if (b.dataset.view === "agent") fillChatJobs();
});

// ---------- справочники
async function init() {
  try { const me = await api("/api/me"); $("#tenant").textContent = `${me.name} · тариф ${me.plan}`; }
  catch { $("#tenant").textContent = "ключ не принят"; }
  REF = await api("/api/crs");
  const groups = {};
  REF.systems.forEach((s) => (groups[s.group] ||= []).push(s));
  const opts = Object.entries(groups).map(([g, list]) =>
    `<optgroup label="${esc(g)}">${list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</optgroup>`).join("");
  $("#src_crs").innerHTML = opts; $("#dst_crs").innerHTML = opts;
  $("#src_crs").value = "WGS84"; $("#dst_crs").value = "QAZTRF23_GK12";
  $("#height_system").innerHTML = Object.entries(REF.heights).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
  $("#height_system").value = "BALTIC77";
  const sc = REF.scales.map((s) => `<option value="${s}">1:${s}</option>`).join("");
  $("#scale").innerHTML = sc; $("#cscale").innerHTML = sc; $("#scale").value = "1000"; $("#cscale").value = "1000";
  updateInterval(); updateNote();
}
function updateInterval() {
  if (!REF) return;
  $("#interval").placeholder = REF.contour_intervals[$("#scale").value][$("#terrain").value] + " (по умолчанию)";
}
function updateNote() {
  if (!REF) return;
  const s = REF.systems.find((x) => x.id === $("#dst_crs").value);
  $("#crsnote").textContent = s?.note ? "Выходная СК: " + s.note : "";
}
$("#scale").onchange = updateInterval; $("#terrain").onchange = updateInterval; $("#dst_crs").onchange = updateNote;
$("#apikey").onchange = init;
$("#jtype").onchange = () => {
  const photo = $("#jtype").value === "photo";
  $(".src-only").style.display = photo ? "none" : "";
  $("#files").accept = photo ? ".jpg,.jpeg,.tif,.tiff,.dng,.txt" : ".las,.laz";
};
$("#jtype").onchange();

// ---------- загрузка
const drop = $("#drop");
["dragenter", "dragover"].forEach((e) => drop.addEventListener(e, () => drop.classList.add("over")));
["dragleave", "drop"].forEach((e) => drop.addEventListener(e, () => drop.classList.remove("over")));
$("#files").onchange = () => {
  const f = $("#files").files, mb = [...f].reduce((a, x) => a + x.size, 0) / 1048576;
  $("#droptext").textContent = f.length ? `Выбрано файлов: ${f.length} (${mb.toFixed(1)} МБ)` : "Перетащите файлы сюда или нажмите для выбора";
};
$("#jobform").onsubmit = async (e) => {
  e.preventDefault();
  if (!$("#files").files.length) { $("#submitmsg").textContent = "Выберите файлы"; return; }
  const fd = new FormData(e.target);
  if (!fd.get("contour_interval")) fd.delete("contour_interval");
  const btn = $("button", e.target); btn.disabled = true; $("#submitmsg").textContent = "Загрузка…";
  try {
    const job = await api("/api/jobs", { method: "POST", body: fd });
    $("#submitmsg").textContent = "Задача создана: " + job.id;
    current = job.id; $$(".nav")[1].click();
  } catch (err) { $("#submitmsg").textContent = "Ошибка: " + err.message; }
  btn.disabled = false;
};

// ---------- задачи
let timer = null;
async function loadJobs() {
  const jobs = await api("/api/jobs");
  $("#joblist").innerHTML = jobs.length ? jobs.map((j) => `
    <div class="jobrow ${j.id === current ? "sel" : ""}" data-id="${j.id}">
      <span class="t">${esc(j.name)}</span>
      <span class="m">${j.type === "lidar" ? "ЛиДАР" : "Аэрофотосъёмка"} · 1:${j.params.scale} · ${esc(j.created.replace("T", " "))}
      <span class="badge s-${j.status}">${STATUS[j.status]}</span></span>
    </div>`).join("") : `<p class="muted" style="padding:10px">Задач пока нет.</p>`;
  $$(".jobrow").forEach((r) => r.onclick = () => { current = r.dataset.id; loadJobs(); });
  if (current) showJob(current);
  clearTimeout(timer);
  if (jobs.some((j) => j.status === "running" || j.status === "queued")) timer = setTimeout(loadJobs, 3000);
}
async function showJob(id) {
  const j = await api("/api/jobs/" + id);
  const rep = (j.report || [])[0] || {};
  const rows = [
    ["Статус", `<span class="badge s-${j.status}">${STATUS[j.status]}</span>`],
    ["Исходная → выходная СК", `${esc(j.params.src_crs)} → ${esc(j.params.dst_crs)}`],
    ["Система высот", esc(REF?.heights[j.params.height_system] || j.params.height_system)],
    ["Масштаб / сечение", `1:${j.params.scale} / ${rep.contour_interval_m ?? "—"} м`],
  ];
  if (rep.points) rows.push(["Точек / плотность", `${rep.points.toLocaleString("ru")} / ${rep.density_pts_m2} т/м² ${rep.density_ok ? "" : "<span class='verdict bad'>ниже рекомендуемой " + rep.density_required_pts_m2 + "</span>"}`]);
  if (rep.buildings) rows.push(["Здания (черновик)", rep.buildings.length + " шт. — требуют полевого дешифрирования"]);
  if (rep.ortho_gsd_m) rows.push(["GSD ортофотоплана", `${rep.ortho_gsd_m} м (допуск ${rep.ortho_gsd_max_m}) ${rep.ortho_gsd_ok ? "✓" : "✗"}`]);
  if (j.error) rows.push(["Ошибка", `<span class="verdict bad">${esc(j.error)}</span>`]);
  $("#jobdetail").innerHTML = `
    <h3>${esc(j.name)}</h3>
    <div class="kv">${rows.map(([k, v]) => `<div>${k}</div><div>${v}</div>`).join("")}</div>
    <div class="files">${(j.files || []).map((f) => `<a href="#" data-f="${esc(f)}">${esc(f)}</a>`).join("") || "<span class='muted'>Файлы появятся после обработки</span>"}</div>
    <h3 style="margin-top:14px">Журнал</h3><pre class="log">${esc(j.log.join("\n"))}</pre>`;
  $$("#jobdetail .files a").forEach((a) => a.onclick = async (e) => {
    e.preventDefault();
    const r = await fetch(`/api/jobs/${id}/files/${a.dataset.f}`, { headers: { "X-API-Key": key() } });
    const url = URL.createObjectURL(await r.blob());
    Object.assign(document.createElement("a"), { href: url, download: a.dataset.f.split("/").pop() }).click();
    URL.revokeObjectURL(url);
  });
}

// ---------- калибровка
$("#calform").onsubmit = async (e) => {
  e.preventDefault();
  const box = $("#calresult"); box.hidden = false; box.innerHTML = "Расчёт…";
  try {
    const r = await api("/api/calibrate", { method: "POST", body: new FormData(e.target) });
    const a = r.accuracy;
    box.innerHTML = `
      <h3>Параметры перехода</h3>
      <div class="kv">
        <div>Масштаб (ppm)</div><div>${((r.scale_factor - 1) * 1e6).toFixed(2)}</div>
        <div>Поворот</div><div>${r.rotation_sec.toFixed(2)}″</div>
        <div>Сдвиг X / Y, м</div><div>${r.tx.toFixed(3)} / ${r.ty.toFixed(3)}</div>
        <div>СКО план / высота, м</div><div>${r.rms_xy.toFixed(3)} / ${r.rms_h.toFixed(3)}</div>
        <div>Вывод</div><div class="verdict ${a.ok ? "ok" : "bad"}">${a.ok ? "Соответствует допускам" : "Не соответствует допускам"}
          (ср. план ${a.mean_xy_m} при допуске ${a.tol_xy_m} м; ср. высота ${a.mean_h_m} при допуске ${a.tol_h_m} м)</div>
        <div>Основание</div><div>${esc(a.basis)}</div>
      </div>
      <table><tr><th>Пункт</th><th>vX, м</th><th>vY, м</th><th>vH, м</th></tr>
      ${r.residuals.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.vx.toFixed(3)}</td><td>${x.vy.toFixed(3)}</td><td>${x.vh.toFixed(3)}</td></tr>`).join("")}</table>`;
  } catch (err) { box.innerHTML = `<span class="verdict bad">Ошибка: ${esc(err.message)}</span>`; }
};

// ---------- агент
async function fillChatJobs() {
  const jobs = await api("/api/jobs").catch(() => []);
  $("#chatjob").innerHTML = `<option value="">без привязки к задаче</option>` +
    jobs.map((j) => `<option value="${j.id}">${esc(j.name)}</option>`).join("");
}
function addMsg(role, text, tools) {
  const d = document.createElement("div");
  d.className = "msg " + role; d.textContent = text;
  if (tools?.length) { const t = document.createElement("div"); t.className = "tools"; t.textContent = "инструменты: " + tools.map((x) => x.tool).join(", "); d.append(t); }
  $("#chatlog").append(d); $("#chatlog").scrollTop = 1e9;
}
$("#chatform").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("#chatinput").value.trim(); if (!text) return;
  $("#chatinput").value = ""; addMsg("user", text);
  const btn = $("button", e.target); btn.disabled = true;
  try {
    const r = await api("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: chatHistory, job_id: $("#chatjob").value || null }) });
    addMsg("bot", r.answer, r.tools);
    chatHistory.push({ role: "user", content: text }, { role: "assistant", content: r.answer });
  } catch (err) { addMsg("bot", "Агент недоступен: " + err.message); }
  btn.disabled = false;
};

init();
