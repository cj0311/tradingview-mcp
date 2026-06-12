/**
 * Core data access logic.
 */
import { evaluate, evaluateAsync, KNOWN_PATHS } from '../connection.js';
import { readdirSync, statSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { homedir } from 'os';

const MAX_OHLCV_BARS = 500;
const MAX_TRADES = 20;
const CHART_API = KNOWN_PATHS.chartApi;
const BARS_PATH = KNOWN_PATHS.mainSeriesBars;

const STRATEGY_HELPERS = `
  function norm(s) { return String(s || '').replace(/\\s+/g, ' ').trim(); }
  function visible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
  function safeValue(v) {
    try {
      if (v && typeof v.value === 'function') return v.value();
    } catch(e) {}
    return v;
  }
  function sourceId(s) {
    try { return s.id && s.id(); } catch(e) { return null; }
  }
  function sourceName(s, meta) {
    try { if (s.name) return s.name(); } catch(e) {}
    return meta.description || meta.shortDescription || 'unknown';
  }
  function readReportData(s) {
    var rd = null;
    try { rd = s.reportData ? (typeof s.reportData === 'function' ? s.reportData() : s.reportData) : s._reportData; } catch(e) {}
    return safeValue(rd);
  }
  function readOrdersData(s) {
    var od = null;
    try { od = s.ordersData ? (typeof s.ordersData === 'function' ? s.ordersData() : s.ordersData) : s._ordersData; } catch(e) {}
    return safeValue(od);
  }
  function isStrategySource(s, meta, reportData, ordersData) {
    return !!(
      meta.isTVScriptStrategy ||
      /StrategyScript/.test(meta.id || '') ||
      reportData ||
      ordersData ||
      s._reportData ||
      s._reportDataBuffer ||
      s.ordersData ||
      s.reportData
    );
  }
  function listStrategies() {
    var chart = ${CHART_API}._chartWidget;
    var sources = chart.model().model().dataSources();
    var strategies = [];
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      var meta = {};
      try { meta = s.metaInfo && s.metaInfo() || {}; } catch(e) {}
      var reportData = readReportData(s);
      var ordersData = readOrdersData(s);
      if (!isStrategySource(s, meta, reportData, ordersData)) continue;
      var id = sourceId(s);
      var name = sourceName(s, meta);
      var perf = reportData && reportData.performance || {};
      var all = perf.all || {};
      strategies.push({
        index: i,
        id: id,
        name: name,
        meta_id: meta.id || null,
        is_price_study: meta.is_price_study,
        isTVScriptStrategy: !!meta.isTVScriptStrategy,
        report_ready: !!reportData,
        trades_count: reportData && Array.isArray(reportData.trades) ? reportData.trades.length : null,
        filled_orders_count: reportData && Array.isArray(reportData.filledOrders) ? reportData.filledOrders.length : null,
        orders_count: Array.isArray(ordersData) ? ordersData.length : null,
        net_profit: all.netProfit,
        profit_factor: all.profitFactor,
        source: s,
        reportData: reportData,
        ordersData: ordersData
      });
    }
    return strategies;
  }
  function publicStrategy(s) {
    return {
      id: s.id,
      name: s.name,
      meta_id: s.meta_id,
      report_ready: s.report_ready,
      trades_count: s.trades_count,
      filled_orders_count: s.filled_orders_count,
      orders_count: s.orders_count,
      net_profit: s.net_profit,
      profit_factor: s.profit_factor
    };
  }
  function activeStrategyName() {
    var texts = [];
    var els = document.querySelectorAll('button, [role="button"], [role="tab"], span, div');
    for (var i = 0; i < els.length; i++) {
      if (!visible(els[i])) continue;
      var text = norm(els[i].textContent);
      if (text && /OnlyBit|Strategy|List of trades|Performance Summary|Overview/.test(text)) texts.push(text);
    }
    return texts.join(' ');
  }
  function selectStrategy(selector) {
    selector = selector || {};
    var strategies = listStrategies();
    if (strategies.length === 0) return { error: 'No strategy found on chart.', code: 'no_strategy', strategies: [] };
    var selected = null;
    if (selector.entity_id) {
      selected = strategies.find(function(s) { return s.id === selector.entity_id; });
      if (!selected) return { error: 'Strategy not found for entity_id: ' + selector.entity_id, code: 'strategy_not_found', strategies: strategies.map(publicStrategy) };
    } else if (selector.strategy_name) {
      var target = String(selector.strategy_name).toLowerCase();
      selected = strategies.find(function(s) { return String(s.name || '').toLowerCase() === target; })
        || strategies.find(function(s) { return String(s.name || '').toLowerCase().indexOf(target) !== -1; });
      if (!selected) return { error: 'Strategy not found for name: ' + selector.strategy_name, code: 'strategy_not_found', strategies: strategies.map(publicStrategy) };
    } else if (selector.active) {
      var activeText = activeStrategyName().toLowerCase();
      selected = strategies.slice().reverse().find(function(s) { return activeText.indexOf(String(s.name || '').toLowerCase()) !== -1; });
      if (!selected) return { error: 'Could not determine active Strategy Tester strategy.', code: 'active_strategy_not_found', strategies: strategies.map(publicStrategy) };
    } else if (selector.latest) {
      selected = strategies[strategies.length - 1];
    } else if (strategies.length === 1) {
      selected = strategies[0];
    } else {
      return { error: 'Multiple strategies found. Pass entity_id, strategy_name, active, or latest.', code: 'ambiguous_strategy', strategies: strategies.map(publicStrategy) };
    }
    return { selected: selected, strategies: strategies };
  }
`;

function selectorOptions({ entity_id, strategy_name, active, latest } = {}) {
  return {
    entity_id: entity_id || undefined,
    strategy_name: strategy_name || undefined,
    active: !!active,
    latest: !!latest,
  };
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell);
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(v => v !== '')) rows.push(row);
  }
  return rows;
}

