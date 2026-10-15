import { receiptHtml, RECEIPT_CSS } from '../../services/print';
import type { ReceiptDoc } from '../../../shared/receipt';

/** On-screen copy of the paper receipt, drawn by the same code that prints it. */
export function ReceiptPreview({ doc, className }: { doc: ReceiptDoc; className?: string }) {
  return (
    <div className={className}>
      <style>{RECEIPT_CSS}</style>
      <div
        className="mx-auto w-fit rounded-sm bg-white px-4 py-3 shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_1px_rgb(0_0_0/0.04)]"
        // receiptHtml escapes every value it inserts
        dangerouslySetInnerHTML={{ __html: receiptHtml(doc) }}
      />
    </div>
  );
}
