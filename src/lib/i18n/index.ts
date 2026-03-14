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
    searchArea: 'Redo search in this area',
    directions: 'Directions',
    reserve: 'Reserve',
    call: 'Call',
    save: 'Save',
    saved: 'Saved',
    issue: 'Report an issue'
  },
  ja: {
    search: '駅・エリア・ランドマークを検索',
    recenter: '現在地',
    layers: 'レイヤー',
    filters: '絞り込み',
    openNow: '営業中',
    closingSoon: 'まもなく終了',
    sortBest: '近くの名店',
    sortDistance: '距離',
    sortPrice: '価格',
    sortClosingSoon: '終了が早い順',
    searchArea: 'このエリアで再検索',
    directions: '経路',
    reserve: '予約',
    call: '電話',
    save: '保存',
    saved: '保存済み',
    issue: '問題を報告'
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