function listCsvFiles(dir) {
  try {
    return readdirSync(dir)
      .filter(name => name.toLowerCase().endsWith('.csv'))
      .map(name => {
        const fullPath = join(dir, name);
        const st = statSync(fullPath);
        return { path: fullPath, name, mtimeMs: st.mtimeMs, size: st.size };
      });
  } catch {
    return [];
  }
}

function buildGraphicsJS(collectionName, mapKey, filter) {
  return `
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      var filter = '${filter}';
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          if (filter && name.indexOf(filter) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          var pc = g._primitivesCollection;
          var items = [];
          try {
            var outer = pc.${collectionName};
            if (outer) {
              var inner = outer.get('${mapKey}');
              if (inner) {
                var coll = inner.get(false);
                if (coll && coll._primitivesDataById && coll._primitivesDataById.size > 0) {
                  coll._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            }
          } catch(e) {}
          if (items.length === 0 && '${collectionName}' === 'dwgtablecells') {
            try {
              var tcOuter = pc.dwgtablecells;
              if (tcOuter) {
                var tcColl = tcOuter.get('tableCells');
                if (tcColl && tcColl._primitivesDataById && tcColl._primitivesDataById.size > 0) {
                  tcColl._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            } catch(e) {}
          }
          if (items.length > 0) results.push({name: name, count: items.length, items: items});
        } catch(e) {}
      }
      return results;
    })()
  `;
}

export async function getOhlcv({ count, summary } = {}) {
  const limit = Math.min(count || 100, MAX_OHLCV_BARS);
  let data;
  try {
    data = await evaluate(`
      (function() {
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') return null;
        var result = [];
        var end = bars.lastIndex();
        var start = Math.max(bars.firstIndex(), end - ${limit} + 1);
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (v) result.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
        }
        return {bars: result, total_bars: bars.size(), source: 'direct_bars'};
      })()
    `);
  } catch { data = null; }

  if (!data || !data.bars || data.bars.length === 0) {
    throw new Error('Could not extract OHLCV data. The chart may still be loading.');
  }

  if (summary) {
    const bars = data.bars;
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const volumes = bars.map(b => b.volume);
    const first = bars[0];
    const last = bars[bars.length - 1];
    return {
      success: true, bar_count: bars.length,
      period: { from: first.time, to: last.time },
      open: first.open, close: last.close,
      high: Math.max(...highs), low: Math.min(...lows),
      range: Math.round((Math.max(...highs) - Math.min(...lows)) * 100) / 100,
      change: Math.round((last.close - first.open) * 100) / 100,
      change_pct: Math.round(((last.close - first.open) / first.open) * 10000) / 100 + '%',
      avg_volume: Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length),
      last_5_bars: bars.slice(-5),
    };
  }

  return { success: true, bar_count: data.bars.length, total_available: data.total_bars, source: data.source, bars: data.bars };
}

