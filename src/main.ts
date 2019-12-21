import App, {Option} from './app/app'
import AudioManager from './util/audio_manager'
import {GlobalPaletWnd, EqualizerWnd} from './app/other_wnd'
import DomUtil from './util/dom_util'
import JsApp from './app/js_powered_app'
import GamepadManager from './util/gamepad_manager'
import {KeyConfigWnd, GamepadWnd} from './app/key_config_wnd'
import StorageUtil from './util/storage_util'
import Util from './util/util'
import WindowManager from './wnd/window_manager'
import './util/polyfill'
import * as JSZip from 'jszip'

import {MenuItemInfo, SubmenuItemInfo} from './wnd/wnd'
const Z_MENUBAR = 1000
const Z_MENU_SUBITEM = Z_MENUBAR + 1

function getOffsetRect(parent: HTMLElement, target: HTMLElement) {
  const prect = parent.getBoundingClientRect()
  const trect = target.getBoundingClientRect()
  return {
    left: trect.left - prect.left,
    top: trect.top - prect.top,
    right: trect.right - prect.left,
    bottom: trect.bottom - prect.top,
  }
}

const DEFAULT_MASTER_VOLUME = 0.25

// Request Animation Frame
window.requestAnimationFrame = (function() {
  return (window.requestAnimationFrame || window.mozRequestAnimationFrame ||
          window.webkitRequestAnimationFrame || window.msRequestAnimationFrame)
})()

const KEY_VOLUME = 'volume'

class Main {
  private wndMgr: WindowManager
  private apps: App[] = []
  private diskBios: Uint8Array|null = null
  private uninsertedApp: App|null = null
  private volume = 1
  private keyConfigWnd: KeyConfigWnd|null = null
  private gamepadWnd: GamepadWnd|null = null
  private globalPaletWnd: GlobalPaletWnd|null = null
  private equalizerWnd: EqualizerWnd|null = null

  constructor(private root: HTMLElement) {
    this.wndMgr = new WindowManager(root)

    this.volume = Util.clamp(StorageUtil.getFloat(KEY_VOLUME, 1), 0, 1)
    const audioContextClass = window.AudioContext || window.webkitAudioContext
    AudioManager.setUp(audioContextClass)
    AudioManager.setMasterVolume(this.volume * DEFAULT_MASTER_VOLUME)

    this.setUpSysmenu()
    this.setUpFileDrop()
    this.setUpVolumeLink()
    this.setUpBlur()
  }

  private setUpSysmenu(): void {
    this.menuItems = [
      {
        label: '👾',
        submenu: [
          {
            label: 'Open',
            click: () => {
              const input = document.createElement('input')
              input.type = 'file'
              input.accept = '.nes,.zip, application/zip'
              input.onchange = (event) => {
                if (!input.value)
                  return
                const fileList = input.files
                if (fileList)
                  this.createAppFromFiles(fileList, 0, 0)

                // Clear.
                input.value = ''
              }
              input.click()
            },
          },
          {
            label: 'Global palet',
            click: () => this.openGlobalPaletWnd(),
          },
          {
            label: 'Key config',
            click: () => this.openKeyConfigWnd(),
          },
          {
            label: 'Gamepad',
            click: () => this.openGamepadWnd(),
          },
          {
            label: 'Equalizer',
            click: () => this.openEqualizerWnd(),
          },
        ],
      },
      {
        label: 'Help',
        submenu: [
          {
            label: 'About',
            click: () => window.open('https://github.com/tyfkda/nesemu/', '_blank'),
          },
        ],
      },
    ]

    const bar = document.getElementById('sysmenu-bar')
    if (bar == null)
      return

    const itemElems: HTMLElement[] = []
    let activeSubmenuIndex = -1
    let closeSubmenu: (() => void) | null

    const onClose = () => {
      if (activeSubmenuIndex >= 0) {
        const prev = itemElems[activeSubmenuIndex]
        prev.classList.remove('opened')
        activeSubmenuIndex = -1
      }
      closeSubmenu = null
      //this.onEvent(WndEvent.CLOSE_MENU)
      bar.classList.remove('selected')
    }

    const showSubmenu = (index: number) => {
      const menuItem = this.menuItems[index]
      if (!('submenu' in menuItem) || activeSubmenuIndex === index)
        return

      if (closeSubmenu != null)
        closeSubmenu()

      if (activeSubmenuIndex >= 0) {
        const prev = itemElems[activeSubmenuIndex]
        prev.classList.remove('opened')
      }
      const itemElem = itemElems[index]
      activeSubmenuIndex = index
      closeSubmenu = this.openSubmenu(menuItem, itemElem, onClose)
      itemElem.classList.add('opened')
      bar.classList.add('selected')
    }

    this.menuItems.forEach((menuItem: MenuItemInfo, index: number) => {
      const itemElem = document.createElement('div')
      itemElem.className = 'sysmenu-item full-height pull-left'
      itemElem.innerText = menuItem.label
      itemElem.addEventListener('click', event => {
        event.stopPropagation()
        if ('submenu' in menuItem) {
          if (activeSubmenuIndex < 0) {
            //this.onEvent(WndEvent.OPEN_MENU)
            //const sysMenu = this.menuItems[MenuType.SYS].submenu
            //sysMenu[SysMenuType.GAMEPAD].disabled = GamepadManager.isSupported()

            showSubmenu(index)
          } else {
            if (closeSubmenu)
              closeSubmenu()
            onClose()
          }
        }
      })
      bar.appendChild(itemElem)
      itemElems.push(itemElem)

      itemElem.addEventListener('mouseenter', _event => {
        if (activeSubmenuIndex >= 0 && activeSubmenuIndex !== index && 'submenu' in menuItem) {
          showSubmenu(index)
        }
      })
    })
  }

