// VRC3
// http://wiki.nesdev.com/w/index.php/VRC3

import {Mapper, PrgBankController} from './mapper'
import {Cpu} from '../cpu'
import {Ppu} from '../ppu'

export class Mapper073 extends Mapper {
  private irqEnable: boolean
  private irqValue: number
  private irqCounter: number

  public static create(pbc: PrgBankController, size: number, cpu: Cpu, ppu: Ppu): Mapper {
    return new Mapper073(pbc, size, cpu, ppu)
  }

  constructor(prgBankCtrl: PrgBankController, prgSize: number, private cpu: Cpu, ppu: Ppu) {
    super()

    this.irqEnable = false
    this.irqValue = this.irqCounter = -1

    const BANK_BIT = 14
    const count = prgSize >> BANK_BIT
    prgBankCtrl.setPrgBank(0, 0)
    prgBankCtrl.setPrgBank(1, 1)
    prgBankCtrl.setPrgBank(2, count * 2 - 2)
    prgBankCtrl.setPrgBank(3, count * 2 - 1)

    // PRG ROM bank
    cpu.setWriteMemory(0xf000, 0xffff, (_adr, value) => {
      const bank = value << 1
      prgBankCtrl.setPrgBank(0, bank)
      prgBankCtrl.setPrgBank(1, bank + 1)
    })

    // IRQ Latch 0, 1
    cpu.setWriteMemory(0x8000, 0x9fff, (adr, value) => {
      console.log()
      if (adr < 0x9000)
        this.irqValue = (this.irqValue & 0xfff0) | (value & 0x0f)
      else
        this.irqValue = (this.irqValue & 0xff0f) | ((value & 0x0f) << 4)
    })
    // IRQ Latch 2, 3
    cpu.setWriteMemory(0xa000, 0xbfff, (adr, value) => {
      if (adr < 0xb000)
        this.irqValue = (this.irqValue & 0xf0ff) | ((value & 0x0f) << 8)
      else
        this.irqValue = (this.irqValue & 0x0fff) | ((value & 0x0f) << 12)
    })

    cpu.setWriteMemory(0xc000, 0xdfff, (adr, value) => {
      if (adr < 0xd000) {
        // IRQ Control
        this.enableIrq((value & 2) !== 0)
        this.irqCounter = this.irqValue
      } else {
        // IRQ Acknowledge
      }
    })

    // PRG RAM
    const ram = new Uint8Array(0x2000)
    ram.fill(0xff)
    cpu.setReadMemory(0x6000, 0x7fff, (adr) => ram[adr & 0x1fff])
    cpu.setWriteMemory(0x6000, 0x7fff, (adr, value) => { ram[adr & 0x1fff] = value })
  }

  public reset() {
    this.irqEnable = false
    this.irqValue = this.irqCounter = -1
  }

  public onHblank(hcount: number): void {
    if (this.irqEnable && this.irqCounter > 0) {
      this.irqCounter -= 185  // TODO: Calculate.
      if (this.irqCounter < 0) {
        this.irqCounter = 0
        this.cpu.requestIrq()
      }
    }
  }

  private enableIrq(value: boolean): void {
    this.irqEnable = value
  }
}
