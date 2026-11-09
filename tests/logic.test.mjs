import test from 'node:test';
import assert from 'node:assert/strict';
import { quincenaDates, planDeuda, formatCOP, esFechaISO } from '../js/logic.js';

test('quincenaDates: 15 y fin de mes dentro de (inicio, meta]', () => {
  assert.deepEqual(quincenaDates('2026-11-09', '2026-12-31'),
    ['2026-11-15', '2026-11-30', '2026-12-15', '2026-12-31']);
});

test('quincenaDates: inicio en quincena no la cuenta; meta fuera de quincena se agrega', () => {
  assert.deepEqual(quincenaDates('2026-11-15', '2026-12-20'),
    ['2026-11-30', '2026-12-15', '2026-12-20']);
});

test('quincenaDates: febrero bisiesto y no bisiesto', () => {
  assert.deepEqual(quincenaDates('2028-02-01', '2028-02-29'), ['2028-02-15', '2028-02-29']);
  assert.deepEqual(quincenaDates('2027-02-01', '2027-02-28'), ['2027-02-15', '2027-02-28']);
});

test('quincenaDates: meta <= inicio da solo la meta', () => {
  assert.deepEqual(quincenaDates('2026-11-09', '2026-11-09'), ['2026-11-09']);
  assert.deepEqual(quincenaDates('2026-11-09', '2026-10-01'), ['2026-10-01']);
});

const deuda = { valor: 1200000, fecha_inicio: '2026-11-01', fecha_meta: '2026-12-31' };

test('planDeuda: cuota quincenal = valor / nº de quincenas', () => {
  const p = planDeuda(deuda, 0, '2026-11-02');
  assert.equal(p.cuotas, 4);
  assert.equal(p.cuota, 300000);
});

test('planDeuda: al día cuando pagó lo esperado; adelanto si pagó más', () => {
  let p = planDeuda(deuda, 300000, '2026-11-16'); // venció 15-nov
  assert.equal(p.estado, 'al_dia');
  assert.equal(p.diferencia, 0);
  p = planDeuda(deuda, 500000, '2026-11-16');
  assert.equal(p.estado, 'al_dia');
  assert.equal(p.diferencia, 200000);
});

test('planDeuda: atraso en $ y en cuotas', () => {
  const p = planDeuda(deuda, 150000, '2026-12-16'); // vencidas 3 → esperado 900000
  assert.equal(p.estado, 'atrasada');
  assert.equal(p.atraso, 750000);
  assert.equal(p.atrasoCuotas, 2.5);
});

test('planDeuda: el día exacto de la quincena ya cuenta como vencida', () => {
  const p = planDeuda(deuda, 0, '2026-11-15');
  assert.equal(p.estado, 'atrasada');
  assert.equal(p.atraso, 300000);
});

test('planDeuda: antes de la primera quincena, sin pagos, está al día', () => {
  const p = planDeuda(deuda, 0, '2026-11-10');
  assert.equal(p.estado, 'al_dia');
  assert.equal(p.proximaFecha, '2026-11-15');
  assert.equal(p.paraProxima, 300000);
});

test('planDeuda: porcentaje y completada', () => {
  assert.equal(planDeuda(deuda, 300000, '2026-11-10').pct, 25);
  const p = planDeuda(deuda, 1200000, '2027-01-10');
  assert.equal(p.estado, 'completada');
  assert.equal(p.pct, 100);
});

test('planDeuda: pagado de más no pasa de 100%', () => {
  assert.equal(planDeuda(deuda, 2000000, '2026-11-10').pct, 100);
});

test('planDeuda: pasada la meta se espera el valor completo', () => {
  const p = planDeuda(deuda, 600000, '2027-02-01');
  assert.equal(p.estado, 'atrasada');
  assert.equal(p.atraso, 600000);
  assert.equal(p.proximaFecha, null);
});

test('formatCOP y esFechaISO', () => {
  assert.equal(formatCOP(1250000).replace(/\s/g, ''), '$1.250.000');
  assert.equal(esFechaISO('2026-02-30'), false);
  assert.equal(esFechaISO('2026-02-28'), true);
});
