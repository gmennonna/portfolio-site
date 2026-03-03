// Netlify Function: netlify/functions/prices.js
// Fetches ETF prices from Stooq server-side (no CORS issues)

// Multiple candidate symbols per ETF - tries them in order until one works
const SYMBOLS = {
  VUAA:     { candidates: ["vuaa.uk", "vuaa.ie"],         name: "Vanguard S&P 500 UCITS ETF Acc",                    category: "US Equity",       avgBuy: 102.56 },
  XLYP6:   { candidates: ["xlyp6.de", "xlyp6.eu"],       name: "Amundi Core STOXX Europe 600 UCITS ETF Acc",        category: "Europe Equity",   avgBuy: 259.25 },
  EIMI:    { candidates: ["eimi.uk", "eimi.ie"],          name: "iShares Core MSCI EM IMI UCITS ETF Acc",            category: "Emerging Markets",avgBuy: 34.295 },
  EM710:   { candidates: ["em710.de", "em710.eu"],        name: "Amundi Euro Gov Bond 7-10Y UCITS ETF Acc",          category: "Euro Bonds",      avgBuy: 166.68 },
  "X.IUSN":{ candidates: ["iusn.de", "iusn.eu"],         name: "iShares MSCI World Small Cap UCITS ETF",            category: "Global Small Cap",avgBuy: 7.509  },
  XMJP:    { candidates: ["xmjp.de", "xmjp.eu", "xmjp.uk"], name: "Xtrackers MSCI Japan UCITS ETF 1C",             category: "Japan Equity",    avgBuy: 79.45  },
  XEON:    { candidates: ["xeon.de", "xeon.eu"],         name: "Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C", category: "Money Market",    avgBuy: 146.25 },
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

async function fetchPrice(ticker, info) {
  for (const symbol of info.candidates) {
    try {
      const data = await fetchStooq(symbol);
      if (!data) continue;

      // Sanity check: price must be within 40%-250% of average buy price
      const ratio = data.price / info.avgBuy;
      if (ratio < 0.4 || ratio > 2.5) {
        console.log(`${ticker}/${symbol}: price ${data.price} ratio ${ratio.toFixed(2)} - skipping (likely wrong currency)`);
        continue;
      }

      console.log(`${ticker}/${symbol}: OK price=${data.price} dayChange=${data.dayChange}%`);
      return { price: data.price, dayChange: data.dayChange, name: info.name, category: info.category };
    } catch(e) {
      console.log(`${ticker}/${symbol}: error ${e.message}`);
    }
  }
  return null;
}

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    const results = await Promise.all(
      Object.entries(SYMBOLS).map(async ([ticker, info]) => {
        const data = await fetchPrice(ticker, info);
        return [ticker, data];
      })
    );

    const prices = {};
    let fetched = 0;
    for (const [ticker, data] of results) {
      if (data) { prices[ticker] = data; fetched++; }
    }

    if (fetched === 0) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "Nessun prezzo valido da Stooq. Mercati chiusi o simboli errati." }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ prices, fetched, total: Object.keys(SYMBOLS).length, timestamp: Date.now() }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
