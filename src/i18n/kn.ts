/**
 * ಕನ್ನಡ — Kannada. A starting set covering the counter's most-used words.
 * Anything not listed here falls back to English automatically, so this file
 * can be completed a little at a time (ideally by someone at the café).
 */
const kn = {
  nav: { tables: 'ಟೇಬಲ್‌ಗಳು', order: 'ಆರ್ಡರ್', bills: 'ಬಿಲ್‌ಗಳು', shift: 'ಶಿಫ್ಟ್', kitchen: 'ಅಡುಗೆಮನೆ' },
  orderType: { DINE_IN: 'ಇಲ್ಲೇ ಊಟ', TAKEAWAY: 'ಪಾರ್ಸೆಲ್', DELIVERY: 'ಡೆಲಿವರಿ' },
  billing: { subtotal: 'ಉಪ ಮೊತ್ತ', discount: 'ರಿಯಾಯಿತಿ', tax: 'ತೆರಿಗೆ (GST)', total: 'ಒಟ್ಟು' },
  pay: { cash: 'ನಗದು', upi: 'UPI', card: 'ಕಾರ್ಡ್', change: 'ಹಿಂದಿರುಗಿಸುವ ಚಿಲ್ಲರೆ', complete: 'ಪಾವತಿ ಪೂರ್ಣ' },
  pos: { sendKitchen: 'ಅಡುಗೆಮನೆಗೆ ಕಳುಹಿಸಿ', printBill: 'ಬಿಲ್ ಮುದ್ರಿಸಿ', soldOut: 'ಮುಗಿದಿದೆ', allItems: 'ಎಲ್ಲಾ ಐಟಂಗಳು', sendBillToCashier: 'ಬಿಲ್ ಕ್ಯಾಷಿಯರ್‌ಗೆ ಕಳುಹಿಸಿ' },
  tables: { available: 'ಖಾಲಿ', occupied: 'ಭರ್ತಿ', reserved: 'ಕಾಯ್ದಿರಿಸಲಾಗಿದೆ' },
  sync: { online: 'ಆನ್‌ಲೈನ್', offline: 'ಆಫ್‌ಲೈನ್' },
};

export default kn;
