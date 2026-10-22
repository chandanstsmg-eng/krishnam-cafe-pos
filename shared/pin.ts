/** Staff PINs (counter sign-in and manager approval) are exactly this many digits. */
export const PIN_LENGTH = 4;
export const PIN_RE = /^\d{4}$/;
/** For text boxes being typed into: digits only, never longer than a PIN. */
export const PIN_TYPING_RE = /^\d{0,4}$/;
export const PIN_ERROR = `PIN is exactly ${PIN_LENGTH} digits`;
