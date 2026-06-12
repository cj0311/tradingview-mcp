import { evaluate } from './connection.js';

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;

export function normalizeSymbol(symbol) {
  if (!symbol) return '';
  return String(symbol)
    .trim()
    .toUpperCase()
    .replace(/^.*:/, '')
    .replace(/\s+/g, '');
}

export function symbolsMatch(actual, expected) {
  if (!expected) return true;
  const a = normalizeSymbol(actual);
  const e = normalizeSymbol(expected);
  if (!a || !e) return false;
  return a === e || a.includes(e) || e.includes(a);
}

export async function waitUntil(predicate, { timeout = DEFAULT_TIMEOUT, interval = POLL_INTERVAL } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await predicate();
    if (last) return { ok: true, elapsed_ms: Date.now() - start, value: last };
    await new Promise(r => setTimeout(r, interval));
  }
  return { ok: false, elapsed_ms: Date.now() - start, value: last };
}

export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT) {
  const start = Date.now();
  let lastBarSize = -1;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    const state = await evaluate(`
      (function() {
        var spinner = document.querySelector('[class*="loader"]')
          || document.querySelector('[class*="loading"]')
          || document.querySelector('[data-name="loading"]');
        var isLoading = spinner && spinner.offsetParent !== null;

        var symbol = '';
        var symbolShort = '';
        var resolution = '';
        var barSize = -1;

        try {
          var api = window.TradingViewApi._activeChartWidgetWV.value();
          symbol = api.symbol ? api.symbol() : '';
          resolution = api.resolution ? api.resolution() : '';
          var ext = api.symbolExt ? api.symbolExt() : null;
          if (ext) symbolShort = ext.symbol || ext.short_name || ext.pro_name || ext.description || '';
        } catch(e) {}

        try {
          var bars = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().model().mainSeries().bars();
          if (bars && typeof bars.size === 'function') barSize = bars.size();
        } catch(e) {}

        var symbolEl = document.querySelector('[data-name="legend-source-title"]')
          || document.querySelector('[class*="title"] [class*="apply-common-tooltip"]');
        var headerSymbol = symbolEl ? symbolEl.textContent.trim() : '';

        return { isLoading: !!isLoading, barSize: barSize, symbol: symbol, symbolShort: symbolShort, headerSymbol: headerSymbol, resolution: resolution };
      })()
    `);

    if (!state || state.isLoading) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    const symbolOk = !expectedSymbol
      || symbolsMatch(state.symbol, expectedSymbol)
      || symbolsMatch(state.symbolShort, expectedSymbol)
      || symbolsMatch(state.headerSymbol, expectedSymbol);
    if (!symbolOk) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    if (expectedTf && state.resolution && String(state.resolution) !== String(expectedTf)) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    if (state.barSize === lastBarSize && state.barSize > 0) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastBarSize = state.barSize;

    if (stableCount >= 2) return true;
    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  return false;
}
