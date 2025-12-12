#!/usr/bin/env python3
import sys
import json
from curl_cffi import requests
from datetime import datetime

def get_quote(symbol):
    try:
        session = requests.Session(impersonate="chrome")

        url = f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"

        params = {
            "period1": int((datetime.now().timestamp()) - (2 * 24 * 60 * 60)),
            "period2": int(datetime.now().timestamp()),
            "interval": "1d",
            "includePrePost": "true",
            "events": "div,split"
        }

        response = session.get(url, params=params, timeout=10)
        response.raise_for_status()

        data = response.json()

        chart = data.get("chart", {})
        if chart.get("error"):
            return {"error": chart["error"].get("description", "Unknown error")}

        result_data = chart.get("result", [])
        if not result_data:
            return {"error": "No data available"}

        quote_data = result_data[0]
        meta = quote_data.get("meta", {})
        indicators = quote_data.get("indicators", {}).get("quote", [{}])[0]

        closes = indicators.get("close", [])
        if not closes:
            return {"error": "No price data available"}

        price = float(meta.get("regularMarketPrice", closes[-1]))
        prev_close = float(meta.get("previousClose", meta.get("chartPreviousClose", price)))

        result = {
            "symbol": symbol,
            "name": meta.get("longName", meta.get("shortName", symbol)),
            "price": price,
            "previousClose": prev_close,
            "open": float(indicators.get("open", [price])[-1] if indicators.get("open") else price),
            "high": float(indicators.get("high", [price])[-1] if indicators.get("high") else price),
            "low": float(indicators.get("low", [price])[-1] if indicators.get("low") else price),
            "volume": int(indicators.get("volume", [0])[-1] if indicators.get("volume") else 0),
            "change": price - prev_close,
            "changePercent": ((price - prev_close) / prev_close) * 100 if prev_close else 0,
            "currency": meta.get("currency", "USD"),
            "exchange": meta.get("exchangeName", ""),
            "marketState": meta.get("marketState", "REGULAR"),
            "timestamp": meta.get("regularMarketTime", int(datetime.now().timestamp()))
        }

        if "preMarketPrice" in meta:
            result["preMarketPrice"] = float(meta["preMarketPrice"])
            result["preMarketChange"] = float(meta.get("preMarketChange", 0))
            result["preMarketChangePercent"] = float(meta.get("preMarketChangePercent", 0))

        if "postMarketPrice" in meta:
            result["postMarketPrice"] = float(meta["postMarketPrice"])
            result["postMarketChange"] = float(meta.get("postMarketChange", 0))
            result["postMarketChangePercent"] = float(meta.get("postMarketChangePercent", 0))

        return result

    except requests.HTTPError as e:
        return {"error": f"HTTP {e.response.status_code}: {e.response.text[:100]}"}
    except Exception as e:
        return {"error": str(e)}

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No symbol provided"}))
        sys.exit(1)

    symbol = sys.argv[1]
    result = get_quote(symbol)
    print(json.dumps(result))

if __name__ == "__main__":
    main()
