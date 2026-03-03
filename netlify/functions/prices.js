// Netlify Function: netlify/functions/prices.js
// Stooq per i ticker che funzionano, Yahoo Finance per gli altri

const TICKERS = {
  VUAA:     { name: "Vanguard S&P 500 UCITS ETF Acc",                    category: "US Equity",        avgBuy: 102.56, stooq: "vuaa.uk",  yahoo: "VUAA.DE",  },
  XLYP6:   { name: "Amundi Core STOXX Europe 600 UCITS ETF Acc",         category: "Europe Equity",    avgBuy: 259.25, stooq: null,       yahoo: "XLYP6.DE", },
  EIMI:    { name: "iShares Core MSCI EM IMI UCITS ETF Acc",             category: "Emerging Markets", avgBuy: 34.295, stooq: "eimi.uk",  yahoo: "EIMI.DE",  },
  EM710:   { name: "Amundi Euro Gov Bond 7-10Y UCITS ETF Acc",           category: "Euro Bonds",       avgBuy: 166.68, stooq: null,       yahoo: "EM710.PA", },
  "X.IUSN":{ name: "iShares MSCI World Small Cap UCITS ETF",             category: "Global Small Cap", avgBuy: 7.509,  stooq: "iusn.de",  yahoo: "IUSN.DE",  },
  XMJP:    { name: "Xtrackers MSCI Japan UCITS ETF 1C",                  category: "Japan Equity",     avgBuy: 79.45,  stooq: null,       yahoo: "XMJP.DE",  },
  XEON:    { name: "Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C",  category: "Money Market",     avgBuy: 146.25, stooq: "xeon.de",  yahoo: "XEON.DE",  },
};

async function fetchStooq(symbol) {
  const url = `https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcvn&h&e=csv`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return null;
  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) return null;
  const cols = lines[1].split(",");
  const close = parseFloat(cols[6]);
  const open  = parseFloat(cols[3]);
  if (!close || isNaN(close) || close <= 0) return null;
  const dayChange = open > 0 ? parseFloat(((close - open) / open * 100).toFixed(2)) : 0;
  return { price: close, dayChange };
}

async function fetchYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose || meta.previousClose;
  if (!price || isNaN(price) || price <= 0) return null;
  const dayChange = prevClose > 0 ? parseFloat(((price - prevClose) / prevClose * 100).toFixed(2)) : 0;
  return { price: parseFloat(price.toFixed(4)), dayChange };
}

function sanityCheck(price, avgBuy) {
  const ratio = price / avgBuy;
  return ratio >= 0.4 && ratio <= 2.5;
}

async function fetchTicker(ticker, info) {
  if (info.stooq) {
    try {
      const data = await fetchStooq(info.stooq);
      if (data && sanityCheck(data.price, info.avgBuy)) {
        console.log(`${ticker} via Stooq(${info.stooq}): ${data.price}`);
        return data;
      }
    } catch(e) { console.log(`${ticker} Stooq error: ${e.message}`); }
  }
  try {
    const data = await fetchYahoo(info.yahoo);
    if (data && sanityCheck(data.price, info.avgBuy)) {
      console.log(`${ticker} via Yahoo(${info.yahoo}): ${data.price}`);
      return data;
    }
    if (data) console.log(`${ticker} Yahoo price ${data.price} failed sanity check (avgBuy ${info.avgBuy})`);
  } catch(e) { console.log(`${ticker} Yahoo error: ${e.message}`); }
  return null;
}

export const handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const results = await Promise.all(
      Object.entries(TICKERS).map(async ([ticker, info]) => {
        const data = await fetchTicker(ticker, info);
        return [ticker, data ? { ...data, name: info.name, category: info.category } : null];
      })
    );
    const prices = {};
    let fetched = 0;
    for (const [ticker, data] of results) {
      if (data) { prices[ticker] = data; fetched++; }
    }
    if (fetched === 0) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Nessun prezzo valido. Mercati chiusi?" }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ prices, fetched, total: Object.keys(TICKERS).length, timestamp: Date.now() }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