  private openSubmenu(menuItem: MenuItemInfo, itemElem: HTMLElement,
                      onClose?: () => void): () => void
  {
    const subItemHolder = document.createElement('div')
    subItemHolder.className = 'sysmenu menu-subitem-holder bottom'
    subItemHolder.style.zIndex = String(Z_MENU_SUBITEM)
    menuItem.submenu.forEach(submenuItem => {
      const submenuRow = document.createElement('div')
      submenuRow.className = 'submenu-row clearfix'
      const subItemElem = document.createElement('div')
      if (submenuItem.label !== '----') {
        if (submenuItem.checked) {
          const checked = document.createElement('div')
          checked.className = 'submenu-check'
          submenuRow.appendChild(checked)
        }

        subItemElem.innerText = submenuItem.label
        if (submenuItem.disabled) {
          subItemElem.className = 'menu-item disabled'
        } else {
          subItemElem.className = 'menu-item'
          subItemElem.addEventListener('click', _event => {
            if (submenuItem.click)
              submenuItem.click()
          })
        }
      } else {
        const hr = document.createElement('hr')
        hr.className = 'submenu-splitter'
        submenuRow.appendChild(hr)
      }
      submenuRow.appendChild(subItemElem)
      subItemHolder.appendChild(submenuRow)
    })
    this.root.appendChild(subItemHolder)

    const rect = getOffsetRect(this.root, itemElem)
    DomUtil.setStyles(subItemHolder, {
      left: `${rect.left - 1}px`,  // For border size
      bottom: `0px`,
    })

    const close = () => {
      if (subItemHolder.parentNode != null)
        subItemHolder.parentNode.removeChild(subItemHolder)
      document.removeEventListener('click', onClickOther)
    }

    // To handle earlier than menu open, pass useCapture=true
    const onClickOther = (_event: MouseEvent) => {
      close()
      if (onClose != null)
        onClose()
    }
    document.addEventListener('click', onClickOther /*, true*/)

    return close
  }

  private setUpFileDrop(): void {
    const dropDesc = document.getElementById('drop-desc')
    if (!dropDesc)
      return

    // Handle file drop.
    if (!(window.File && window.FileReader && window.FileList && window.Blob)) {
      dropDesc.style.display = 'none'
      return
    }
    dropDesc.style.opacity = '0'

    DomUtil.handleFileDrop(this.root, (files, x, y) => {
      this.createAppFromFiles(files, x, y)
      dropDesc.style.display = 'none'
    })
  }

