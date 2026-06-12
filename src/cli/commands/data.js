import { register } from '../router.js';
import * as core from '../../core/data.js';

const strategySelectorOptions = {
  'entity-id': { type: 'string', description: 'Strategy entity ID from state/list-strategies' },
  name: { type: 'string', description: 'Strategy name substring' },
  latest: { type: 'boolean', description: 'Use the latest strategy source on chart' },
  active: { type: 'boolean', description: 'Use the active Strategy Tester strategy' },
};

function strategySelector(opts) {
  return {
    entity_id: opts['entity-id'],
    strategy_name: opts.name,
    latest: opts.latest,
    active: opts.active,
  };
}

register('quote', {
  description: 'Get real-time price quote',
  handler: (opts, positionals) => core.getQuote({ symbol: positionals[0] }),
});

register('ohlcv', {
  description: 'Get OHLCV bar data',
  options: {
    count: { type: 'string', short: 'n', description: 'Number of bars (default 100, max 500)' },
    summary: { type: 'boolean', short: 's', description: 'Return summary stats instead of all bars' },
  },
  handler: (opts) => core.getOhlcv({
    count: opts.count ? Number(opts.count) : undefined,
    summary: opts.summary,
  }),
});

register('values', {
  description: 'Get current indicator values from data window',
  handler: () => core.getStudyValues(),
});

register('data', {
  description: 'Advanced data tools (lines, labels, tables, boxes, strategy, trades, equity, depth)',
  subcommands: new Map([
    ['lines', {
      description: 'Get Pine Script line.new() price levels',
      options: {
        filter: { type: 'string', short: 'f', description: 'Filter by study name substring' },
        verbose: { type: 'boolean', short: 'v', description: 'Include raw line data' },
      },
      handler: (opts) => core.getPineLines({ study_filter: opts.filter, verbose: opts.verbose }),
    }],
    ['labels', {
      description: 'Get Pine Script label.new() annotations',
      options: {
        filter: { type: 'string', short: 'f', description: 'Filter by study name substring' },
        max: { type: 'string', short: 'n', description: 'Max labels per study (default 50)' },
        verbose: { type: 'boolean', short: 'v', description: 'Include raw label data' },
      },
      handler: (opts) => core.getPineLabels({ study_filter: opts.filter, max_labels: opts.max ? Number(opts.max) : undefined, verbose: opts.verbose }),
    }],
    ['tables', {
      description: 'Get Pine Script table.new() data',
      options: {
        filter: { type: 'string', short: 'f', description: 'Filter by study name substring' },
      },
      handler: (opts) => core.getPineTables({ study_filter: opts.filter }),
    }],
    ['boxes', {
      description: 'Get Pine Script box.new() price zones',
      options: {
        filter: { type: 'string', short: 'f', description: 'Filter by study name substring' },
        verbose: { type: 'boolean', short: 'v', description: 'Include raw box data' },
      },
      handler: (opts) => core.getPineBoxes({ study_filter: opts.filter, verbose: opts.verbose }),
    }],
    ['strategy', {
      description: 'Get strategy performance metrics',
      options: strategySelectorOptions,
      handler: (opts) => core.getStrategyResults(strategySelector(opts)),
    }],
    ['list-strategies', {
      description: 'List strategy studies on the chart',
      handler: () => core.listStrategies(),
    }],
    ['trades', {
      description: 'Get strategy trade list',
      options: {
        ...strategySelectorOptions,
        max: { type: 'string', short: 'n', description: 'Max trades to return' },
      },
      handler: (opts) => core.getTrades({ ...strategySelector(opts), max_trades: opts.max ? Number(opts.max) : undefined }),
    }],
    ['equity', {
      description: 'Get strategy equity curve',
      options: strategySelectorOptions,
      handler: (opts) => core.getEquity(strategySelector(opts)),
    }],
    ['export-trades', {
      description: 'Download Strategy Tester trade list CSV',
      options: {
        ...strategySelectorOptions,
        'downloads-dir': { type: 'string', description: 'Downloads directory to watch' },
        timeout: { type: 'string', description: 'Download timeout in milliseconds' },
      },
      handler: (opts) => core.exportTrades({
        ...strategySelector(opts),
        downloads_dir: opts['downloads-dir'],
        timeout_ms: opts.timeout ? Number(opts.timeout) : undefined,
      }),
    }],
    ['depth', {
      description: 'Get order book / DOM data',
      handler: () => core.getDepth(),
    }],
    ['indicator', {
      description: 'Get indicator info and inputs by entity ID',
      handler: (opts, positionals) => {
        if (!positionals[0]) throw new Error('Entity ID required. Usage: tv data indicator eFu1Ot');
        return core.getIndicator({ entity_id: positionals[0] });
      },
    }],
  ]),
});
