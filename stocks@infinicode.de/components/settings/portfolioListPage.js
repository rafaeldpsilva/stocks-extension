import Adw from 'gi://Adw'
import GObject from 'gi://GObject'
import Gio from 'gi://Gio'
import Gtk from 'gi://Gtk'
import GLib from 'gi://GLib'

import { Translations } from '../../helpers/translations.js'

import { NewItemModel } from './subcomponents/newItemModel.js'
import { NewPortfolioRow } from './subcomponents/newPortfolioRow.js'
import { ImportPortfolioRow } from './subcomponents/importPortfolioRow.js'
import { PortfolioModelList } from './subcomponents/portfolioModelList.js'
import { PortfolioRow } from './subcomponents/portfolioRow.js'

import { SymbolsListPage } from './symbolsListPage.js'
import { SubPage } from './subcomponents/subPage.js'

import { importFromCSV } from '../../services/importService.js'

export const PortfolioListPage = GObject.registerClass({
      GTypeName: 'StockExtension-PortfolioListPage',
    },
    class PortfoliosListPreferencePage extends Adw.PreferencesPage {
      _init () {
        super._init({
          title: Translations.SETTINGS.TITLE_PORTFOLIOS,
          icon_name: 'view-list-symbolic',
          name: 'PortfolioListPage'
        })

        const preferenceGroup = new PortfolioListPreferenceGroup()
        this.add(preferenceGroup)
      }
    })

class PortfolioListPreferenceGroup extends Adw.PreferencesGroup {
  static {
    GObject.registerClass({ GTypeName: 'StockExtension-PortfolioPreferenceGroup' }, this)

    this.install_action('portfolio.add', null, self => self._portfolioModelList.append())
    this.install_action('portfolio.remove', 's', (self, name, param) => self._portfolioModelList.remove(param.unpack()))
    this.install_action('portfolio.edit', '(ss)', (self, name, param) => {
      const data = param.deepUnpack()

      self._portfolioModelList.edit(...data)
    })
    this.install_action('portfolio.import', null, self => self._showImportDialog())
  }

  constructor () {
    super({
      title: Translations.SETTINGS.TITLE_PORTFOLIOS_LIST,
    })

    this._portfolioModelList = new PortfolioModelList()

    const store = new Gio.ListStore({ item_type: Gio.ListModel })
    const listModel = new Gtk.FlattenListModel({ model: store })
    store.append(this._portfolioModelList)
    store.append(new NewItemModel())

    this._list = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
      css_classes: ['boxed-list'],
    })

    this._list.connect('row-activated', (l, row) => {
      const window = this.get_root()

      const subPage = new SubPage(`${row.item.name || '-'} Symbols`, new SymbolsListPage(row.item))

      window.present_subpage(subPage)
    })

    this.add(this._list)

    this._list.bind_model(listModel, item => {
      return !item.id
          ? new NewPortfolioRow()
          : new PortfolioRow(item, this._portfolioModelList)
    })

    const importList = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.NONE,
      css_classes: ['boxed-list'],
      margin_top: 12
    })
    importList.append(new ImportPortfolioRow())
    this.add(importList)
  }

  _showImportDialog () {
    const window = this.get_root()

    const dialog = new Gtk.FileChooserDialog({
      title: Translations.SETTINGS.IMPORT_DIALOG_TITLE,
      action: Gtk.FileChooserAction.OPEN,
      transient_for: window,
      modal: true
    })

    const csvFilter = new Gtk.FileFilter()
    csvFilter.set_name('CSV Files')
    csvFilter.add_mime_type('text/csv')
    csvFilter.add_pattern('*.csv')
    dialog.add_filter(csvFilter)

    const allFilter = new Gtk.FileFilter()
    allFilter.set_name('All Files')
    allFilter.add_pattern('*')
    dialog.add_filter(allFilter)

    dialog.add_button('Cancel', Gtk.ResponseType.CANCEL)
    dialog.add_button('Import', Gtk.ResponseType.ACCEPT)

    dialog.connect('response', (dialog, response) => {
      if (response === Gtk.ResponseType.ACCEPT) {
        const file = dialog.get_file()
        this._processImport(file)
      }
      dialog.destroy()
    })

    dialog.show()
  }

  async _processImport (file) {
    const window = this.get_root()

    try {
      const [success, contents] = file.load_contents(null)

      if (!success) {
        throw new Error('Failed to read file')
      }

      const decoder = new TextDecoder('utf-8')
      const csvText = decoder.decode(contents)

      const portfolioName = await this._showNameDialog()
      if (!portfolioName) {
        return
      }

      const result = importFromCSV(csvText, portfolioName)

      this._showResultToast(result)

    } catch (error) {
      const errorMsg = Translations.SETTINGS.CSV_FILE_ERROR.format(error.message)
      const toast = new Adw.Toast({ title: errorMsg, timeout: 5 })
      window.add_toast(toast)
    }
  }

  async _showNameDialog () {
    const window = this.get_root()

    return new Promise((resolve) => {
      const dialog = new Adw.AlertDialog({
        heading: Translations.SETTINGS.IMPORT_NAME_DIALOG_TITLE,
        body: Translations.SETTINGS.IMPORT_NAME_DIALOG_MESSAGE
      })

      const entry = new Gtk.Entry({
        text: Translations.SETTINGS.IMPORT_NAME_DIALOG_DEFAULT.format(
          new Date().toISOString().split('T')[0]
        ),
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12
      })

      const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL
      })
      box.append(entry)
      dialog.set_extra_child(box)

      dialog.add_response('cancel', 'Cancel')
      dialog.add_response('ok', 'OK')
      dialog.set_default_response('ok')
      dialog.set_close_response('cancel')

      dialog.connect('response', (dialog, response) => {
        if (response === 'ok') {
          const name = entry.get_text().trim()
          resolve(name || null)
        } else {
          resolve(null)
        }
      })

      dialog.present(window)
    })
  }

  _showResultToast (result) {
    const window = this.get_root()

    if (!result.success) {
      const message = Translations.SETTINGS.IMPORT_ERROR.format(
        result.errors.join(', ')
      )
      const toast = new Adw.Toast({ title: message, timeout: 10 })
      window.add_toast(toast)
      return
    }

    if (result.errors.length > 0) {
      const message = Translations.SETTINGS.IMPORT_PARTIAL_SUCCESS.format(
        result.stats.symbols,
        result.stats.transactions,
        result.errors.length
      )
      const toast = new Adw.Toast({ title: message, timeout: 10 })
      window.add_toast(toast)
    } else {
      const message = Translations.SETTINGS.IMPORT_SUCCESS.format(
        result.stats.symbols,
        result.stats.transactions
      )
      const toast = new Adw.Toast({ title: message, timeout: 5 })
      window.add_toast(toast)
    }
  }
}