  private createAppFromFiles(files: FileList, x: number, y: number): void {
    // Load .js files
    for (let i = 0; i < files.length; ++i) {
      const file = files[i]
      const ext = Util.getExt(file.name).toLowerCase()
      if (ext !== 'js')
        continue
      const jsApp = new JsApp(this.wndMgr, {
        title: file.name,
        centerX: x,
        centerY: y,
        onClosed: (app) => {
          this.removeApp(app)
        },
      })
      jsApp.setFile(file)
      this.apps.push(jsApp)
    }

    const kTargetExts = ['nes', 'bin', 'fds']

    // Unzip and flatten.
    const promises = new Array<Promise<any>>()
    for (let i = 0; i < files.length; ++i) {
      const file = files[i]
      let promise: Promise<any>|null = null
      const ext = Util.getExt(file.name).toLowerCase()
      if (ext === 'js') {
        // Skip, because already processed.
      } else if (ext === 'zip') {
        promise = DomUtil.loadFile(file)
          .then(binary => {
            const zip = new JSZip()
            return zip.loadAsync(binary)
          })
          .then((loadedZip: JSZip) => {
            for (const fileName of Object.keys(loadedZip.files)) {
              const ext2 = Util.getExt(fileName).toLowerCase()
              if (kTargetExts.indexOf(ext2) >= 0) {
                return loadedZip.files[fileName]
                  .async('uint8array')
                  .then(unzipped => Promise.resolve({type: ext2, binary: unzipped, fileName}))
              }
            }
            return Promise.reject(`No .nes file included: ${file.name}`)
          })
      } else if (kTargetExts.indexOf(ext) >= 0) {
        promise = DomUtil.loadFile(file)
          .then(binary => Promise.resolve({type: ext, binary, fileName: file.name}))
      } else {
        promise = Promise.reject(`Unsupported file: ${file.name}`)
      }
      if (promise)
        promises.push(promise)
    }
    Promise.all(promises)
      .then(results => {
        const typeMap: {[key: string]: Array<any>} = {}
        ; (results as {type: string, binary: Uint8Array, fileName: string}[]).forEach(result => {
          if (!typeMap[result.type])
            typeMap[result.type] = []
          typeMap[result.type].push(result)
        })
        // .bin: Disk BIOS
        if (typeMap.bin) {
          this.diskBios = typeMap.bin[0].binary as Uint8Array
          if (!typeMap.fds) {  // Boot disk system without inserting disk.
            this.uninsertedApp = this.bootDiskImage(this.diskBios, null, 'DISK System', x, y)
          }
        }
        // Load .nes files.
        if (typeMap.nes) {
          typeMap.nes.forEach(file => {
            this.createAppFromRom(file.binary, file.fileName, x, y)
            x += 16
            y += 16
          })
        }
        // Load .fds
        if (typeMap.fds) {
          const diskBios = this.diskBios
          if (diskBios == null) {
            this.wndMgr.showSnackbar('.fds needs BIOS file (.bin) for Disk System')
            return
          }

          typeMap.fds.forEach(file => {
            if (this.uninsertedApp != null) {
              this.uninsertedApp.setDiskImage(file.binary)
              this.uninsertedApp = null
            } else {
              this.bootDiskImage(diskBios, file.binary, file.fileName, x, y)
            }
            x += 16
            y += 16
          })
        }
      })
      .catch((e: Error) => {
        this.wndMgr.showSnackbar(e.toString())
      })
  }

  private createAppFromRom(romData: Uint8Array, name: string, x: number, y: number): void {
    const m = name.match(/^(.*?)(\s*\(.*\))?\.\w+$/)
    const title = m ? m[1] : name
    const option: Option = {
      title,
      centerX: x,
      centerY: y,
      onClosed: (app2) => {
        this.removeApp(app2)
      },
    }
    const app = new App(this.wndMgr, option)
    const result = app.loadRom(romData)
    if (result !== true) {
      this.wndMgr.showSnackbar(`${name}: ${result}`)
      app.close()
      return
    }
    this.apps.push(app)
  }

  private bootDiskImage(biosData: Uint8Array, diskImage: Uint8Array|null, name: string,
                        x: number, y: number): App
  {
    const m = name.match(/^(.*?)\s*\(.*\)\.\w*$/)
    const title = m ? m[1] : name
    const option: Option = {
      title,
      centerX: x,
      centerY: y,
      onClosed: (_app) => {
        this.removeApp(_app)
      },
    }

    const app = App.create(this.wndMgr, option)
    app.bootDiskBios(biosData)
    if (diskImage != null)
      app.setDiskImage(diskImage)
    this.apps.push(app)
    return app
  }

  private removeApp(app: App): void {
    const index = this.apps.indexOf(app)
    if (index >= 0)
      this.apps.splice(index, 1)
  }

  private openGlobalPaletWnd(): void {
    if (this.globalPaletWnd == null) {
      this.globalPaletWnd = new GlobalPaletWnd(this.wndMgr, () => {
        this.globalPaletWnd = null
      })
      this.wndMgr.add(this.globalPaletWnd)
    } else {
      this.wndMgr.moveToTop(this.globalPaletWnd)
    }
  }

