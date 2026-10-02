import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration,
  formatUtcTime,
  greatCircleKm,
  greatCirclePath,
  routePoint,
  routeSummary,
} from './flightRouteModel.js';

const MAD = { code: 'MAD', name: 'Madrid', lat: 40.4719, lon: -3.5626 };
const JFK = {
  code: 'JFK',
  name: 'New York',
  latitude: 40.6398,
  longitude: -73.7789,
};

test('great-circle distance and path match known values', () => {
  const km = greatCircleKm(routePoint(MAD), routePoint(JFK));
  assert.ok(Math.abs(km - 5770) < 30, `MAD-JFK ${km}`);
  const path = greatCirclePath(routePoint(MAD), routePoint(JFK), 10);
  assert.equal(path.length, 11);
  assert.ok(Math.abs(path[0].lat - MAD.lat) < 1e-6);
  assert.ok(Math.abs(path[10].lon - JFK.longitude) < 1e-6);
  // The great circle bows north of the parallel between them.
  assert.ok(path[5].lat > 45);
});

test('route summary reports progress and ETA from ground speed', () => {
  const now = Date.UTC(2026, 9, 1, 12, 0);
  const summary = routeSummary({
    origin: MAD,
    destination: JFK,
    position: { lat: 45, lon: -40 },
    speedMps: 250,
    nowMs: now,
  });
  assert.ok(summary.progress > 0.3 && summary.progress < 0.7);
  assert.ok(summary.remainingKm > 2000 && summary.remainingKm < 4000);
  assert.ok(summary.remainingMinutes > 100 && summary.remainingMinutes < 300);
  assert.ok(summary.etaMs > now);
  assert.equal(
    routeSummary({ origin: MAD, destination: null, position: MAD }),
    null,
  );
  assert.equal(
    routeSummary({ origin: MAD, destination: JFK, position: MAD, speedMps: 0 })
      .etaMs,
    null,
  );
});

test('formats durations and UTC times', () => {
  assert.equal(formatDuration(72), '1h 12m');
  assert.equal(formatDuration(48.4), '48m');
  assert.equal(formatDuration(NaN), '--');
  assert.equal(formatUtcTime(Date.UTC(2026, 0, 1, 16, 42)), '16:42Z');
});
