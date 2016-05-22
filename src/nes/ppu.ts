// PPU: Picutre Processing Unit

import {Const, kColors, kStaggered, kFlipBits} from './const.ts'
import {Util} from './util.ts'

const REGISTER_COUNT = 8
const VRAM_SIZE = 0x4000
const OAM_SIZE = 0x0100

// PPUCTRL ($2000)
const PPUCTRL = 0x00
const VINT_ENABLE = 0x80  // V: 1=Trigger NMI when VBLANK start
const SPRITE_SIZE = 0x20
const BG_PATTERN_TABLE_ADDRESS = 0x10
const SPRITE_PATTERN_TABLE_ADDRESS = 0x08
const INCREMENT_MODE = 0x04  // I: 1=+32, 0=+1
const BASE_NAMETABLE_ADDRESS = 0x03

// PPUSTATUS ($2002)
const PPUSTATUS = 0x02
const VBLANK = 0x80

// OAMADDR ($2003)
const OAMADDR = 0x03

// OAMDATA ($2004)
const OAMDATA = 0x04

const PPUSCROLL = 0x05  // $2005
const PPUADDR = 0x06  // $2006
const PPUDATA = 0x07  // $2007

export class Ppu {
  public regs: Uint8Array
  public chrData: Uint8Array
  public vram: Uint8Array
  public oam: Uint8Array  // Object Attribute Memory
  public scrollX: number
  public scrollY: number
  public mirrorMode: number
  private latch: number
  private ppuAddr: number

  constructor() {
    this.regs = new Uint8Array(REGISTER_COUNT)
    this.vram = new Uint8Array(VRAM_SIZE)
    this.oam = new Uint8Array(OAM_SIZE)
    this.mirrorMode = 0
  }

  public setChrData(chrData: Uint8Array): void {
    this.chrData = chrData
  }

  public setMirrorMode(mode: number): void {
    this.mirrorMode = mode
  }

  public reset(): void {
    this.regs.fill(0)
    this.latch = 0
  }

  public read(reg): number {
    const result = this.regs[reg]
    switch (reg) {
    case PPUSTATUS:
      //this.regs[PPUSTATUS] &= ~VBLANK
      this.latch = 0
      break
    case PPUDATA:
      this.incPpuAddr()
      break
    default:
      break
    }
    return result
  }

  public write(reg, value): void {
    this.regs[reg] = value

    switch (reg) {
    case PPUSCROLL:
      if (this.latch === 0)
        this.scrollX = value
      else
        this.scrollY = value
      this.latch = 1 - this.latch
      break
    case PPUADDR:
      if (this.latch === 0)
        this.ppuAddr = value
      else
        this.ppuAddr = ((this.ppuAddr << 8) | value) & (VRAM_SIZE - 1)
      this.latch = 1 - this.latch
      break
    case PPUDATA:
      this.vram[this.ppuAddr] = value
      this.incPpuAddr()
      break
    default:
      break
    }
  }

  public copyWithDma(array: Uint8Array, start: number): void {
    const dst = this.oam
    let j = this.regs[OAMADDR]
    for (let i = 0; i < 256; ++i) {
      dst[j] = array[start + i]
      j = (j + 1) & 255
    }
  }

  public setVBlank(): void {
    this.regs[PPUSTATUS] |= VBLANK
  }
  public clearVBlank(): void {
    this.regs[PPUSTATUS] &= ~VBLANK
  }

  public interruptEnable(): boolean {
    return (this.regs[PPUCTRL] & VINT_ENABLE) !== 0
  }

  public getNameTable(bx: number, by: number): number {
    const adr = 0x2000 + ((this.regs[PPUCTRL] & BASE_NAMETABLE_ADDRESS) << 10)
    if (this.mirrorMode === 0) {
      return adr ^ ((by / 30) & 1) << 11
    } else {
      return adr ^ (bx & 32) << 6
    }
  }

  public getBgPatternTableAddress(): number {
    return ((this.regs[PPUCTRL] & BG_PATTERN_TABLE_ADDRESS) << 8)
  }

  public getSpritePatternTableAddress(): number {
    if ((this.regs[PPUCTRL] & SPRITE_SIZE) === 0)
      return ((this.regs[PPUCTRL] & SPRITE_PATTERN_TABLE_ADDRESS) << 9)
    return 0
  }

  public isSprite8x16(): boolean {
    return (this.regs[PPUCTRL] & SPRITE_SIZE) !== 0
  }

