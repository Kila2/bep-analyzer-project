import * as en from "./en.json";
import * as zh from "./zh.json";

const translations = {
  en,
  zh,
};

export class Translator {
  public lang: "en" | "zh";
  private translationData: any;

  constructor(lang: "en" | "zh" = "en") {
    this.lang = lang;
    this.translationData = translations[this.lang];
  }

  public getLanguage(): "en" | "zh" {
    return this.lang;
  }

  /**
   * Gets a translated string by key.
   * @param key The key in the format 'section.subsection.key'
   * @param replacements An object of replacements, e.g., {count: 5}
   * @returns The translated string.
   */
  public t(
    key: string,
    replacements: { [key: string]: string | number } = {},
  ): string {
    const keys = key.split(".");
    let result = this.translationData;

    for (const k of keys) {
      result = result[k];
      if (result === undefined) {
        // Fallback to English if key not in current language
        let fallbackResult: any = translations["en"];
        for (const fk of keys) {
          fallbackResult = fallbackResult[fk];
          if (fallbackResult === undefined) return key;
        }
        result = fallbackResult;
        break;
      }
    }

    let strResult = String(result);

    for (const placeholder in replacements) {
      strResult = strResult.replace(
        `{{${placeholder}}}`,
        String(replacements[placeholder]),
      );
    }

    return strResult;
  }
}
