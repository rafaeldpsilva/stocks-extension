import GLib from 'gi://GLib'
import Gio from 'gi://Gio'
import { QuoteSummary } from './dto/quoteSummary.js'
import { FINANCE_PROVIDER } from './meta/generic.js'

const BRIDGE_SCRIPT = GLib.get_home_dir() + '/.local/share/gnome-shell/extensions/stocks@infinicode.de/yahoo-bridge.py'

const executePythonBridge = async (symbol) => {
  return new Promise((resolve, reject) => {
    try {
      const proc = Gio.Subprocess.new(
        ['python3', BRIDGE_SCRIPT, symbol],
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
      )

      proc.communicate_utf8_async(null, null, (proc, res) => {
        try {
          const [, stdout, stderr] = proc.communicate_utf8_finish(res)

          if (proc.get_successful()) {
            try {
              const data = JSON.parse(stdout)
              resolve(data)
            } catch (parseError) {
              reject(new Error(`Failed to parse JSON: ${parseError.message}`))
            }
          } else {
            reject(new Error(`Python script failed: ${stderr}`))
          }
        } catch (error) {
          reject(error)
        }
      })
    } catch (error) {
      reject(error)
    }
  })
}

const createQuoteSummaryFromPythonData = (symbol, data) => {
  const newObject = new QuoteSummary(symbol, FINANCE_PROVIDER.YAHOO)

  if (data.error) {
    newObject.Error = data.error
    return newObject
  }

  newObject.FullName = data.name || symbol
  newObject.CurrencySymbol = data.currency === 'USD' ? '$' : data.currency
  newObject.ExchangeName = data.exchange
  newObject.Timestamp = data.timestamp * 1000

  newObject.Close = data.price
  newObject.PreviousClose = data.previousClose
  newObject.Open = data.open
  newObject.High = data.high
  newObject.Low = data.low
  newObject.Volume = data.volume

  newObject.Change = data.change
  newObject.ChangePercent = data.changePercent

  newObject.MarketState = data.marketState || 'REGULAR'

  if (data.preMarketPrice) {
    newObject.PreMarketPrice = data.preMarketPrice
    newObject.PreMarketChange = data.preMarketChange
    newObject.PreMarketChangePercent = data.preMarketChangePercent
  }

  if (data.postMarketPrice) {
    newObject.PostMarketPrice = data.postMarketPrice
    newObject.PostMarketChange = data.postMarketChange
    newObject.PostMarketChangePercent = data.postMarketChangePercent
  }

  return newObject
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms))

export const getQuoteSummary = async ({ symbol }) => {
  try {
    const data = await executePythonBridge(symbol)
    return createQuoteSummaryFromPythonData(symbol, data)
  } catch (error) {
    console.error(`[Yahoo Python] Error fetching ${symbol}:`, error)
    return createQuoteSummaryFromPythonData(symbol, { error: error.message })
  }
}

export const getQuoteList = async ({ symbolsWithFallbackName }) => {
  const results = []

  for (const item of symbolsWithFallbackName) {
    try {
      const quote = await getQuoteSummary({ symbol: item.symbol })

      if (item.forceFallbackName && item.fallbackName) {
        quote.FullName = item.fallbackName
      }

      results.push(quote)

      if (symbolsWithFallbackName.indexOf(item) < symbolsWithFallbackName.length - 1) {
        await delay(200)
      }
    } catch (error) {
      console.error(`[Yahoo Python] Error fetching ${item.symbol}:`, error)
      results.push(createQuoteSummaryFromPythonData(item.symbol, { error: error.message }))
    }
  }

  return results
}

export const getHistoricalQuotes = async ({ symbol, range, includeTimestamps }) => {
  console.warn('[Yahoo Python] Historical quotes not implemented yet')
  return null
}

export const getNewsList = async ({ symbol }) => {
  console.warn('[Yahoo Python] News not implemented')
  return null
}