  private incPpuAddr(): void {
    const add = ((this.regs[PPUCTRL] & INCREMENT_MODE) !== 0) ? 32 : 1
    this.ppuAddr = (this.ppuAddr + add) & (VRAM_SIZE - 1)
  }

  public renderBg(imageData: ImageData): void {
    const W = 8
    const LINE_WIDTH = imageData.width
    const chrRom = this.chrData
    const chrStart = this.getBgPatternTableAddress()
    const vram = this.vram
    const paletTable = 0x3f00
    const pixels = imageData.data
    const scrollX = this.scrollX, scrollY = this.scrollY

    for (let bby = 0; bby < Const.HEIGHT / W + 1; ++bby) {
      const by = (bby + (scrollY >> 3)) & 63
      const ay = by % 30
      for (let bbx = 0; bbx < Const.WIDTH / W + 1; ++bbx) {
        const bx = (bbx + (scrollX >> 3)) & 63
        const ax = bx & 31

        const nameTable = this.getNameTable(bx, by)
        const name = vram[nameTable + ax + (ay << 5)]
        const chridx = name * 16 + chrStart
        const palShift = (ax & 2) + ((ay & 2) << 1)
        const atrBlk = ((ax >> 2) | 0) + ((ay >> 2) | 0) * 8
        const attributeTable = nameTable + 0x3c0
        const paletHigh = ((vram[attributeTable + atrBlk] >> palShift) & 3) << 2

        for (let py = 0; py < W; ++py) {
          const yy = bby * W + py - (scrollY & 7)
          if (yy < 0)
            continue
          const idx = chridx + py
          const pat = (kStaggered[chrRom[idx + 8]] << 1) | kStaggered[chrRom[idx]]
          for (let px = 0; px < W; ++px) {
            const xx = bbx * W + px - (scrollX & 7)
            if (xx < 0)
              continue
            const pal = (pat >> ((W - 1 - px) * 2)) & 3
            let r = 0, g = 0, b = 0
            if (pal !== 0) {
              const palet = paletHigh + pal
              const col = vram[paletTable + palet] & 0x3f
              const c = col * 3
              r = kColors[c]
              g = kColors[c + 1]
              b = kColors[c + 2]
            }

            const index = (yy * LINE_WIDTH + xx) * 4
            pixels[index + 0] = r
            pixels[index + 1] = g
            pixels[index + 2] = b
          }
        }
      }
    }
  }

  public renderSprite(imageData: ImageData): void {
    const W = 8
    const LINE_WIDTH = imageData.width
    const PALET = 0x03
    const FLIP_HORZ = 0x40
    const FLIP_VERT = 0x80

    const oam = this.oam
    const vram = this.vram
    const chrRom = this.chrData
    const chrStart = this.getSpritePatternTableAddress()
    const paletTable = 0x3f10
    const pixels = imageData.data
    const isSprite8x16 = this.isSprite8x16()
    const h = isSprite8x16 ? 16 : 8

    for (let i = 0; i < 64; ++i) {
      const y = oam[i * 4]
      const index = oam[i * 4 + 1]
      const attr = oam[i * 4 + 2]
      const x = oam[i * 4 + 3]

      const chridx = isSprite8x16 ? (index & 0xfe) * 16 + ((index & 1) << 12) : index * 16 + chrStart
      const paletHigh = (attr & PALET) << 2

      for (let py = 0; py < h; ++py) {
        if (y + py >= Const.HEIGHT)
          break

        const ppy = (attr & FLIP_VERT) !== 0 ? (h - 1) - py : py
        const idx = chridx + (ppy & 7) + ((ppy & 8) * 2)
        let patHi = chrRom[idx + W]
        let patLo = chrRom[idx]
        if ((attr & FLIP_HORZ) !== 0) {
          patHi = kFlipBits[patHi]
          patLo = kFlipBits[patLo]
        }
        const pat = (kStaggered[patHi] << 1) | kStaggered[patLo]
        for (let px = 0; px < W; ++px) {
          if (x + px >= Const.WIDTH)
            break

          const pal = (pat >> ((W - 1 - px) * 2)) & 3
          if (pal === 0)
            continue
          const palet = paletHigh + pal
          const col = vram[paletTable + palet] & 0x3f
          const c = col * 3
          const index = ((y + py) * LINE_WIDTH + (x + px)) * 4
          pixels[index + 0] = kColors[c]
          pixels[index + 1] = kColors[c + 1]
          pixels[index + 2] = kColors[c + 2]
        }
      }
    }
  }
}