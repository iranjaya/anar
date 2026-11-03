import {
  type CountryCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js/max";

export type PhoneResult = {
  phoneRaw: string | null;
  phoneE164: string | null;
  phoneValid: boolean;
};

const phone = {
  normalisePhone(raw: string | null, defaultCountry: string): PhoneResult {
    const phoneRaw = raw?.trim() || null;
    if (!phoneRaw) return { phoneRaw, phoneE164: null, phoneValid: false };
    const digits = phoneRaw
      .replace(/^p:/i, "")
      .replace(/[\s\-.()]/g, "")
      .replace(/^00/, "+");
    const parsed = parsePhoneNumberFromString(
      digits,
      defaultCountry as CountryCode,
    );
    if (!parsed?.isValid())
      return { phoneRaw, phoneE164: null, phoneValid: false };
    return { phoneRaw, phoneE164: parsed.number, phoneValid: true };
  },
};
export default phone;
