import Gio from 'gi://Gio'
import { SettingsHandler } from '../helpers/settings.js'
import * as TransactionService from './transactionService.js'
import { FINANCE_PROVIDER, TRANSACTION_TYPES } from './meta/generic.js'
import { parseCSV, parseDateYYYYMMDD, validateCSVRow, hasTransactionData } from '../helpers/csvParser.js'

/**
 * Process CSV data to extract unique symbols and group transactions
 * @param {Object[]} rows - Parsed CSV rows
 * @returns {Object} { symbols: [], transactionsBySymbol: {}, errors: [] }
 */
const processCSVData = (rows) => {
  const symbolsMap = new Map()
  const transactionsBySymbol = {}
  const errors = []

  rows.forEach((row, index) => {
    const validation = validateCSVRow(row)

    if (!validation.valid) {
      errors.push(`Row ${index + 2}: ${validation.errors.join(', ')}`)
      return
    }

    const symbol = row.Symbol.trim()

    if (!symbolsMap.has(symbol)) {
      symbolsMap.set(symbol, {
        id: Gio.dbus_generate_guid(),
        name: symbol,
        symbol: symbol,
        provider: FINANCE_PROVIDER.YAHOO,
        showInTicker: true
      })
    }

    if (hasTransactionData(row)) {
      if (!transactionsBySymbol[symbol]) {
        transactionsBySymbol[symbol] = []
      }

      transactionsBySymbol[symbol].push({
        type: TRANSACTION_TYPES.BUY,
        amount: parseFloat(row['Quantity']),
        price: parseFloat(row['Purchase Price']),
        date: parseDateYYYYMMDD(row['Trade Date'])
      })
    }
  })

  return {
    symbols: Array.from(symbolsMap.values()),
    transactionsBySymbol,
    errors
  }
}

/**
 * Create portfolio with symbols
 * @param {string} name - Portfolio name
 * @param {Object[]} symbols - Array of symbol objects
 * @returns {Object} Created portfolio object with ID
 */
const createPortfolioFromData = (name, symbols) => {
  const settings = new SettingsHandler()
  const portfolios = settings.portfolios

  const newPortfolio = {
    id: Gio.dbus_generate_guid(),
    name: name,
    symbols: symbols
  }

  portfolios.push(newPortfolio)
  settings.portfolios = portfolios

  return newPortfolio
}

/**
 * Import transactions for all symbols
 * @param {string} portfolioId - Portfolio UUID
 * @param {Object} transactionsBySymbol - Map of symbol -> transactions[]
 * @returns {Object} { imported: number, skipped: number, errors: [] }
 */
const importTransactions = (portfolioId, transactionsBySymbol) => {
  let imported = 0
  let skipped = 0
  const errors = []

  Object.entries(transactionsBySymbol).forEach(([symbol, transactions]) => {
    transactions.forEach(transaction => {
      try {
        const error = TransactionService.validate(transaction)

        if (error) {
          errors.push(`${symbol}: ${error}`)
          skipped++
        } else {
          TransactionService.save({
            portfolioId,
            symbol,
            transaction
          })
          imported++
        }
      } catch (e) {
        errors.push(`${symbol}: ${e.message}`)
        skipped++
      }
    })
  })

  return { imported, skipped, errors }
}

/**
 * Main import function - orchestrates CSV import
 * @param {string} csvText - Full CSV file content
 * @param {string} portfolioName - Name for the new portfolio
 * @returns {Object} { success: boolean, portfolio: object, stats: object, errors: [] }
 */
export const importFromCSV = (csvText, portfolioName) => {
  const result = {
    success: false,
    portfolio: null,
    stats: {
      symbols: 0,
      transactions: 0,
      skipped: 0
    },
    errors: []
  }

  try {
    let rows
    try {
      rows = parseCSV(csvText)
    } catch (e) {
      result.errors.push(`CSV parse error: ${e.message}`)
      return result
    }

    const { symbols, transactionsBySymbol, errors: processingErrors } = processCSVData(rows)

    result.errors.push(...processingErrors)

    if (symbols.length === 0) {
      result.errors.push('No valid symbols found in CSV')
      return result
    }

    try {
      result.portfolio = createPortfolioFromData(portfolioName, symbols)
      result.stats.symbols = symbols.length
    } catch (e) {
      result.errors.push(`Portfolio creation failed: ${e.message}`)
      return result
    }

    const transactionResult = importTransactions(result.portfolio.id, transactionsBySymbol)
    result.stats.transactions = transactionResult.imported
    result.stats.skipped = transactionResult.skipped
    result.errors.push(...transactionResult.errors)

    result.success = true

  } catch (e) {
    result.errors.push(`Import failed: ${e.message}`)
  }

  return result
}
