export interface Language {
  /** ISO 639-1 code used by speech recognition and translation. */
  code: string;
  name: string;
  native: string;
  /** Default text-to-speech locale. */
  locale: string;
  rtl?: boolean;
}

export const LANGUAGES: Language[] = [
  { code: "en", name: "English", native: "English", locale: "en-US" },
  { code: "de", name: "German", native: "Deutsch", locale: "de-DE" },
  { code: "ar", name: "Arabic", native: "العربية", locale: "ar-SA", rtl: true },
  { code: "fr", name: "French", native: "Français", locale: "fr-FR" },
  { code: "es", name: "Spanish", native: "Español", locale: "es-ES" },
  { code: "it", name: "Italian", native: "Italiano", locale: "it-IT" },
  { code: "tr", name: "Turkish", native: "Türkçe", locale: "tr-TR" },
  { code: "ru", name: "Russian", native: "Русский", locale: "ru-RU" },
  { code: "uk", name: "Ukrainian", native: "Українська", locale: "uk-UA" },
  { code: "pl", name: "Polish", native: "Polski", locale: "pl-PL" },
  { code: "pt", name: "Portuguese", native: "Português", locale: "pt-BR" },
  { code: "nl", name: "Dutch", native: "Nederlands", locale: "nl-NL" },
  { code: "ro", name: "Romanian", native: "Română", locale: "ro-RO" },
  { code: "el", name: "Greek", native: "Ελληνικά", locale: "el-GR" },
  { code: "sv", name: "Swedish", native: "Svenska", locale: "sv-SE" },
  { code: "cs", name: "Czech", native: "Čeština", locale: "cs-CZ" },
  { code: "hu", name: "Hungarian", native: "Magyar", locale: "hu-HU" },
  { code: "bg", name: "Bulgarian", native: "Български", locale: "bg-BG" },
  { code: "hr", name: "Croatian", native: "Hrvatski", locale: "hr-HR" },
  { code: "sr", name: "Serbian", native: "Српски", locale: "sr-RS" },
  { code: "sq", name: "Albanian", native: "Shqip", locale: "sq-AL" },
  { code: "fa", name: "Persian", native: "فارسی", locale: "fa-IR", rtl: true },
  { code: "ur", name: "Urdu", native: "اردو", locale: "ur-PK", rtl: true },
  { code: "he", name: "Hebrew", native: "עברית", locale: "he-IL", rtl: true },
  { code: "hi", name: "Hindi", native: "हिन्दी", locale: "hi-IN" },
  { code: "bn", name: "Bengali", native: "বাংলা", locale: "bn-BD" },
  { code: "zh", name: "Chinese", native: "中文", locale: "zh-CN" },
  { code: "ja", name: "Japanese", native: "日本語", locale: "ja-JP" },
  { code: "ko", name: "Korean", native: "한국어", locale: "ko-KR" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt", locale: "vi-VN" },
  { code: "th", name: "Thai", native: "ไทย", locale: "th-TH" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia", locale: "id-ID" },
];

export const languageByCode = (code: string): Language =>
  LANGUAGES.find((l) => l.code === code) ?? { code, name: code, native: code, locale: code };
