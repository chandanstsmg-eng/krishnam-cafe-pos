/**
 * Network thermal printers (most 80 mm printers with an Ethernet or Wi-Fi port
 * listen on TCP 9100). USB printers are installed in Windows and printed to
 * from the browser instead, so they need nothing here.
 */
import net from 'node:net';
import { receiptTextLines, type ReceiptDoc } from '../../shared/receipt.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { PrinterSettingsDTO } from '../../shared/types.js';

const ESC = 0x1b;
const GS = 0x1d;

/** Printers' built-in code pages rarely have ₹ or Indic scripts. */
const ascii = (s: string) =>
  s
    .replace(/₹/g, 'Rs')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/×/g, 'x')
    .replace(/é/g, 'e')
    .replace(/[^\x20-\x7e]/g, '?');

export function toEscPos(doc: ReceiptDoc, copies = 1): Buffer {
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);
  const text = (s: string) => bytes.push(...Buffer.from(ascii(s), 'ascii'));
  for (let c = 0; c < Math.max(1, copies); c++) {
    push(ESC, 0x40); // initialise
    if (doc.openDrawer && c === 0) push(ESC, 0x70, 0x00, 0x19, 0xfa); // kick cash drawer
    for (const l of receiptTextLines(doc)) {
      push(ESC, 0x45, l.bold ? 1 : 0);
      push(GS, 0x21, l.wide ? 0x11 : l.tall ? 0x01 : 0x00);
      text(l.text);
      push(0x0a);
    }
    push(GS, 0x21, 0x00, ESC, 0x45, 0);
    push(0x0a, 0x0a, 0x0a);
    push(GS, 0x56, 0x42, 0x00); // feed and partial cut
  }
  return Buffer.from(bytes);
}

export function sendToNetworkPrinter(ip: string, port: number, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };
    socket.setTimeout(6000, () => finish(new Error('timeout')));
    socket.once('error', finish);
    socket.connect(port, ip, () => socket.write(data, () => socket.end(() => finish())));
  });
}

export async function printDoc(printer: PrinterSettingsDTO, doc: ReceiptDoc) {
  if (printer.connection !== 'NETWORK') throw new AppError(400, 'This printer prints from the browser.', 'BROWSER_PRINTER');
  if (!printer.ipAddress) throw new AppError(400, 'Printer address is not set. Ask the owner to set it in Settings → Printer.', 'NO_PRINTER_IP');
  try {
    await sendToNetworkPrinter(printer.ipAddress, printer.port, toEscPos(doc, printer.copies));
  } catch (err) {
    logger.warn(`Printer ${printer.ipAddress}:${printer.port} not reachable`, err);
    throw new AppError(503, 'Printer is not responding. Check that it is switched on, has paper, and is connected.', 'PRINTER_OFFLINE');
  }
}
