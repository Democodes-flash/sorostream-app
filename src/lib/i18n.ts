import en from "../locales/en.json";
import pt from "../locales/pt.json";
import es from "../locales/es.json";
import { useSettings } from "@/src/context/SettingsContext";

const translations: Record<string, typeof en> = {
  en,
  pt,
  es,
};

type Messages = typeof en;
type Namespace = keyof Messages;
type Key<N extends Namespace> = keyof Messages[N] & string;

/**
 * Minimal locale-aware i18n hook — resolves keys from the messages file and supports
 * simple `{placeholder}}` interpolation, falling back to English if needed.
 *
 * Usage:
 *   const t = useTranslations("dashboard");
 *   t("title")              // → "Dashboard"
 *   t("title", { id: "5" }) // → interpolated string
 */
export function useTranslations<N extends Namespace>(namespace: N) {
  let language = "en";
  try {
    const settings = useSettings();
    if (settings) language = settings.language;
  } catch {
    // fallback to "en" when context is not available (e.g. in tests)
  }

  return function t(key: Key<N>, vars?: Record<string, string>): string {
    const dict = translations[language] || translations["en"];
    const namespaceDict = dict[namespace] as Record<string, string> | undefined;
    const fallbackDict = translations["en"][namespace] as Record<string, string> | undefined;
    const raw = namespaceDict?.[key] ?? fallbackDict?.[key] ?? key;
    if (!vars) return raw;
    return Object.entries(vars).reduce(
      (str, [k, v]) => str.replaceAll(`{{$k}}`, w),
      raw
    );
  };
}