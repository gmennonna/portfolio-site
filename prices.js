// Netlify Function: netlify/functions/prices.js
// Stooq per ticker funzionanti, JustETF per i 3 mancanti

const TICKERS = {
  VUAA:     { name: "Vanguard S&P 500 UCITS ETF Acc",                    category: "US Equity",        avgBuy: 102.56, stooq: null,       isin: "IE00BFMXXD54" },
  XLYP6:   { name: "Amundi Core STOXX Europe 600 UCITS ETF Acc",         category: "Europe Equity",    avgBuy: 259.25, stooq: null,       isin: "LU0908500753"  },
  EIMI:    { name: "iShares Core MSCI EM IMI UCITS ETF Acc",             category: "Emerging Markets", avgBuy: 34.295, stooq: null,       isin: "IE00BKM4GZ66"  },
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

async function fetchJustETF(isin) {
  // JustETF public quote endpoint
  const url = `https://www.justetf.com/api/etfs/${isin}/quote?locale=it&currency=EUR`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
      "Referer": "https://www.justetf.com/",
    }
  });
  if (!res.ok) { console.log(`JustETF ${isin}: HTTP ${res.status}`); return null; }
  const data = await res.json();
  // JustETF response: { latestQuote: { price, changePercent, ... } }
  const price = data?.latestQuote?.raw;
  const prev = data?.previousQuote?.raw;
  const changePercent = (price && prev && prev > 0) ? ((price - prev) / prev * 100) : (data?.dtdPrc?.raw ?? 0);
  if (!price || isNaN(price) || price <= 0) {
    console.log(`JustETF ${isin}: no price in response`, JSON.stringify(data).slice(0, 200));
    return null;
  }
  return { price: parseFloat(price.toFixed(4)), dayChange: parseFloat((changePercent).toFixed(2)) };
}

function sanityCheck(price, avgBuy) {
  const ratio = price / avgBuy;
  return ratio >= 0.4 && ratio <= 2.5;
}

async function fetchTicker(ticker, info) {
  // 1. JustETF prima — restituisce sempre EUR
  try {
    const data = await fetchJustETF(info.isin);
    if (data && sanityCheck(data.price, info.avgBuy)) {
      console.log(`${ticker} via JustETF: ${data.price}`);
      return data;
    }
    if (data) console.log(`${ticker} JustETF price ${data.price} failed sanity (avgBuy ${info.avgBuy})`);
  } catch(e) { console.log(`${ticker} JustETF error: ${e.message}`); }

  // 2. Stooq come fallback (solo per ticker confermati in EUR: iusn.de, xeon.de)
  if (info.stooq) {
    try {
      const data = await fetchStooq(info.stooq);
      if (data && sanityCheck(data.price, info.avgBuy)) {
        console.log(`${ticker} via Stooq: ${data.price}`);
        return data;
      }
    } catch(e) { console.log(`${ticker} Stooq error: ${e.message}`); }
  }

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
