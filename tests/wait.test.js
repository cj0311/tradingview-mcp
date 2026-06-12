import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSymbol, symbolsMatch } from '../src/wait.js';

describe('wait helpers', () => {
  it('normalizes exchange-prefixed symbols', () => {
    assert.equal(normalizeSymbol('BINANCE:BTCUSDT.P'), 'BTCUSDT.P');
    assert.equal(normalizeSymbol(' krx_dly:000210 '), '000210');
  });

  it('matches header symbols without exchange prefixes', () => {
    assert.equal(symbolsMatch('BTCUSDT.P', 'BINANCE:BTCUSDT.P'), true);
    assert.equal(symbolsMatch('BINANCE:BTCUSDT.P', 'BTCUSDT.P'), true);
    assert.equal(symbolsMatch('KRX_DLY:000210', '000210'), true);
    assert.equal(symbolsMatch('AAPL', 'BINANCE:BTCUSDT.P'), false);
  });
});
