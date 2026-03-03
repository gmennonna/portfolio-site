// Netlify Function: netlify/functions/prices.js
// Fetches ETF prices from Stooq server-side (no CORS issues)
// Called by the frontend at /api/prices

const SYMBOLS = {
  VUAA:    { stooq: "vuaa.uk",  name: "Vanguard S&P 500 UCITS ETF Acc",                   category: "US Equity" },
  XLYP6:  { stooq: "xlyp6.de", name: "Amundi Core STOXX Europe 600 UCITS ETF Acc",        category: "Europe Equity" },
  EIMI:   { stooq: "eimi.uk",  name: "iShares Core MSCI EM IMI UCITS ETF Acc",            category: "Emerging Markets" },
  EM710:  { stooq: "em710.de", name: "Amundi Euro Gov Bond 7-10Y UCITS ETF Acc",          category: "Euro Bonds" },
  "X.IUSN":{ stooq: "iusn.de", name: "iShares MSCI World Small Cap UCITS ETF",            category: "Global Small Cap" },
  XMJP:   { stooq: "xmjp.uk",  name: "Xtrackers MSCI Japan UCITS ETF 1C",                category: "Japan Equity" },
  XEON:   { stooq: "xeon.de",  name: "Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C", category: "Money Market" },
};

async function fetchPrice(ticker, info) {
  const url = `https://stooq.com/q/l/?s=${info.stooq}&f=sd2t2ohlcvn&h&e=csv`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;
    const cols = lines[1].split(",");
    // CSV columns: Symbol, Date, Time, Open, High, Low, Close, Volume, Name
    const close = parseFloat(cols[6]);
    const open  = parseFloat(cols[3]);
    if (!close || isNaN(close)) return null;
    const dayChange = open > 0 ? parseFloat(((close - open) / open * 100).toFixed(2)) : 0;
    return { price: close, dayChange, name: info.name, category: info.category };
  } catch (e) {
    return null;
  }
}

export const handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  try {
    // Fetch all prices in parallel
    const results = await Promise.all(
      Object.entries(SYMBOLS).map(async ([ticker, info]) => {
        const data = await fetchPrice(ticker, info);
        return [ticker, data];
      })
    );

    const prices = {};
    let fetched = 0;
    for (const [ticker, data] of results) {
      if (data) {
        prices[ticker] = data;
        fetched++;
      }
    }

    if (fetched === 0) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: "Nessun prezzo ottenuto da Stooq. Mercati chiusi o simboli errati." }),
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
