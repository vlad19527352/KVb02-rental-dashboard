/*
 * Локальная проверка расчётного ядра на реальной выгрузке.
 * Запуск: node tests/verify.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Core = require('../assets/core.js');

let failed = 0;
let checks = 0;

function ok(cond, label, extra) {
  checks++;
  if (!cond) {
    failed++;
    console.log('FAIL  ' + label + (extra !== undefined ? '  →  ' + extra : ''));
  } else {
    console.log('ok    ' + label);
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, label, 'получено ' + JSON.stringify(actual) + ', ожидалось ' + JSON.stringify(expected));
}

function rowsOf(csv) {
  return Core.parseCsv(csv).filter((r) => !(r.length === 1 && r[0] === ''));
}

function sum(arr, key) {
  return arr.reduce((s, r) => s + r[key], 0);
}

const file = path.join(__dirname, '..', 'data', 'bookings.csv');
const text = fs.readFileSync(file, 'utf8');
const loaded = Core.loadCsv(text);

console.log('=== 1. Загрузка и валидация ===');
ok(loaded.ok, 'файл прошёл проверку', loaded.errors.slice(0, 5).join(' | '));
eq(loaded.rows.length, 672, 'строк данных 672');
eq(loaded.errors.length, 0, 'ошибок нет');
eq(loaded.warnings.length, 0, 'предупреждений нет');
eq(loaded.rows[0].id, 'BR-261101-00067', 'первая строка в исходном порядке');
eq(loaded.rows[671].id, 'BR-261124-00187', 'последняя строка в исходном порядке');

console.log('\n=== 2. Итоги по всей выгрузке ===');
const all = Core.summarize(loaded.rows);
eq(all.total, 672, 'брони в отборе');
eq(all.paid, 581, 'брони с оплатой');
eq(all.gross, 1201255, 'оплаты');
eq(all.refund, 81367, 'возвраты');
eq(all.net, 1119888, 'чистая выручка');
eq(all.gross - all.refund, all.net, 'чистая = оплаты − возвраты');

console.log('\n=== 3. Пример: 21.11.2026 / Лесная база / лыжи ===');
const filters = { from: '2026-11-21', to: '2026-11-21', points: ['forest_base'], activities: ['ski'], statuses: [] };
const sample = Core.filterRows(loaded.rows, filters);
const s = Core.summarize(sample);
eq(sample.length, 4, 'строк в отборе');
eq(s.paid, 2, 'броней с оплатой');
eq(s.gross, 7800, 'оплаты');
eq(s.refund, 3000, 'возвраты');
eq(s.net, 4800, 'чистая выручка');
eq(sample.map((r) => r.id).join(','), 'BR-261121-00417,BR-261121-00428,BR-261121-00439,BR-261121-00455', 'порядок строк исходный');

console.log('\n=== 4. Канал продажи на том же отборе ===');
const siteOnly = Core.filterRows(loaded.rows, {
  from: '2026-11-21', to: '2026-11-21', points: ['forest_base'], activities: ['ski'], statuses: [], channels: ['site']
});
const sSite = Core.summarize(siteOnly);
eq(sSite.total, 2, 'сайт: броней в отборе');
eq(sSite.net, 2400, 'сайт: чистая выручка');
eq(sSite.refund, 0, 'сайт: возвраты');
eq(siteOnly.map((r) => r.id).join(','), 'BR-261121-00417,BR-261121-00455', 'сайт: строки 00417 и 00455');

const deskOnly = Core.filterRows(loaded.rows, {
  from: '2026-11-21', to: '2026-11-21', points: ['forest_base'], activities: ['ski'], statuses: [], channels: ['desk']
});
const sDesk = Core.summarize(deskOnly);
eq(sDesk.total, 1, 'стойка: броней в отборе');
eq(sDesk.net, 2400, 'стойка: чистая выручка');
eq(sDesk.refund, 1200, 'стойка: возвраты');
eq(deskOnly.map((r) => r.id).join(','), 'BR-261121-00428', 'стойка: строка 00428');

const siteCsv = rowsOf(Core.buildExports(siteOnly).bookings);
eq(siteCsv.length, 3, 'сайт: bookings — заголовок + 2 строки');
ok(siteCsv.slice(1).every((r) => r[4] === 'site'), 'сайт: в CSV только канал site');
eq(siteCsv.slice(1).map((r) => r[0]).join(','), 'BR-261121-00417,BR-261121-00455', 'сайт: CSV сохраняет исходный порядок');

console.log('\n=== 5. Четыре файла на этом отборе ===');
const ex = Core.buildExports(sample);
const b = rowsOf(ex.bookings);
const d = rowsOf(ex.revenueByDay);
const g = rowsOf(ex.revenueByPointActivity);
const rf = rowsOf(ex.refunds);

eq(b.length, 5, 'bookings: заголовок + 4 строки');
eq(b[0].length, 10, 'bookings: 10 исходных столбцов');
eq(b[1][0], 'BR-261121-00417', 'bookings: первая строка детализации');
eq(b[4][0], 'BR-261121-00455', 'bookings: последняя строка детализации');

eq(d.length, 2, 'revenue-by-day: заголовок + 1 дата');
eq(d[0].join(','), 'date,bookings_total,paid_bookings,gross_amount,refund_amount,net_amount', 'revenue-by-day: заголовок');
eq(d[1].join(','), '2026-11-21,4,2,7800,3000,4800', 'revenue-by-day: итог за 21.11');

eq(g.length, 2, 'revenue-by-point-and-activity: заголовок + 1 пара');
eq(g[0].join(','), 'rental_point,activity,bookings_total,paid_bookings,gross_amount,refund_amount,net_amount', 'revenue-by-point-and-activity: заголовок');
eq(g[1].join(','), 'forest_base,ski,4,2,7800,3000,4800', 'revenue-by-point-and-activity: итог');

eq(rf.length, 3, 'refunds: заголовок + 2 возврата');
eq(rf.slice(1).map((r) => r[0]).join(','), 'BR-261121-00428,BR-261121-00439', 'refunds: только строки с возвратом');
ok(rf.slice(1).every((r) => Number(r[8]) > 0), 'refunds: refund_amount > 0 у каждой строки');
eq(sum(d.slice(1).map((r) => ({ n: Number(r[5]) })), 'n'), s.net, 'дневная сводка: сумма net = карточка');
eq(sum(g.slice(1).map((r) => ({ n: Number(r[6]) })), 'n'), s.net, 'групповая сводка: сумма net = карточка');

console.log('\n=== 6. Выгрузка «Брони» за 21–22 ноября, все точки ===');
const twoDays = Core.filterRows(loaded.rows, { from: '2026-11-21', to: '2026-11-22', points: [], activities: [], statuses: [] });
const two = Core.buildExports(twoDays);
const tb = rowsOf(two.bookings);
eq(twoDays.length, 89, 'строк в отборе за 2 дня');
eq(tb.length, 90, 'bookings: заголовок + 89 строк (не зависит от пагинации)');
eq(tb[1][0], twoDays[0].id, 'bookings: первая строка = первая строка отбора');
eq(tb[tb.length - 1][0], twoDays[twoDays.length - 1].id, 'bookings: последняя строка = последняя строка отбора');
eq(tb[tb.length - 1][1], '2026-11-22', 'bookings: последняя дата 22.11');
const twoSummary = Core.summarize(twoDays);
eq(sum(rowsOf(two.revenueByDay).slice(1).map((r) => ({ n: Number(r[5]) })), 'n'), twoSummary.net, 'две даты: net сходится');
eq(sum(rowsOf(two.revenueByPointActivity).slice(1).map((r) => ({ n: Number(r[3]) })), 'n'), twoSummary.paid, 'группы: paid_bookings сходится');

console.log('\n=== 7. Пустой отбор ===');
const empty = Core.buildExports(Core.filterRows(loaded.rows, { from: '2026-12-01', to: '2026-12-02' }));
eq(rowsOf(empty.bookings).length, 1, 'bookings: только заголовок');
eq(rowsOf(empty.revenueByDay).length, 1, 'revenue-by-day: только заголовок');
eq(rowsOf(empty.revenueByPointActivity).length, 1, 'revenue-by-point-and-activity: только заголовок');
eq(rowsOf(empty.refunds).length, 1, 'refunds: только заголовок');
eq(empty.bookings.charCodeAt(0), 0xfeff, 'BOM в начале файла');

console.log('\n=== 8. Ошибки загрузки ===');
const header = 'id,date,rental_point,activity,channel,status,quantity,amount,refund_amount,comment\n';
const badDup = Core.loadCsv(header +
  'A-1,2026-11-01,ice_center,skate,site,paid,1,900,0,\n' +
  'A-1,2026-11-02,ice_center,skate,site,paid,1,900,0,\n');
ok(!badDup.ok && badDup.errors.some((e) => e.includes('повтор id')), 'ловит повтор ID');

const badRefund = Core.loadCsv(header +
  'A-2,2026-11-01,ice_center,skate,site,partially_refunded,1,500,900,\n');
ok(!badRefund.ok && badRefund.errors.some((e) => e.includes('больше оплаты')), 'ловит возврат больше оплаты');

const badColumn = Core.loadCsv('id,date,rental_point,activity,channel,status,quantity,amount\nA-3,2026-11-01,ice_center,skate,site,paid,1,900\n');
ok(!badColumn.ok && badColumn.errors.some((e) => e.includes('refund_amount')), 'ловит пропущенный столбец');

const badStatus = Core.loadCsv(header + 'A-4,2026-11-01,ice_center,skate,site,paid,1,900,300,\n');
ok(!badStatus.ok && badStatus.errors.some((e) => e.includes('статусу')), 'ловит нарушение правил статуса');

const badDate = Core.loadCsv(header + 'A-5,2026-02-30,ice_center,skate,site,paid,1,900,0,\n');
ok(!badDate.ok && badDate.errors.some((e) => e.includes('дата')), 'ловит несуществующую дату');

console.log('\n=== Итог ===');
console.log('Проверок: ' + checks + ', провалов: ' + failed);
if (failed) process.exit(1);
