/*
 * Чистая логика панели: разбор CSV, валидация, фильтрация, агрегаты, выгрузки.
 * Не зависит от DOM — используется и в браузере, и в проверках на Node.
 */
(function (global) {
  'use strict';

  var POINTS = {
    ice_center: 'Ледовый центр',
    forest_base: 'Лесная база',
    north_slope: 'Северный склон'
  };

  var ACTIVITIES = {
    ski: 'Лыжи',
    skate: 'Коньки',
    snowboard: 'Сноуборды',
    tube: 'Тюбинги'
  };

  var CHANNELS = {
    site: 'Сайт',
    desk: 'Стойка',
    phone: 'Телефон'
  };

  var STATUSES = {
    paid: 'Оплачено',
    partially_refunded: 'Частичный возврат',
    refunded: 'Полный возврат',
    cancelled: 'Отменено',
    pending: 'Ждёт оплаты'
  };

  var COLUMNS = [
    'id', 'date', 'rental_point', 'activity', 'channel',
    'status', 'quantity', 'amount', 'refund_amount', 'comment'
  ];

  var DAY_COLUMNS = ['date', 'bookings_total', 'paid_bookings', 'gross_amount', 'refund_amount', 'net_amount'];
  var GROUP_COLUMNS = ['rental_point', 'activity', 'bookings_total', 'paid_bookings', 'gross_amount', 'refund_amount', 'net_amount'];

  /* ---------- CSV ---------- */

  function parseCsv(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;

    for (var i = 0; i < text.length; i++) {
      var c = text[i];

      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
        continue;
      }

      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c === '\r') {
        // CRLF: перевод строки обрабатывается по \n
      } else {
        field += c;
      }
    }

    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }

    return rows;
  }

  function csvCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function csvText(header, data) {
    var lines = [header].concat(data).map(function (r) {
      return r.map(csvCell).join(',');
    });
    // BOM нужен, чтобы Excel открыл кириллицу как UTF-8
    return '\ufeff' + lines.join('\n') + '\n';
  }

  /* ---------- валидация ---------- */

  function isValidDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var parts = s.split('-');
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    if (y < 2000 || y > 2100) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function isIntString(s) {
    return /^\d+$/.test(s);
  }

  function statusRuleOk(status, amount, refund) {
    switch (status) {
      case 'paid': return amount > 0 && refund === 0;
      case 'partially_refunded': return refund > 0 && refund < amount;
      case 'refunded': return amount > 0 && refund === amount;
      case 'cancelled': return amount === 0 && refund === 0;
      case 'pending': return amount === 0 && refund === 0;
      default: return false;
    }
  }

  function loadCsv(text) {
    var errors = [];
    var warnings = [];
    var table = parseCsv(text);

    if (!table.length) {
      return { ok: false, errors: ['Файл пуст: нет строки заголовка.'], warnings: warnings, rows: [], header: [] };
    }

    var header = table[0].map(function (h) { return h.trim(); });

    var missing = COLUMNS.filter(function (c) { return header.indexOf(c) === -1; });
    if (missing.length) {
      errors.push('Не хватает обязательных столбцов: ' + missing.join(', ') + '.');
    }

    var extra = header.filter(function (h) { return COLUMNS.indexOf(h) === -1; });
    if (extra.length) {
      warnings.push('Лишние столбцы пропущены: ' + extra.join(', ') + '.');
    }

    if (errors.length) {
      return { ok: false, errors: errors, warnings: warnings, rows: [], header: header };
    }

    var idx = {};
    COLUMNS.forEach(function (c) { idx[c] = header.indexOf(c); });

    var rows = [];
    var seen = {};
    var duplicates = [];
    var badRows = {};

    function fail(line, message) {
      errors.push('Строка ' + line + ': ' + message);
      badRows[line] = true;
    }

    for (var i = 1; i < table.length; i++) {
      var rec = table[i];
      if (rec.length === 1 && rec[0] === '') continue;

      var line = i + 1;

      if (rec.length < header.length) {
        fail(line, 'не хватает значений (' + rec.length + ' из ' + header.length + ').');
        continue;
      }
      if (rec.length > header.length) {
        fail(line, 'лишние значения (' + rec.length + ' вместо ' + header.length + ').');
        continue;
      }

      var raw = {};
      COLUMNS.forEach(function (c) { raw[c] = rec[idx[c]]; });

      var id = raw.id.trim();
      var date = raw.date.trim();
      var point = raw.rental_point.trim();
      var activity = raw.activity.trim();
      var channel = raw.channel.trim();
      var status = raw.status.trim();
      var quantityRaw = raw.quantity.trim();
      var amountRaw = raw.amount.trim();
      var refundRaw = raw.refund_amount.trim();

      var rowErrors = [];

      if (!id) rowErrors.push('пустой id');
      if (seen[id]) {
        rowErrors.push('повтор id ' + id + ' (первая строка ' + seen[id] + ')');
        duplicates.push(id);
      }

      if (!isValidDate(date)) rowErrors.push('неверная дата «' + raw.date + '»');
      if (!POINTS[point]) rowErrors.push('неизвестная точка «' + raw.rental_point + '»');
      if (!ACTIVITIES[activity]) rowErrors.push('неизвестный инвентарь «' + raw.activity + '»');
      if (!CHANNELS[channel]) rowErrors.push('неизвестный канал «' + raw.channel + '»');
      if (!STATUSES[status]) rowErrors.push('неизвестный статус «' + raw.status + '»');

      if (!isIntString(quantityRaw) || Number(quantityRaw) <= 0) {
        rowErrors.push('количество должно быть целым положительным');
      }
      if (!isIntString(amountRaw)) {
        rowErrors.push('оплата должна быть целым неотрицательным числом');
      }
      if (!isIntString(refundRaw)) {
        rowErrors.push('возврат должен быть целым неотрицательным числом');
      }

      var amount = isIntString(amountRaw) ? Number(amountRaw) : NaN;
      var refund = isIntString(refundRaw) ? Number(refundRaw) : NaN;
      var quantity = isIntString(quantityRaw) ? Number(quantityRaw) : NaN;

      if (isIntString(amountRaw) && isIntString(refundRaw)) {
        if (refund > amount) rowErrors.push('возврат ' + refund + ' больше оплаты ' + amount);
        if (STATUSES[status] && !statusRuleOk(status, amount, refund)) {
          rowErrors.push('суммы не соответствуют статусу «' + STATUSES[status] + '»');
        }
      }

      if (rowErrors.length) {
        fail(line, rowErrors.join('; ') + '.');
        continue;
      }

      seen[id] = line;

      rows.push({
        id: id,
        date: date,
        rental_point: point,
        activity: activity,
        channel: channel,
        status: status,
        quantity: quantity,
        amount: amount,
        refund_amount: refund,
        comment: raw.comment,
        _line: line,
        _index: rows.length,
        _raw: raw
      });
    }

    if (!rows.length && !errors.length) {
      errors.push('В файле нет строк с данными.');
    }

    return {
      ok: errors.length === 0,
      errors: errors,
      warnings: warnings,
      duplicates: duplicates,
      rows: rows,
      header: header
    };
  }

  /* ---------- фильтры и агрегаты ---------- */

  function filterRows(rows, f) {
    f = f || {};
    var from = f.from || '';
    var to = f.to || '';
    var points = f.points || [];
    var activities = f.activities || [];
    var statuses = f.statuses || [];
    var channels = f.channels || [];

    return rows.filter(function (r) {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (points.length && points.indexOf(r.rental_point) === -1) return false;
      if (activities.length && activities.indexOf(r.activity) === -1) return false;
      if (statuses.length && statuses.indexOf(r.status) === -1) return false;
      if (channels.length && channels.indexOf(r.channel) === -1) return false;
      return true;
    });
  }

  function emptySummary() {
    return { total: 0, paid: 0, gross: 0, refund: 0, net: 0 };
  }

  function summarize(rows) {
    var s = emptySummary();
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      s.total++;
      s.gross += r.amount;
      s.refund += r.refund_amount;
      if (r.amount - r.refund_amount > 0) s.paid++;
    }
    s.net = s.gross - s.refund;
    return s;
  }

  function addToGroup(map, key, row) {
    var g = map[key];
    if (!g) {
      g = { total: 0, paid: 0, gross: 0, refund: 0, net: 0 };
      map[key] = g;
    }
    g.total++;
    g.gross += row.amount;
    g.refund += row.refund_amount;
    if (row.amount - row.refund_amount > 0) g.paid++;
    g.net = g.gross - g.refund;
  }

  function groupByDay(rows) {
    var map = {};
    rows.forEach(function (r) { addToGroup(map, r.date, r); });
    return Object.keys(map).sort().map(function (d) {
      var g = map[d];
      return {
        date: d,
        bookings_total: g.total,
        paid_bookings: g.paid,
        gross_amount: g.gross,
        refund_amount: g.refund,
        net_amount: g.net
      };
    });
  }

  function groupByPointActivity(rows) {
    var map = {};
    rows.forEach(function (r) {
      var key = r.rental_point + '\u0000' + r.activity;
      addToGroup(map, key, r);
    });
    return Object.keys(map).map(function (k) {
      var parts = k.split('\u0000');
      var g = map[k];
      return {
        rental_point: parts[0],
        activity: parts[1],
        bookings_total: g.total,
        paid_bookings: g.paid,
        gross_amount: g.gross,
        refund_amount: g.refund,
        net_amount: g.net
      };
    }).sort(function (a, b) {
      if (a.rental_point !== b.rental_point) return a.rental_point < b.rental_point ? -1 : 1;
      if (a.activity !== b.activity) return a.activity < b.activity ? -1 : 1;
      return 0;
    });
  }

  function addDays(iso, delta) {
    var p = iso.split('-').map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta));
    var mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(dt.getUTCDate()).padStart(2, '0');
    return dt.getUTCFullYear() + '-' + mm + '-' + dd;
  }

  /** Непрерывный ряд по дням: выбранный период либо фактический диапазон отбора. */
  function dailySeries(rows, f) {
    var byDate = {};
    rows.forEach(function (r) { byDate[r.date] = (byDate[r.date] || 0) + (r.amount - r.refund_amount); });

    var dates = Object.keys(byDate).sort();
    var start = (f && f.from) || dates[0] || '';
    var end = (f && f.to) || dates[dates.length - 1] || '';
    if (!start || !end || end < start) return [];

    var out = [];
    var cur = start;
    var guard = 0;
    while (cur <= end && guard < 1000) {
      out.push({ date: cur, net: byDate[cur] || 0 });
      cur = addDays(cur, 1);
      guard++;
    }
    return out;
  }

  function groupByActivity(rows) {
    var map = {};
    rows.forEach(function (r) {
      var g = map[r.activity];
      if (!g) {
        g = { activity: r.activity, total: 0, paid: 0, gross: 0, refund: 0, net: 0 };
        map[r.activity] = g;
      }
      g.total++;
      g.gross += r.amount;
      g.refund += r.refund_amount;
      if (r.amount - r.refund_amount > 0) g.paid++;
      g.net = g.gross - g.refund;
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      if (b.net !== a.net) return b.net - a.net;
      return a.activity < b.activity ? -1 : 1;
    });
  }

  /* ---------- выгрузки ---------- */

  function rawRows(rows) {
    return rows.map(function (r) {
      return COLUMNS.map(function (c) { return r._raw[c]; });
    });
  }

  function buildExports(rows) {
    var byDay = groupByDay(rows);
    var byGroup = groupByPointActivity(rows);
    var refunded = rows.filter(function (r) { return r.refund_amount > 0; });

    return {
      bookings: csvText(COLUMNS, rawRows(rows)),
      revenueByDay: csvText(DAY_COLUMNS, byDay.map(function (g) {
        return [g.date, g.bookings_total, g.paid_bookings, g.gross_amount, g.refund_amount, g.net_amount];
      })),
      revenueByPointActivity: csvText(GROUP_COLUMNS, byGroup.map(function (g) {
        return [g.rental_point, g.activity, g.bookings_total, g.paid_bookings, g.gross_amount, g.refund_amount, g.net_amount];
      })),
      refunds: csvText(COLUMNS, rawRows(refunded)),
      meta: {
        total: rows.length,
        refunded: refunded.length,
        days: byDay.length,
        groups: byGroup.length
      }
    };
  }

  var api = {
    POINTS: POINTS,
    ACTIVITIES: ACTIVITIES,
    CHANNELS: CHANNELS,
    STATUSES: STATUSES,
    COLUMNS: COLUMNS,
    parseCsv: parseCsv,
    csvText: csvText,
    loadCsv: loadCsv,
    filterRows: filterRows,
    summarize: summarize,
    groupByDay: groupByDay,
    groupByPointActivity: groupByPointActivity,
    groupByActivity: groupByActivity,
    dailySeries: dailySeries,
    buildExports: buildExports,
    isValidDate: isValidDate
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.RentalCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
