import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import St from 'gi://St'
import { isNullOrEmpty, removeCache, roundOrDefault, getStockColorStyleClass, toLocalDateFormat } from '../../../helpers/data.js'

import { SettingsHandler, STOCKS_PORTFOLIOS, STOCKS_SELECTED_PORTFOLIO, STOCKS_SYMBOL_PAIRS, STOCKS_USE_PROVIDER_INSTRUMENT_NAMES } from '../../../helpers/settings.js'

import { Translations } from '../../../helpers/translations.js'

import * as FinanceService from '../../../services/financeService.js'
import * as TransactionService from '../../../services/transactionService.js'
import { FINANCE_PROVIDER } from '../../../services/meta/generic.js'
import { ButtonGroup } from '../../buttons/buttonGroup.js'
import { StockCard } from '../../cards/stockCard.js'
import { FlatList } from '../../flatList/flatList.js'
import { SearchBar } from '../../searchBar/searchBar.js'

const SETTING_KEYS_TO_REFRESH = [
  STOCKS_SYMBOL_PAIRS,
  STOCKS_SELECTED_PORTFOLIO,
  STOCKS_PORTFOLIOS,
  STOCKS_USE_PROVIDER_INSTRUMENT_NAMES
]

export const StockOverviewScreen = GObject.registerClass({
  GTypeName: 'StockExtension_StockOverviewScreen'
}, class StockOverviewScreen extends St.BoxLayout {
  _init (mainEventHandler) {
    super._init({
      style_class: 'screen stock-overview-screen',
      vertical: true
    })

    this._mainEventHandler = mainEventHandler

    this._isRendering = false
    this._showLoadingInfoTimeoutId = null
    this._autoRefreshTimeoutId = null

    this._settings = new SettingsHandler()

    this._searchBar = new SearchBar({ mainEventHandler: this._mainEventHandler })
    this._portfolioGroup = new ButtonGroup({ buttons: [], y_expand: false })
    this._portfolioSummary = new St.BoxLayout({ style_class: 'portfolio-summary', vertical: false, x_expand: true })
    this._list = new FlatList({ id: 'stock_overview', persistScrollPosition: false })
    this._lastUpdate = new St.Label({ style_class: 'last-update small-text', text: '', x_align: Clutter.ActorAlign.CENTER })

    this.add_child(this._searchBar)
    this.add_child(this._portfolioGroup)
    this.add_child(this._portfolioSummary)
    this.add_child(this._list)
    this.add_child(this._lastUpdate)

    this.connect('destroy', this._onDestroy.bind(this))

    this._searchBar.connect('refresh', () => {
      removeCache('summary_')
      this._loadData().catch(e => log(e))
      this._createPortfolioButtonGroup()
    })

    this._searchBar.connect('text-change', (sender, searchText) => this._filter_results(searchText))

    this._settingsChangedId = this._settings.connect('changed', (value, key) => {
      if (SETTING_KEYS_TO_REFRESH.includes(key)) {
        this._loadData().catch(e => log(e))
        this._createPortfolioButtonGroup()
      }
    })

    this._list.connect('clicked-item', (sender, item) => this._mainEventHandler.emit('show-screen', {
      screen: 'stock-details',
      additionalData: {
        portfolioId: this._settings.selected_portfolio,
        item: item.cardItem
      }
    }))

    this._createPortfolioButtonGroup()

    this._loadData().catch(e => log(e))

    this._registerTimeout()
  }

  _filter_results (searchText) {
    const listItems = this._list.items

    listItems.forEach(item => {
      const data = item.cardItem

      if (!searchText) {
        item.visible = true
        return
      }

      const searchContent = `${data.FullName} ${data.ExchangeName} ${data.Symbol}`.toUpperCase()

      item.visible = searchContent.includes(searchText.toUpperCase())
    })
  }

  async _createPortfolioButtonGroup () {
    const portfolios = this._settings.portfolios

    if (!portfolios.find(item => item.id == this._settings.selected_portfolio)) {
      this._settings.selected_portfolio = this._settings.portfolios[0].id
    }

    let buttons = []

    if (portfolios && portfolios.length > 1) {
      buttons = portfolios.map(item => ({
        label: item.name,
        value: item.id,
        selected: this._settings.selected_portfolio == item.id
      }))
    }

    const newButtonGroup = new ButtonGroup({ buttons, y_expand: false })
    newButtonGroup.connect('clicked', (_, stButton) => {
      this._settings.selected_portfolio = stButton.buttonData.value
    })

    this.replace_child(this._portfolioGroup, newButtonGroup)

    this._portfolioGroup = newButtonGroup
  }

  _registerTimeout () {
    this._autoRefreshTimeoutId = setInterval(() => {
      this._loadData()
    }, (this._settings.ticker_interval || 10) * 1000)
  }

  async _loadData () {
    if (this._showLoadingInfoTimeoutId || this._isRendering) {
      return
    }

    const portfolios = this._settings.portfolios
    const selectedOrFirstPortfolio = portfolios.find(item => item.id == this._settings.selected_portfolio) || portfolios[0]

    const symbols = selectedOrFirstPortfolio.symbols

    if (isNullOrEmpty(symbols)) {
      this._list.show_error_info(Translations.NO_SYMBOLS_CONFIGURED_ERROR)
      return
    }

    this._isRendering = true

    this._showLoadingInfoTimeoutId = setTimeout(() => this._list.show_loading_info(), 500)

    const [yahooQuoteSummaries, otherQuoteSummaries] = await Promise.all([
      FinanceService.getQuoteSummaryList({
        symbolsWithFallbackName: symbols.filter(item => item.provider === FINANCE_PROVIDER.YAHOO).map(symbolData => ({ ...symbolData, fallbackName: symbolData.name })),
        provider: FINANCE_PROVIDER.YAHOO
      }),

      symbols.filter(item => item.provider !== FINANCE_PROVIDER.YAHOO).map(symbolData => FinanceService.getQuoteSummary({
        ...symbolData,
        fallbackName: symbolData.name
      }))
    ])

    this._showLoadingInfoTimeoutId = clearTimeout(this._showLoadingInfoTimeoutId)

    this._list.clear_list_items()

    const wildMixOfQuoteSummaries = [...yahooQuoteSummaries, ...otherQuoteSummaries]

    let portfolioTodayTotal = 0
    let portfolioTotal = 0
    let portfolioTotalValue = 0
    let portfolioUnrealizedCost = 0

    symbols.forEach(symbolData => {
      const { symbol, provider } = symbolData

      const quoteSummary = wildMixOfQuoteSummaries?.find(item => item.Symbol === symbol && item.Provider === provider)

      if (!quoteSummary) {
        return
      }

      const transactionResult = TransactionService.loadCalculatedTransactionsForSymbol({
        portfolioId: this._settings.selected_portfolio,
        quoteSummary
      })

      if (transactionResult && transactionResult.today != null) {
        portfolioTodayTotal += transactionResult.today
      }

      if (transactionResult && transactionResult.total != null) {
        portfolioTotal += transactionResult.total
      }

      if (transactionResult && transactionResult.value != null) {
        portfolioTotalValue += transactionResult.value
      }

      if (transactionResult && transactionResult.unrealizedCost != null) {
        portfolioUnrealizedCost += transactionResult.unrealizedCost
      }

      this._list.addItem(new StockCard(quoteSummary, this._settings.selected_portfolio))
    })

    const portfolioTodayPercent = portfolioTotalValue > 0 ? (portfolioTodayTotal / (portfolioTotalValue - portfolioTodayTotal)) * 100 : 0
    const portfolioTotalPercent = portfolioUnrealizedCost > 0 ? (portfolioTotal / portfolioUnrealizedCost) * 100 : 0

    this._updatePortfolioSummary(portfolioTodayTotal, portfolioTotal, portfolioTodayPercent, portfolioTotalPercent)
    this._updateLastUpdateTime()

    this._filter_results(this._searchBar.search_text())

    // const savedScrollPosition = await cacheOrDefault('scroll_stock_overview', () => this._list.vscroll.adjustment.value, 365 * 24 * 60 * 60 * 1000)
    //
    // setTimeout(() => {
    //   if (this._list.vscroll.adjustment.value !== savedScrollPosition) {
    //     // could not figure out which event might be appropriate to set the position properly, so we work with this
    //     this._list.vscroll.adjustment.value = savedScrollPosition
    //   }
    // }, 50)

    this._isRendering = false
  }

  _updatePortfolioSummary (todayTotal, total, todayPercent, totalPercent) {
    this._portfolioSummary.destroy_all_children()

    if (todayTotal === 0 && total === 0) {
      return
    }

    const summaryBox = new St.BoxLayout({
      style_class: 'portfolio-summary-box',
      x_expand: false,
      y_expand: false
    })

    const todayLabel = new St.Label({
      style_class: 'portfolio-summary-label small-text fwb',
      text: `${Translations.MISC.TODAY}: `
    })

    const todayColorClass = getStockColorStyleClass(todayTotal)
    const todayValue = new St.Label({
      style_class: `portfolio-summary-value small-text fwb ${todayColorClass}`,
      text: `${roundOrDefault(todayTotal)} $`
    })

    const todayPercentValue = new St.Label({
      style_class: `portfolio-summary-value small-text fwb ${todayColorClass} percentage`,
      text: `(${roundOrDefault(todayPercent)} %)`
    })

    summaryBox.add_child(todayLabel)
    summaryBox.add_child(todayValue)
    summaryBox.add_child(todayPercentValue)

    const spacer = new St.Label({ text: '    ', style_class: 'small-text' })
    summaryBox.add_child(spacer)

    const totalLabel = new St.Label({
      style_class: 'portfolio-summary-label small-text fwb',
      text: `${Translations.MISC.TOTAL}: `
    })

    const totalColorClass = getStockColorStyleClass(total)
    const totalValue = new St.Label({
      style_class: `portfolio-summary-value small-text fwb ${totalColorClass}`,
      text: `${roundOrDefault(total)} $`
    })

    const totalPercentValue = new St.Label({
      style_class: `portfolio-summary-value small-text fwb ${totalColorClass} percentage`,
      text: `(${roundOrDefault(totalPercent)} %)`
    })

    summaryBox.add_child(totalLabel)
    summaryBox.add_child(totalValue)
    summaryBox.add_child(totalPercentValue)

    this._portfolioSummary.add_child(summaryBox)
  }

  _updateLastUpdateTime () {
    const now = new Date()
    this._lastUpdate.text = `${Translations.STOCKS.LAST_UPDATE || 'Last update'}: ${toLocalDateFormat(now, Translations.FORMATS.DEFAULT_DATE_TIME)}`
  }

  _onDestroy () {
    if (this._showLoadingInfoTimeoutId) {
      clearTimeout(this._showLoadingInfoTimeoutId)
    }

    if (this._autoRefreshTimeoutId) {
      clearInterval(this._autoRefreshTimeoutId)
    }

    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId)
    }
  }
})
