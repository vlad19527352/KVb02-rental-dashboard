(function () {
  'use strict';

  var Core = window.RentalCore;
  var nf = new Intl.NumberFormat('ru-RU');

  var state = {
    mode: 'idle',          // idle | loading | ready | error
    fileName: '',
    rows: [],
    filtered: [],
    period: null,
    errors: [],
    warnings: [],
    filters: { from: '', to: '', points: [], activities: [], statuses: [], channels: [] },
    page: 1,
    pageSize: 25
  };

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    fileInput: $('fileInput'),
    fileName: $('fileName'),
    filePeriod: $('filePeriod'),
    loadStatus: $('loadStatus'),
    clearFile: $('clearFile'),
    dropzone: $('dropzone'),
    errorBox: $('errorBox'),
    warnBox: $('warnBox'),
    dateFrom: $('dateFrom'),
    dateTo: $('dateTo'),
    pointChips: $('pointChips'),
    activityChips: $('activityChips'),
    statusChips: $('statusChips'),
    channelChips: $('channelChips'),
    resetFilters: $('resetFilters'),
    selectedCount: $('selectedCount'),
    emptyNotice: $('emptyNotice'),
    kpiTotal: $('kpiTotal'),
    kpiPaid: $('kpiPaid'),
    kpiNet: $('kpiNet'),
    kpiNetNote: $('kpiNetNote'),
    kpiRefund: $('kpiRefund'),
    chart: $('chart'),
    chartTotal: $('chartTotal'),
    activityBreakdown: $('activityBreakdown'),
    tableBody: $('bookingsBody'),
    tableSub: $('tableSub'),
    tableEmpty: $('tableEmpty'),
    tableWrap: $('tableWrap'),
    pageInfo: $('pageInfo'),
    pageSize: $('pageSize'),
    prevPage: $('prevPage'),
    nextPage: $('nextPage'),
    downloadPanel: $('downloadPanel')
  };

  /* ---------- форматирование ---------- */

  function fmtInt(n) {
    return nf.format(n);
  }

  function fmtMoney(n) {
    return nf.format(n) + '\u00a0₽';
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return p[2] + '.' + p[1] + '.' + p[0];
  }

  function fmtDateShort(iso) {
    var p = iso.split('-');
    return p[2] + '.' + p[1];
  }

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- чипы фильтров ---------- */

  function buildChips(host, dict, key) {
    host.innerHTML = '';
    Object.keys(dict).forEach(function (code) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.dataset.code = code;
      btn.textContent = dict[code];
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', function () {
        var list = state.filters[key];
        var i = list.indexOf(code);
        if (i === -1) list.push(code); else list.splice(i, 1);
        syncChips();
        applyFilters();
      });
      host.appendChild(btn);
    });
  }

  function syncChips() {
    [['pointChips', state.filters.points], ['activityChips', state.filters.activities],
     ['statusChips', state.filters.statuses], ['channelChips', state.filters.channels]]
      .forEach(function (pair) {
        var host = el[pair[0]];
        var list = pair[1];
        Array.prototype.forEach.call(host.querySelectorAll('.chip'), function (btn) {
          var on = list.indexOf(btn.dataset.code) !== -1;
          btn.classList.toggle('active', on);
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
  }

  function syncInputs() {
    el.dateFrom.value = state.filters.from;
    el.dateTo.value = state.filters.to;
    el.dateFrom.min = state.period ? state.period.from : '';
    el.dateFrom.max = state.period ? state.period.to : '';
    el.dateTo.min = state.period ? state.period.from : '';
    el.dateTo.max = state.period ? state.period.to : '';
  }

  /* ---------- состояния ---------- */

  function setStatus(kind, text) {
    el.loadStatus.className = 'status status-' + kind;
    el.loadStatus.textContent = text;
  }

  function renderStatus() {
    if (state.mode === 'idle') {
      setStatus('idle', 'Файл не выбран');
      el.fileName.textContent = 'Файл не выбран';
      el.filePeriod.textContent = 'Доступный период появится после загрузки';
      el.clearFile.disabled = true;
    } else if (state.mode === 'loading') {
      setStatus('loading', 'Чтение файла…');
      el.fileName.textContent = state.fileName;
      el.filePeriod.textContent = 'Проверяем структуру и суммы…';
      el.clearFile.disabled = false;
    } else if (state.mode === 'error') {
      setStatus('error', 'Ошибка загрузки');
      el.fileName.textContent = state.fileName || 'Файл не выбран';
      el.filePeriod.textContent = 'Период недоступен: файл не прошёл проверку';
      el.clearFile.disabled = false;
    } else {
      var count = state.rows.length;
      setStatus('ok', 'Загружено · ' + fmtInt(count) + ' ' + plural(count, 'строка', 'строки', 'строк'));
      el.fileName.textContent = state.fileName;
      el.filePeriod.textContent = 'Доступный период: ' + fmtDate(state.period.from) + ' — ' + fmtDate(state.period.to);
      el.clearFile.disabled = false;
    }
  }

  function plural(n, one, few, many) {
    var m10 = n % 10;
    var m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function renderMessages() {
    if (state.errors.length) {
      var shown = state.errors.slice(0, 12);
      var rest = state.errors.length - shown.length;
      el.errorBox.hidden = false;
      el.errorBox.innerHTML =
        '<h3>Файл не прошёл проверку — результаты очищены</h3>' +
        '<ul>' + shown.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' +
        (rest > 0 ? '<div class="error-more">И ещё ' + rest + ' ' + plural(rest, 'ошибка', 'ошибки', 'ошибок') + '. Исправьте файл и загрузите снова.</div>'
                  : '<div class="error-more">Исправьте файл и загрузите снова.</div>');
    } else {
      el.errorBox.hidden = true;
      el.errorBox.innerHTML = '';
    }

    if (state.warnings.length) {
      el.warnBox.hidden = false;
      el.warnBox.textContent = state.warnings.join(' ');
    } else {
      el.warnBox.hidden = true;
      el.warnBox.textContent = '';
    }
  }

  /* ---------- данные ---------- */

  function applyFilters() {
    state.filtered = state.mode === 'ready' ? Core.filterRows(state.rows, state.filters) : [];
    state.page = 1;
    renderAll();
  }

  function renderAll() {
    renderStatus();
    renderMessages();
    renderKpis();
    renderChart();
    renderBreakdown();
    renderTable();
    renderDownloads();
    syncChips();
    syncInputs();

    var n = state.filtered.length;
    el.selectedCount.textContent = fmtInt(n);
    el.emptyNotice.hidden = !(state.mode === 'ready' && n === 0);
  }

  function renderKpis() {
    if (state.mode !== 'ready') {
      [el.kpiTotal, el.kpiPaid, el.kpiNet, el.kpiRefund].forEach(function (node) { node.textContent = '—'; });
      el.kpiNetNote.textContent = 'оплаты − возвраты';
      return;
    }
    var s = Core.summarize(state.filtered);
    el.kpiTotal.textContent = fmtInt(s.total);
    el.kpiPaid.textContent = fmtInt(s.paid);
    el.kpiNet.textContent = fmtMoney(s.net);
    el.kpiRefund.textContent = fmtMoney(s.refund);
    el.kpiNetNote.textContent = 'оплаты ' + fmtMoney(s.gross) + ' − возвраты ' + fmtMoney(s.refund);
  }

  /* ---------- график ---------- */

  function renderChart() {
    var host = el.chart;
    host.innerHTML = '';

    if (state.mode === 'idle') {
      el.chartTotal.textContent = '—';
      host.innerHTML = '<div class="chart-empty">Загрузите CSV — здесь появится выручка по дням.</div>';
      return;
    }
    if (state.mode === 'error') {
      el.chartTotal.textContent = '—';
      host.innerHTML = '<div class="chart-empty">Загрузка не удалась: график очищен до исправления файла.</div>';
      return;
    }
    if (!state.filtered.length) {
      el.chartTotal.textContent = fmtMoney(0);
      host.innerHTML = '<div class="chart-empty">По выбранным условиям записей нет.</div>';
      return;
    }

    var series = Core.dailySeries(state.filtered, state.filters);
    var total = series.reduce(function (sum, d) { return sum + d.net; }, 0);
    el.chartTotal.textContent = fmtMoney(total);

    var width = Math.max(host.clientWidth || 0, 320);
    var height = 300;
    var pad = { top: 48, right: 10, bottom: 30, left: 10 };
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    var n = series.length;
    var band = plotW / n;
    var maxNet = series.reduce(function (m, d) { return Math.max(m, d.net); }, 0);
    var barW = Math.max(3, Math.min(38, band * 0.62));

    var svg = [];
    svg.push('<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height +
      '" role="img" aria-label="Чистая выручка по дням">');

    for (var g = 0; g <= 4; g++) {
      var gy = pad.top + plotH * (g / 4);
      svg.push('<line class="grid-line" x1="' + pad.left + '" y1="' + gy + '" x2="' + (width - pad.right) + '" y2="' + gy + '"></line>');
    }

    var showEvery = band < 34 ? 2 : 1;

    series.forEach(function (d, i) {
      var x = pad.left + band * i + (band - barW) / 2;
      var h = maxNet > 0 ? (d.net / maxNet) * plotH : 0;
      if (h > 0 && h < 2) h = 2;
      var y = pad.top + plotH - h;
      var cx = x + barW / 2;

      svg.push('<rect class="' + (d.net > 0 ? 'bar' : 'bar bar-zero') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + barW.toFixed(1) + '" height="' + Math.max(h, 1).toFixed(1) + '" rx="3"><title>' +
        esc(fmtDate(d.date)) + ': ' + esc(fmtMoney(d.net)) + '</title></rect>');

      var ly = y - 6;
      var rotate = band < 26;
      svg.push('<text class="value-label" x="' + (rotate ? cx.toFixed(1) : cx.toFixed(1)) + '" y="' + ly.toFixed(1) +
        '" text-anchor="' + (rotate ? 'start' : 'middle') + '" dominant-baseline="' + (rotate ? 'middle' : 'auto') + '"' +
        (rotate ? ' transform="rotate(-90 ' + cx.toFixed(1) + ' ' + ly.toFixed(1) + ')"' : '') + '>' +
        fmtInt(d.net) + '</text>');

      if (i % showEvery === 0) {
        svg.push('<text class="axis-label" x="' + cx.toFixed(1) + '" y="' + (height - 9) +
          '" text-anchor="middle">' + fmtDateShort(d.date) + '</text>');
      }
    });

    svg.push('</svg>');
    host.innerHTML = svg.join('');
  }

  /* ---------- разбивка по инвентарю ---------- */

  function renderBreakdown() {
    var host = el.activityBreakdown;
    host.innerHTML = '';

    if (state.mode !== 'ready' || !state.filtered.length) {
      host.innerHTML = '<div class="chart-empty">' + (state.mode === 'ready'
        ? 'По выбранным условиям записей нет.'
        : 'Данные появятся после загрузки корректного CSV.') + '</div>';
      return;
    }

    var groups = Core.groupByActivity(state.filtered);
    var max = groups.reduce(function (m, g) { return Math.max(m, g.net); }, 0);

    groups.forEach(function (g) {
      var row = document.createElement('div');
      row.className = 'break-row';
      var pct = max > 0 ? Math.max(2, (g.net / max) * 100) : 0;
      row.innerHTML =
        '<div class="break-name">' + esc(Core.ACTIVITIES[g.activity]) + '</div>' +
        '<div class="break-bar"><span style="width:' + pct.toFixed(1) + '%"></span></div>' +
        '<div class="break-value">' + esc(fmtMoney(g.net)) + '</div>' +
        '<div class="break-count">' + fmtInt(g.paid) + ' ' + plural(g.paid, 'бронь', 'брони', 'броней') + ' с оплатой</div>';
      host.appendChild(row);
    });
  }

  /* ---------- таблица ---------- */

  function renderTable() {
    var body = el.tableBody;
    body.innerHTML = '';

    var n = state.filtered.length;
    var size = state.pageSize;
    var pages = Math.max(1, Math.ceil(n / size));
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;

    var from = n ? (state.page - 1) * size + 1 : 0;
    var to = Math.min(state.page * size, n);

    el.pageInfo.textContent = n ? fmtInt(from) + '–' + fmtInt(to) + ' из ' + fmtInt(n) : '0 из 0';
    el.prevPage.disabled = state.page <= 1 || !n;
    el.nextPage.disabled = state.page >= pages || !n;
    el.tableSub.textContent = state.mode === 'ready'
      ? (n ? 'Показаны строки ' + fmtInt(from) + '–' + fmtInt(to) + ' из ' + fmtInt(n) + ' · порядок исходной выгрузки'
           : 'Нет строк в отборе')
      : (state.mode === 'error' ? 'Данные очищены из-за ошибки загрузки' : 'Нет данных');

    el.tableWrap.hidden = n === 0;
    el.tableEmpty.hidden = n !== 0;

    if (!n) {
      el.tableEmpty.textContent = state.mode === 'ready'
        ? 'По выбранным условиям записей нет.'
        : (state.mode === 'error' ? 'Файл не прошёл проверку — таблица очищена.' : 'Загрузите CSV, чтобы увидеть бронирования.');
      return;
    }

    var slice = state.filtered.slice(from - 1, to);

    slice.forEach(function (r) {
      var tr = document.createElement('tr');
      var net = r.amount - r.refund_amount;
      tr.innerHTML =
        '<td class="id-cell">' + esc(r.id) + '</td>' +
        '<td>' + esc(fmtDate(r.date)) + '</td>' +
        '<td>' + esc(Core.POINTS[r.rental_point]) + '</td>' +
        '<td>' + esc(Core.ACTIVITIES[r.activity]) + '</td>' +
        '<td>' + esc(Core.CHANNELS[r.channel]) + '</td>' +
        '<td><span class="badge badge-' + esc(r.status) + '">' + esc(Core.STATUSES[r.status]) + '</span></td>' +
        '<td class="num">' + fmtInt(r.quantity) + '</td>' +
        '<td class="num">' + fmtInt(r.amount) + '</td>' +
        '<td class="num">' + fmtInt(r.refund_amount) + '</td>' +
        '<td class="num">' + fmtInt(net) + '</td>' +
        '<td class="comment" title="' + esc(r.comment) + '">' + esc(r.comment) + '</td>';
      body.appendChild(tr);
    });
  }

  /* ---------- скачивание ---------- */

  function renderDownloads() {
    var enabled = state.mode === 'ready';
    Array.prototype.forEach.call(el.downloadPanel.querySelectorAll('[data-export]'), function (btn) {
      btn.disabled = !enabled;
    });
  }

  function downloadFile(name, content) {
    var blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  var EXPORT_NAMES = {
    bookings: 'bookings-selection.csv',
    revenueByDay: 'revenue-by-day.csv',
    revenueByPointActivity: 'revenue-by-point-and-activity.csv',
    refunds: 'refunds.csv'
  };

  function handleExport(kind) {
    if (state.mode !== 'ready') return;
    var out = Core.buildExports(state.filtered);
    downloadFile(EXPORT_NAMES[kind], out[kind]);
  }

  /* ---------- загрузка файла ---------- */

  function readFile(file) {
    if (!file) return;
    state.mode = 'loading';
    state.fileName = file.name;
    renderStatus();

    var reader = new FileReader();
    reader.onload = function () {
      handleText(String(reader.result), file.name);
    };
    reader.onerror = function () {
      state.mode = 'error';
      state.errors = ['Не удалось прочитать файл с диска.'];
      state.warnings = [];
      state.rows = [];
      state.filtered = [];
      state.period = null;
      renderAll();
    };
    reader.readAsText(file, 'utf-8');
  }

  function handleText(text, name) {
    var res = Core.loadCsv(text);
    state.fileName = name || 'Файл';

    if (!res.ok) {
      state.mode = 'error';
      state.rows = [];
      state.filtered = [];
      state.period = null;
      state.errors = res.errors;
      state.warnings = res.warnings || [];
      state.page = 1;
      renderAll();
      return;
    }

    state.mode = 'ready';
    state.rows = res.rows;
    state.errors = [];
    state.warnings = res.warnings || [];

    var dates = res.rows.map(function (r) { return r.date; }).sort();
    state.period = { from: dates[0], to: dates[dates.length - 1] };
    state.filters.from = state.period.from;
    state.filters.to = state.period.to;
    state.filters.points.length = 0;
    state.filters.activities.length = 0;
    state.filters.statuses.length = 0;
    state.filters.channels.length = 0;
    state.page = 1;

    applyFilters();
  }

  function resetAll() {
    state.mode = 'idle';
    state.fileName = '';
    state.rows = [];
    state.filtered = [];
    state.period = null;
    state.errors = [];
    state.warnings = [];
    state.filters = { from: '', to: '', points: [], activities: [], statuses: [], channels: [] };
    state.page = 1;
    el.fileInput.value = '';
    renderAll();
  }

  /* ---------- события ---------- */

  el.fileInput.addEventListener('change', function (e) {
    readFile(e.target.files && e.target.files[0]);
  });

  el.clearFile.addEventListener('click', resetAll);

  el.dateFrom.addEventListener('change', function () {
    state.filters.from = el.dateFrom.value;
    applyFilters();
  });

  el.dateTo.addEventListener('change', function () {
    state.filters.to = el.dateTo.value;
    applyFilters();
  });

  el.resetFilters.addEventListener('click', function () {
    state.filters.from = state.period ? state.period.from : '';
    state.filters.to = state.period ? state.period.to : '';
    state.filters.points.length = 0;
    state.filters.activities.length = 0;
    state.filters.statuses.length = 0;
    state.filters.channels.length = 0;
    applyFilters();
  });

  el.pageSize.addEventListener('change', function () {
    state.pageSize = Number(el.pageSize.value) || 25;
    state.page = 1;
    renderTable();
  });

  el.prevPage.addEventListener('click', function () {
    if (state.page > 1) { state.page--; renderTable(); }
  });

  el.nextPage.addEventListener('click', function () {
    var pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
    if (state.page < pages) { state.page++; renderTable(); }
  });

  Array.prototype.forEach.call(el.downloadPanel.querySelectorAll('[data-export]'), function (btn) {
    btn.addEventListener('click', function () { handleExport(btn.dataset.export); });
  });

  ['dragenter', 'dragover'].forEach(function (evt) {
    el.dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      el.dropzone.classList.add('over');
    });
  });

  ['dragleave', 'drop'].forEach(function (evt) {
    el.dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      el.dropzone.classList.remove('over');
    });
  });

  el.dropzone.addEventListener('drop', function (e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    readFile(file);
  });

  var resizeTimer = null;
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      if (state.mode !== 'ready') return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderChart, 60);
    }).observe(el.chart);
  } else {
    window.addEventListener('resize', function () {
      if (state.mode === 'ready') renderChart();
    });
  }

  /* ---------- запуск ---------- */

  buildChips(el.pointChips, Core.POINTS, 'points');
  buildChips(el.activityChips, Core.ACTIVITIES, 'activities');
  buildChips(el.statusChips, Core.STATUSES, 'statuses');
  buildChips(el.channelChips, Core.CHANNELS, 'channels');
  renderAll();

  // Хук для локальной проверки без ручного выбора файла
  window.kodaLoadCsv = function (text, name) { handleText(text, name || 'bookings.csv'); };
  window.kodaGetState = function () {
    return {
      mode: state.mode,
      rows: state.rows.length,
      filtered: state.filtered.length,
      summary: Core.summarize(state.filtered),
      page: state.page,
      pageSize: state.pageSize
    };
  };
})();
