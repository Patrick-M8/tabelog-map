import { addMessages, getLocaleFromNavigator, init, locale } from 'svelte-i18n';

const messages = {
  en: {
    search: 'Search stations, areas, landmarks',
    recenter: 'Recenter',
    layers: 'Layers',
    filters: 'Filters',
    openNow: 'Open now',
    closingSoon: 'Closing soon',
    sortBest: 'Best nearby',
    sortDistance: 'Distance',
    sortPrice: 'Price',
    sortClosingSoon: 'Closing soon',
    searchArea: 'Refresh',
    directions: 'Directions',
    reserve: 'Reserve',
    call: 'Call',
    save: 'Save',
    saved: 'Saved',
    issue: 'Report an issue'
  },
  ja: {
    search: '\u99C5\u30FB\u30A8\u30EA\u30A2\u30FB\u30E9\u30F3\u30C9\u30DE\u30FC\u30AF\u3092\u691C\u7D22',
    recenter: '\u73FE\u5728\u5730',
    layers: '\u30EC\u30A4\u30E4\u30FC',
    filters: '\u7D5E\u308A\u8FBC\u307F',
    openNow: '\u55B6\u696D\u4E2D',
    closingSoon: '\u307E\u3082\u306A\u304F\u7D42\u4E86',
    sortBest: '\u8FD1\u304F\u306E\u540D\u5E97',
    sortDistance: '\u8DDD\u96E2',
    sortPrice: '\u4FA1\u683C',
    sortClosingSoon: '\u7D42\u4E86\u304C\u65E9\u3044\u9806',
    searchArea: '\u66F4\u65B0',
    directions: '\u7D4C\u8DEF',
    reserve: '\u4E88\u7D04',
    call: '\u96FB\u8A71',
    save: '\u4FDD\u5B58',
    saved: '\u4FDD\u5B58\u6E08\u307F',
    issue: '\u554F\u984C\u3092\u5831\u544A'
  }
};

export function setupI18n() {
  addMessages('en', messages.en);
  addMessages('ja', messages.ja);
  init({
    fallbackLocale: 'en',
    initialLocale: getLocaleFromNavigator()?.startsWith('ja') ? 'ja' : 'en'
  });
}

export function setAppLocale(nextLocale: 'en' | 'ja') {
  locale.set(nextLocale);
}