  private openKeyConfigWnd(): void {
    if (this.keyConfigWnd == null) {
      this.keyConfigWnd = new KeyConfigWnd(this.wndMgr, () => {
        this.keyConfigWnd = null
      })
      this.wndMgr.add(this.keyConfigWnd)
    } else {
      this.wndMgr.moveToTop(this.keyConfigWnd)
    }
  }

  private openGamepadWnd(): void {
    if (!GamepadManager.isSupported()) {
      return
    }

    if (this.gamepadWnd == null) {
      this.gamepadWnd = new GamepadWnd(this.wndMgr, () => {
        this.gamepadWnd = null
      })
      this.wndMgr.add(this.gamepadWnd)
    } else {
      this.wndMgr.moveToTop(this.gamepadWnd)
    }
  }

  private setUpVolumeLink(): void {
    const volumeText = document.getElementById('volume')
    const sliderContainer = document.getElementById('volume-slider-container')
    const slider = document.getElementById('volume-slider')
    if (volumeText == null || sliderContainer == null || slider == null)
      return

    let dragging = false
    let leave = false
    let leaveTimeout: number = -1
    sliderContainer.addEventListener('mousedown', (event) => {
      if (event.button !== 0)
        return
      dragging = true
      const sliderHeight = (slider.parentNode as HTMLElement).getBoundingClientRect().height
      const updateSlider = (event2: MouseEvent) => {
        const [, y] = DomUtil.getMousePosIn(event2, slider.parentNode as HTMLElement)
        const height = Util.clamp(sliderHeight - y, 0, sliderHeight)
        slider.style.height = `${height}px`
        this.volume = height / sliderHeight
        AudioManager.setMasterVolume(this.volume * DEFAULT_MASTER_VOLUME)
      }
      DomUtil.setMouseDragListener({
        move: updateSlider,
        up: (_event2: MouseEvent) => {
          dragging = false
          if (leave)
            hideSlider()
          this.volume = Math.round(this.volume * 100) / 100
          StorageUtil.put(KEY_VOLUME, this.volume)
        },
      })
      updateSlider(event)
    })

    const showSlider = () => {
      const prect = volumeText.getBoundingClientRect() as DOMRect
      const w = parseInt(sliderContainer.style.width || '0', 10)
      const h = parseInt(sliderContainer.style.height || '0', 10)
      DomUtil.setStyles(sliderContainer, {
        display: 'inherit',
        top: `${Math.round(prect.y - h)}px`,
        left: `${Math.round(prect.x + (prect.width - w) / 2)}px`,
      })
      const sliderHeight = (slider.parentNode as HTMLElement).getBoundingClientRect().height
      slider.style.height = `${this.volume * sliderHeight}px`

      volumeText.classList.add('active')
    }
    const hideSlider = () => {
      DomUtil.setStyles(sliderContainer, {
        display: 'none',
      })

      volumeText.classList.remove('active')
    }

    volumeText.addEventListener('mouseenter', () => {
      showSlider()
    })
    volumeText.addEventListener('mouseleave', () => {
      leaveTimeout = window.setTimeout(() => {
        hideSlider()
      }, 10)
    })

    sliderContainer.addEventListener('mouseenter', (_event) => {
      leave = false
      if (leaveTimeout !== -1) {
        clearTimeout(leaveTimeout)
        leaveTimeout = -1
      }
    })
    sliderContainer.addEventListener('mouseleave', (_event) => {
      leave = true
      if (!dragging)
        hideSlider()
    })
  }

  private openEqualizerWnd(): void {
    if (this.equalizerWnd == null) {
      this.equalizerWnd = new EqualizerWnd(this.wndMgr, () => {
        this.equalizerWnd = null
      })
      this.wndMgr.add(this.equalizerWnd)
    } else {
      this.wndMgr.moveToTop(this.equalizerWnd)
    }
  }

  private setUpBlur(): void {
    window.addEventListener('blur', () => {
      AudioManager.setMasterVolume(0)
    })
    window.addEventListener('focus', () => {
      AudioManager.setMasterVolume(this.volume * DEFAULT_MASTER_VOLUME)
    })
  }
}

window.addEventListener('load', () => {
  StorageUtil.setKeyPrefix('nesemu:')
  GamepadManager.setUp()

  const root = document.getElementById('nesroot')
  if (root != null)
    new Main(root)
})
