// Демо-режим GeoKameral для статического хостинга (GitHub Pages).
// Перехватывает запросы интерфейса к /api/* и отвечает подготовленными данными;
// калибровка по пунктам считается в браузере тем же методом, что и на сервере.
(() => {
  const realFetch = window.fetch.bind(window);
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const load = (p) => realFetch(p).then((r) => r.json());
  let JOB = null;
  const job = async () => (JOB ||= await load("data/job.json"));

  function calibrate(text, scale, terrain, intervals) {
    const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
    const delim = [";", ",", "\t"].find((d) => lines[0].includes(d)) || ";";
    const rows = lines.map((l) => l.split(delim)).filter((r) => r.length >= 7 && r.slice(1, 7).every((v) => isFinite(parseFloat(v.replace(",", ".")))));
    if (rows.length < 2) throw new Error("В файле меньше двух пунктов (формат: имя;x1;y1;h1;x2;y2;h2)");
    const P = rows.map((r) => ({ name: r[0], v: r.slice(1, 7).map((x) => parseFloat(x.replace(",", "."))) }));
    // 4-параметрическое преобразование подобия: нормальные уравнения МНК
    const N = Array.from({ length: 4 }, () => [0, 0, 0, 0]), U = [0, 0, 0, 0];
    const add = (a, l) => { for (let i = 0; i < 4; i++) { U[i] += a[i] * l; for (let j = 0; j < 4; j++) N[i][j] += a[i] * a[j]; } };
    P.forEach(({ v: [x, y, , X, Y] }) => { add([x, -y, 1, 0], X); add([y, x, 0, 1], Y); });
    const [a, b, tx, ty] = solve(N, U);
    const dh = P.map(({ v }) => v[5] - v[2]), dhm = dh.reduce((s, d) => s + d, 0) / dh.length;
    const res = P.map(({ name, v: [x, y, h, X, Y, H] }) => ({
      name, vx: X - (a * x - b * y + tx), vy: Y - (b * x + a * y + ty), vh: H - (h + dhm),
    }));
    const n = P.length;
    const rms_xy = Math.sqrt(res.reduce((s, r) => s + r.vx ** 2 + r.vy ** 2, 0) / Math.max(2 * n - 4, 1));
    const rms_h = Math.sqrt(res.reduce((s, r) => s + r.vh ** 2, 0) / Math.max(n - 1, 1));
    const interval = intervals[scale][terrain];
    const tol_xy = (terrain === "mountain" ? 0.7 : 0.5) * scale / 1000, tol_h = interval / 4;
    const mean_xy = res.reduce((s, r) => s + Math.hypot(r.vx, r.vy), 0) / n;
    const mean_h = res.reduce((s, r) => s + Math.abs(r.vh), 0) / n;
    const gross = res.filter((r) => Math.hypot(r.vx, r.vy) > 2 * tol_xy).length;
    const r3 = (x) => Math.round(x * 1000) / 1000;
    return {
      scale_factor: Math.hypot(a, b), rotation_sec: Math.atan2(b, a) * 180 / Math.PI * 3600, tx, ty,
      height_model: [dhm], rms_xy, rms_h, residuals: res,
      accuracy: { ok: mean_xy <= tol_xy && mean_h <= tol_h && !gross, n, mean_xy_m: r3(mean_xy), tol_xy_m: r3(tol_xy),
                  mean_h_m: r3(mean_h), tol_h_m: r3(tol_h), gross_xy: gross, basis: "Инструкция № 113/НҚ от 29.03.2023, п. 51–52" },
    };
  }
  function solve(A, b) { // метод Гаусса с выбором главного элемента
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }

  window.fetch = async (input, opts = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (!url.startsWith("/api/")) return realFetch(input, opts);
    const method = (opts.method || "GET").toUpperCase();
    const path = url.split("?")[0];
    if (path === "/api/me") return json({ id: "demo", name: "Демо-компания", plan: "демо" });
    if (path === "/api/crs") return json(await load("data/crs.json"));
    if (path === "/api/jobs" && method === "GET") return json([await job()]);
    if (path === "/api/jobs" && method === "POST")
      return json({ detail: "В демо-версии обработка новых данных отключена. Откройте раздел «Задачи», чтобы посмотреть результаты тестовой задачи." }, 403);
    const fm = path.match(/^\/api\/jobs\/[^/]+\/files\/(.+)$/);
    if (fm) return realFetch("data/files/" + fm[1].split("/").pop());
    if (path.startsWith("/api/jobs/")) return json(await job());
    if (path === "/api/calibrate") {
      try {
        const fd = opts.body, crs = await load("data/crs.json");
        return json(calibrate(await fd.get("file").text(), fd.get("scale"), fd.get("terrain"), crs.contour_intervals));
      } catch (e) { return json({ detail: e.message }, 400); }
    }
    if (path === "/api/agent") return json({
      answer: "Демо-версия: агент-камеральщик работает в полной версии на локальной языковой модели компании.\n\n" +
        "Пример ответа на вопрос о допуске по высоте для плана 1:500 при сечении 0,5 м:\n" +
        "средняя погрешность съёмки рельефа не должна превышать 1/4 высоты сечения при углах наклона до 2°, т. е. 0,125 м " +
        "(Инструкция по созданию картографической продукции, приказ МЦРИАП РК от 29.03.2023 № 113/НҚ, п. 51); " +
        "при уклонах 2–6° — 1/3 сечения.",
      tools: [{ tool: "search_norms" }, { tool: "read_norm" }],
    });
    return json({ detail: "Не поддерживается в демо" }, 404);
  };
})();