export async function getIndicator({ entity_id }) {
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var study = api.getStudyById('${entity_id}');
      if (!study) return { error: 'Study not found: ${entity_id}' };
      var result = { name: null, inputs: null, visible: null };
      try { result.visible = study.isVisible(); } catch(e) {}
      try { result.inputs = study.getInputValues(); } catch(e) { result.inputs_error = e.message; }
      return result;
    })()
  `);

  if (data?.error) throw new Error(data.error);

  let inputs = data?.inputs;
  if (Array.isArray(inputs)) {
    inputs = inputs.filter(inp => {
      if (inp.id === 'text' && typeof inp.value === 'string' && inp.value.length > 200) return false;
      if (typeof inp.value === 'string' && inp.value.length > 500) return false;
      return true;
    });
  }
  return { success: true, entity_id, visible: data?.visible, inputs };
}

export async function listStrategies() {
  const data = await evaluate(`
    (function() {
      try {
        ${STRATEGY_HELPERS}
        return { strategies: listStrategies().map(publicStrategy), source: 'internal_api' };
      } catch(e) {
        return { strategies: [], source: 'internal_api', error: e.message };
      }
    })()
  `);
  return { success: true, strategy_count: data?.strategies?.length || 0, source: data?.source, strategies: data?.strategies || [], error: data?.error };
}

export async function getStrategyResults(options = {}) {
  const selector = selectorOptions(options);
  const results = await evaluate(`
    (function() {
      try {
        ${STRATEGY_HELPERS}
        var selected = selectStrategy(${JSON.stringify(selector)});
        if (selected.error) return { metrics: {}, source: 'internal_api', error: selected.error, code: selected.code, strategies: selected.strategies };
        var strat = selected.selected;
        var rd = strat.reportData;
        var perf = rd && rd.performance || {};
        var all = perf.all || {};
        var metrics = {
          currency: rd && rd.currency || null,
          date_range: rd && rd.settings && rd.settings.dateRange || null,
          all: all,
          long: perf.long || null,
          short: perf.short || null,
          maxStrategyDrawDown: perf.maxStrategyDrawDown,
          maxStrategyDrawDownPercent: perf.maxStrategyDrawDownPercent,
          maxStrategyRunUp: perf.maxStrategyRunUp,
          maxStrategyRunUpPercent: perf.maxStrategyRunUpPercent,
          openPL: perf.openPL,
          openPLPercent: perf.openPLPercent,
          buyHoldReturn: perf.buyHoldReturn,
          buyHoldReturnPercent: perf.buyHoldReturnPercent,
          sharpeRatio: perf.sharpeRatio,
          sortinoRatio: perf.sortinoRatio,
          maxMarginUsed: perf.maxMarginUsed,
          avgMarginUsed: perf.avgMarginUsed,
          openMarginUsed: perf.openMarginUsed
        };
        return { metrics: metrics, strategy: publicStrategy(strat), source: 'internal_api' };
      } catch(e) { return {metrics: {}, source: 'internal_api', error: e.message}; }
    })()
  `);
  return {
    success: !results?.error,
    metric_count: Object.keys(results?.metrics || {}).length,
    source: results?.source,
    strategy: results?.strategy,
    metrics: results?.metrics || {},
    strategies: results?.strategies,
    code: results?.code,
    error: results?.error,
  };
}

export async function getTrades({ max_trades, entity_id, strategy_name, active, latest } = {}) {
  const limit = Math.min(max_trades || 20, MAX_TRADES);
  const selector = selectorOptions({ entity_id, strategy_name, active, latest });
  const trades = await evaluate(`
    (function() {
      try {
        ${STRATEGY_HELPERS}
        var selected = selectStrategy(${JSON.stringify(selector)});
        if (selected.error) return { trades: [], source: 'internal_api', error: selected.error, code: selected.code, strategies: selected.strategies };
        var strat = selected.selected;
        var reportTrades = strat.reportData && Array.isArray(strat.reportData.trades) ? strat.reportData.trades : null;
        var filledOrders = strat.reportData && Array.isArray(strat.reportData.filledOrders) ? strat.reportData.filledOrders : null;
        var orders = reportTrades || strat.ordersData || filledOrders || [];
        if (!Array.isArray(orders)) return { trades: [], source: 'internal_api', error: 'Strategy trade data returned non-array.' };
        function mapOrder(o, idx) {
          if (reportTrades) {
            return {
              trade_number: idx + 1,
              entry: o.e ? { signal: o.e.c, price: o.e.p, time: o.e.tm, side: o.e.b === true ? 'long' : (o.e.b === false ? 'short' : null), type: o.e.tp } : null,
              exit: o.x ? { signal: o.x.c, price: o.x.p, time: o.x.tm, side: o.x.b === true ? 'long' : (o.x.b === false ? 'short' : null), type: o.x.tp } : null,
              qty: o.q,
              net_profit: o.rn && o.rn.v,
              net_profit_percent: o.rn && o.rn.p,
              cumulative_profit: o.cp && o.cp.v,
              cumulative_profit_percent: o.cp && o.cp.p,
              favorable_excursion: o.tp && o.tp.v,
              favorable_excursion_percent: o.tp && o.tp.p,
              adverse_excursion: o.dd && o.dd.v,
              adverse_excursion_percent: o.dd && o.dd.p,
              equity: o.v
            };
          }
          var out = { trade_number: idx + 1 };
          if (o && typeof o === 'object') {
            var keys = Object.keys(o);
            for (var k = 0; k < keys.length; k++) {
              var v = o[keys[k]];
              if (v !== null && v !== undefined && typeof v !== 'function' && typeof v !== 'object') out[keys[k]] = v;
            }
          }
          return out;
        }
        var result = [];
        for (var t = 0; t < Math.min(orders.length, ${limit}); t++) {
          result.push(mapOrder(orders[t], t));
        }
        return { trades: result, total_available: orders.length, strategy: publicStrategy(strat), source: 'internal_api' };
      } catch(e) { return {trades: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return {
    success: !trades?.error,
    trade_count: trades?.trades?.length || 0,
    total_available: trades?.total_available,
    source: trades?.source,
    strategy: trades?.strategy,
    trades: trades?.trades || [],
    strategies: trades?.strategies,
    code: trades?.code,
    error: trades?.error,
  };
}

export async function getEquity(options = {}) {
  const selector = selectorOptions(options);
  const equity = await evaluate(`
    (function() {
      try {
        ${STRATEGY_HELPERS}
        var selected = selectStrategy(${JSON.stringify(selector)});
        if (selected.error) return { data: [], source: 'internal_api', error: selected.error, code: selected.code, strategies: selected.strategies };
        var strat = selected.selected;
        var data = [];
        var rd = strat.reportData;
        var perf = rd && rd.performance || {};
        var all = perf.all || {};
        var summary = {
          netProfit: all.netProfit,
          netProfitPercent: all.netProfitPercent,
          openPL: perf.openPL,
          openPLPercent: perf.openPLPercent,
          maxStrategyDrawDown: perf.maxStrategyDrawDown,
          maxStrategyDrawDownPercent: perf.maxStrategyDrawDownPercent,
          maxStrategyRunUp: perf.maxStrategyRunUp,
          maxStrategyRunUpPercent: perf.maxStrategyRunUpPercent,
          buyHoldReturn: perf.buyHoldReturn,
          buyHoldReturnPercent: perf.buyHoldReturnPercent
        };
        var series = {
          buyHold: rd && Array.isArray(rd.buyHold) ? rd.buyHold : undefined,
          buyHoldPercent: rd && Array.isArray(rd.buyHoldPercent) ? rd.buyHoldPercent : undefined,
          marginUsage: rd && Array.isArray(rd.marginUsage) ? rd.marginUsage : undefined
        };
        if (data.length === 0) {
          return { data: [], equity_summary: summary, available_series: series, strategy: publicStrategy(strat), source: 'internal_api', note: 'Full equity curve is not exposed by this TradingView API surface; summary and available report series returned.' };
        }
        return { data: data, equity_summary: summary, available_series: series, strategy: publicStrategy(strat), source: 'internal_api' };
      } catch(e) { return {data: [], source: 'internal_api', error: e.message}; }
    })()
  `);
  return {
    success: !equity?.error,
    data_points: equity?.data?.length || 0,
    source: equity?.source,
    strategy: equity?.strategy,
    data: equity?.data || [],
    equity_summary: equity?.equity_summary,
    available_series: equity?.available_series,
    strategies: equity?.strategies,
    note: equity?.note,
    code: equity?.code,
    error: equity?.error,
  };
}

export async function exportTrades({ entity_id, strategy_name, active, latest, downloads_dir, timeout_ms } = {}) {
  const selector = selectorOptions({ entity_id, strategy_name, active, latest });
  const selected = await evaluate(`
    (function() {
      try {
        ${STRATEGY_HELPERS}
        var selected = selectStrategy(${JSON.stringify(selector)});
        if (selected.error) return { error: selected.error, code: selected.code, strategies: selected.strategies };
        return { strategy: publicStrategy(selected.selected) };
      } catch(e) {
        return { error: e.message };
      }
    })()
  `);
  if (selected?.error) {
    return { success: false, error: selected.error, code: selected.code, strategies: selected.strategies };
  }

  const dir = downloads_dir || join(homedir(), 'Downloads');
  const before = new Map(listCsvFiles(dir).map(f => [f.path, f.mtimeMs]));
  const clicked = await evaluate(`
    (function() {
      function visible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); }
      var buttons = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"]'));
      var btn = buttons.find(function(b) { return visible(b) && /Download \\.csv/i.test(String(b.getAttribute('title') || '')); });
      if (!btn) return { clicked: false, error: 'Download .csv button not found. Open Strategy Tester List of trades first.' };
      btn.click();
      return { clicked: true, title: btn.getAttribute('title') || null };
    })()
  `);
  if (!clicked?.clicked) return { success: false, strategy: selected.strategy, error: clicked?.error || 'Download .csv button not found.' };

  const timeout = timeout_ms || 15000;
  const start = Date.now();
  let file = null;
  while (Date.now() - start < timeout) {
    const candidates = listCsvFiles(dir)
      .filter(f => !before.has(f.path) || f.mtimeMs > before.get(f.path))
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (candidates.length > 0 && candidates[0].size > 0) {
      file = candidates[0];
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  if (!file) return { success: false, strategy: selected.strategy, clicked, error: 'CSV download was not detected before timeout.', downloads_dir: dir };

  const text = readFileSync(file.path, 'utf8');
  const rows = parseCsvRows(text);
  const columns = rows[0] || [];
  return {
    success: true,
    strategy: selected.strategy,
    clicked,
    file_path: file.path,
    file_name: basename(file.path),
    downloads_dir: dir,
    size_bytes: file.size,
    row_count: Math.max(rows.length - 1, 0),
    columns,
  };
}

export async function getQuote({ symbol } = {}) {
  const data = await evaluate(`
    (function() {
      var api = ${CHART_API};
      var sym = '${symbol || ''}';
      if (!sym) { try { sym = api.symbol(); } catch(e) {} }
      if (!sym) { try { sym = api.symbolExt().symbol; } catch(e) {} }
      var ext = {};
      try { ext = api.symbolExt() || {}; } catch(e) {}
      var bars = ${BARS_PATH};
      var quote = { symbol: sym };
      if (bars && typeof bars.lastIndex === 'function') {
        var last = bars.valueAt(bars.lastIndex());
        if (last) { quote.time = last[0]; quote.open = last[1]; quote.high = last[2]; quote.low = last[3]; quote.close = last[4]; quote.last = last[4]; quote.volume = last[5] || 0; }
      }
      try {
        var bidEl = document.querySelector('[class*="bid"] [class*="price"], [class*="dom-"] [class*="bid"]');
        var askEl = document.querySelector('[class*="ask"] [class*="price"], [class*="dom-"] [class*="ask"]');
        if (bidEl) quote.bid = parseFloat(bidEl.textContent.replace(/[^0-9.\\-]/g, ''));
        if (askEl) quote.ask = parseFloat(askEl.textContent.replace(/[^0-9.\\-]/g, ''));
      } catch(e) {}
      try {
        var hdr = document.querySelector('[class*="headerRow"] [class*="last-"]');
        if (hdr) { var hdrPrice = parseFloat(hdr.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(hdrPrice)) quote.header_price = hdrPrice; }
      } catch(e) {}
      if (ext.description) quote.description = ext.description;
      if (ext.exchange) quote.exchange = ext.exchange;
      if (ext.type) quote.type = ext.type;
      return quote;
    })()
  `);
  if (!data || (!data.last && !data.close)) throw new Error('Could not retrieve quote. The chart may still be loading.');
  return { success: true, ...data };
}

export async function getDepth() {
  const data = await evaluate(`
    (function() {
      var domPanel = document.querySelector('[class*="depth"]')
        || document.querySelector('[class*="orderBook"]')
        || document.querySelector('[class*="dom-"]')
        || document.querySelector('[class*="DOM"]')
        || document.querySelector('[data-name="dom"]');
      if (!domPanel) return { found: false, error: 'DOM / Depth of Market panel not found.' };
      var bids = [], asks = [];
      var rows = domPanel.querySelectorAll('[class*="row"], tr');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var priceEl = row.querySelector('[class*="price"]');
        var sizeEl = row.querySelector('[class*="size"], [class*="volume"], [class*="qty"]');
        if (!priceEl) continue;
        var price = parseFloat(priceEl.textContent.replace(/[^0-9.\\-]/g, ''));
        var size = sizeEl ? parseFloat(sizeEl.textContent.replace(/[^0-9.\\-]/g, '')) : 0;
        if (isNaN(price)) continue;
        var rowClass = row.className || '';
        var rowHTML = row.innerHTML || '';
        if (/bid|buy/i.test(rowClass) || /bid|buy/i.test(rowHTML)) bids.push({ price, size });
        else if (/ask|sell/i.test(rowClass) || /ask|sell/i.test(rowHTML)) asks.push({ price, size });
        else if (i < rows.length / 2) asks.push({ price, size });
        else bids.push({ price, size });
      }
      if (bids.length === 0 && asks.length === 0) {
        var cells = domPanel.querySelectorAll('[class*="cell"], td');
        var prices = [];
        cells.forEach(function(c) { var val = parseFloat(c.textContent.replace(/[^0-9.\\-]/g, '')); if (!isNaN(val) && val > 0) prices.push(val); });
        if (prices.length > 0) return { found: true, raw_values: prices.slice(0, 50), bids: [], asks: [], note: 'Could not classify bid/ask levels.' };
      }
      bids.sort(function(a, b) { return b.price - a.price; });
      asks.sort(function(a, b) { return a.price - b.price; });
      var spread = null;
      if (asks.length > 0 && bids.length > 0) spread = +(asks[0].price - bids[0].price).toFixed(6);
      return { found: true, bids: bids, asks: asks, spread: spread };
    })()
  `);

  if (!data || !data.found) throw new Error(data?.error || 'DOM panel not found.');
  return { success: true, bid_levels: data.bids?.length || 0, ask_levels: data.asks?.length || 0, spread: data.spread, bids: data.bids || [], asks: data.asks || [], raw_values: data.raw_values, note: data.note };
}

export async function getStudyValues() {
  const data = await evaluate(`
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          var values = {};
          try {
            var dwv = s.dataWindowView();
            if (dwv) {
              var items = dwv.items();
              if (items) {
                for (var i = 0; i < items.length; i++) {
                  var item = items[i];
                  if (item._value && item._value !== '∅' && item._title) values[item._title] = item._value;
                }
              }
            }
          } catch(e) {}
          if (Object.keys(values).length > 0) results.push({ name: name, values: values });
        } catch(e) {}
      }
      return results;
    })()
  `);
  return { success: true, study_count: data?.length || 0, studies: data || [] };
}

export async function getPineLines({ study_filter, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwglines', 'lines', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const hLevels = [];
    const seen = {};
    const allLines = [];
    for (const item of s.items) {
      const v = item.raw;
      const y1 = v.y1 != null ? Math.round(v.y1 * 100) / 100 : null;
      const y2 = v.y2 != null ? Math.round(v.y2 * 100) / 100 : null;
      if (verbose) allLines.push({ id: item.id, y1, y2, x1: v.x1, x2: v.x2, horizontal: v.y1 === v.y2, style: v.st, width: v.w, color: v.ci });
      if (y1 != null && v.y1 === v.y2 && !seen[y1]) { hLevels.push(y1); seen[y1] = true; }
    }
    hLevels.sort((a, b) => b - a);
    const result = { name: s.name, total_lines: s.count, horizontal_levels: hLevels };
    if (verbose) result.all_lines = allLines;
    return result;
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineLabels({ study_filter, max_labels, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwglabels', 'labels', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const limit = max_labels || 50;
  const studies = raw.map(s => {
    let labels = s.items.map(item => {
      const v = item.raw;
      const text = v.t || '';
      const price = v.y != null ? Math.round(v.y * 100) / 100 : null;
      if (verbose) return { id: item.id, text, price, x: v.x, yloc: v.yl, size: v.sz, textColor: v.tci, color: v.ci };
      return { text, price };
    }).filter(l => l.text || l.price != null);
    if (labels.length > limit) labels = labels.slice(-limit);
    return { name: s.name, total_labels: s.count, showing: labels.length, labels };
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineTables({ study_filter } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgtablecells', 'tableCells', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const tables = {};
    for (const item of s.items) {
      const v = item.raw;
      const tid = v.tid || 0;
      if (!tables[tid]) tables[tid] = {};
      if (!tables[tid][v.row]) tables[tid][v.row] = {};
      tables[tid][v.row][v.col] = v.t || '';
    }
    const tableList = Object.entries(tables).map(([tid, rows]) => {
      const rowNums = Object.keys(rows).map(Number).sort((a, b) => a - b);
      const formatted = rowNums.map(rn => {
        const cols = rows[rn];
        const colNums = Object.keys(cols).map(Number).sort((a, b) => a - b);
        return colNums.map(cn => cols[cn]).filter(Boolean).join(' | ');
      }).filter(Boolean);
      return { rows: formatted };
    });
    return { name: s.name, tables: tableList };
  });
  return { success: true, study_count: studies.length, studies };
}

export async function getPineBoxes({ study_filter, verbose } = {}) {
  const filter = study_filter || '';
  const raw = await evaluate(buildGraphicsJS('dwgboxes', 'boxes', filter));
  if (!raw || raw.length === 0) return { success: true, study_count: 0, studies: [] };

  const studies = raw.map(s => {
    const zones = [];
    const seen = {};
    const allBoxes = [];
    for (const item of s.items) {
      const v = item.raw;
      const high = v.y1 != null && v.y2 != null ? Math.round(Math.max(v.y1, v.y2) * 100) / 100 : null;
      const low = v.y1 != null && v.y2 != null ? Math.round(Math.min(v.y1, v.y2) * 100) / 100 : null;
      if (verbose) allBoxes.push({ id: item.id, high, low, x1: v.x1, x2: v.x2, borderColor: v.c, bgColor: v.bc });
      if (high != null && low != null) { const key = high + ':' + low; if (!seen[key]) { zones.push({ high, low }); seen[key] = true; } }
    }
    zones.sort((a, b) => b.high - a.high);
    const result = { name: s.name, total_boxes: s.count, zones };
    if (verbose) result.all_boxes = allBoxes;
    return result;
  });
  return { success: true, study_count: studies.length, studies };
}
