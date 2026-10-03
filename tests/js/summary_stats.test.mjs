// Run: node --test tests/js/summary_stats.test.mjs
// Extracts computeSummaryStats from the single-file frontend so the real code is tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
const m = html.match(/\/\/ SUMMARY-STATS-START[^\n]*\n([\s\S]*?)\/\/ SUMMARY-STATS-END/);
assert.ok(m, 'summary-stats markers not found in index.html');
const computeSummaryStats = new Function(`${m[1]}; return computeSummaryStats;`)();

const days = sleeps => sleeps.map((s, i) => ({ date: `2025-01-0${i + 1}`, steps: 1000 * (i + 1), sleep_hours: s }));

test('best/worst sleep over positive values', () => {
  const s = computeSummaryStats(days([7, 6.5, 8]));
  assert.equal(s.worst_sleep, 6.5);
  assert.equal(s.best_sleep, 8);
});

test('nulls are ignored', () => {
  const s = computeSummaryStats(days([null, 7, null, 5.5]));
  assert.equal(s.worst_sleep, 5.5);
  assert.equal(s.best_sleep, 7);
});

test('no sleep data stays null, not 0', () => {
  for (const input of [[], days([null, null])]) {
    const s = computeSummaryStats(input);
    assert.equal(s.worst_sleep, null);
    assert.equal(s.best_sleep, null);
    assert.equal(s.avg_sleep_hours, null);
  }
});

test('other stats unchanged', () => {
  const s = computeSummaryStats(days([7, 6.5, 8]));
  assert.equal(s.best_steps_day, '2025-01-03');
  assert.equal(s.total_days, 3);
  assert.equal(s.avg_steps, 2000);
  assert.equal(computeSummaryStats([]).best_steps_day, null);
});
