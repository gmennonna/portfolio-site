// Netlify Function: netlify/functions/prices.js
// Stooq per ticker funzionanti, Boerse Frankfurt per gli altri (via ISIN)

const TICKERS = {
  VUAA:     { name: "Vanguard S&P 500 UCITS ETF Acc",                    category: "US Equity",        avgBuy: 102.56, stooq: "vuaa.uk",  isin: "IE00BFMXXD54" },
  XLYP6:   { name: "Amundi Core STOXX Europe 600 UCITS ETF Acc",         category: "Europe Equity",    avgBuy: 259.25, stooq: null,       isin: "LU0908500753"  },
  EIMI:    { name: "iShares Core MSCI EM IMI UCITS ETF Acc",             category: "Emerging Markets", avgBuy: 34.295, stooq: "eimi.uk",  isin: "IE00BKM4GZ66"  },
  EM710:   { name: "Amundi Euro Gov Bond 7-10Y UCITS ETF Acc",           category: "Euro Bonds",       avgBuy: 166.68, stooq: null,       isin: "LU1287023185"  },
  "X.IUSN":{ name: "iShares MSCI World Small Cap UCITS ETF",             category: "Global Small Cap", avgBuy: 7.509,  stooq: "iusn.de",  isin: "IE00BF4RFH31"  },
  XMJP:    { name: "Xtrackers MSCI Japan UCITS ETF 1C",                  category: "Japan Equity",     avgBuy: 79.45,  stooq: null,       isin: "LU0274209740"  },
  XEON:    { name: "Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C",  category: "Money Market",     avgBuy: 146.25, stooq: "xeon.de",  isin: "LU0290358497"  },
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

async function fetchBoerseFrankfurt(isin) {
  // Boerse Frankfurt public API - returns EUR prices for XETRA-listed ETFs
  const url = `https://api.boerse-frankfurt.de/v1/data/price_information?isin=${isin}&mic=XETR`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
      "Origin": "https://www.boerse-frankfurt.de",
      "Referer": "https://www.boerse-frankfurt.de/",
    }
  });
  if (!res.ok) return null;
  const data = await res.json();
  // Response has: lastPrice, previousPrice, changePercent
  const price = data?.lastPrice;
  const prevPrice = data?.previousPrice;
  if (!price || isNaN(price) || price <= 0) return null;
  const dayChange = prevPrice > 0 ? parseFloat(((price - prevPrice) / prevPrice * 100).toFixed(2)) : 0;
  return { price: parseFloat(price.toFixed(4)), dayChange };
}

function sanityCheck(price, avgBuy) {
  const ratio = price / avgBuy;
  return ratio >= 0.4 && ratio <= 2.5;
}

async function fetchTicker(ticker, info) {
  // 1. Try Stooq
  if (info.stooq) {
    try {
      const data = await fetchStooq(info.stooq);
      if (data && sanityCheck(data.price, info.avgBuy)) {
        console.log(`${ticker} via Stooq: ${data.price}`);
        return data;
      }
    } catch(e) { console.log(`${ticker} Stooq error: ${e.message}`); }
  }

  // 2. Try Boerse Frankfurt (XETRA, EUR prices)
  try {
    const data = await fetchBoerseFrankfurt(info.isin);
    if (data && sanityCheck(data.price, info.avgBuy)) {
      console.log(`${ticker} via Boerse Frankfurt: ${data.price}`);
      return data;
    }
    if (data) console.log(`${ticker} BF price ${data.price} failed sanity (avgBuy ${info.avgBuy})`);
  } catch(e) { console.log(`${ticker} Boerse Frankfurt error: ${e.message}`); }

  console.log(`${ticker}: no price found`);
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
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ prices, fetched, total: Object.keys(TICKERS).length, timestamp: Date.now() })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
