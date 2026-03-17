export type HoursConfidence = 'low' | 'medium' | 'high';
export type ConsensusGrade = 'A' | 'B' | 'C' | 'D' | 'E';
export type SheetSnap = 'peek' | 'mid' | 'full';
export type SortDirection = 'asc' | 'desc';
export type ReviewSource = 'tabelog' | 'google';
export type PriceMeal = 'dinner' | 'lunch';
export type SortKey =
  | 'best'
  | 'closingSoon'
  | 'distanceAsc'
  | 'distanceDesc'
  | 'distance'
  | 'priceAsc'
  | 'priceDesc'
  | 'tabelogAsc'
  | 'tabelogDesc'
  | 'googleAsc'
  | 'googleDesc'
  | 'reviewsCombinedAsc'
  | 'reviewsCombinedDesc';
export type ClosureState = 'active' | 'temporarilyClosed' | 'permanentlyClosed' | 'unknown';

export interface LastOrderDetail {
  generic?: string;
  food?: string;
  drinks?: string;
}

export interface DailyWindow {
  open: string;
  close: string;
  crossesMidnight: boolean;
  allDay: boolean;
  lastOrder: string | null;
  lastOrderDetail: LastOrderDetail | null;
}

export interface WeeklyTimeline {
  mon: DailyWindow[];
  tue: DailyWindow[];
  wed: DailyWindow[];
  thu: DailyWindow[];
  fri: DailyWindow[];
  sat: DailyWindow[];
  sun: DailyWindow[];
}

export interface HoursDisplay {
  today: string;
  week: string;
}

export interface HoursSpecialDays {
  publicHoliday: DailyWindow[];
  dayBeforePublicHoliday: DailyWindow[];
  dayAfterPublicHoliday: DailyWindow[];
}

export interface RatingSummary {
  score: number | null;
  reviews: number;
}

export interface PlaceCategory {
  key: string;
  label: string;
  labelJp: string | null;
}

export interface SourceLinks {
  tabelog: string | null;
  google: string | null;
}

export interface ClosureInfo {
  state: ClosureState;
  source: 'google' | 'tabelog' | 'derived';
  reason: string | null;
  detectedAt: string | null;
}

export interface PlaceSummary {
  id: string;
  placeId: string | null;
  nameEn: string | null;
  nameJp: string | null;
  lat: number;
  lng: number;
  region: string | null;
  station: string | null;
  area: string | null;
  category: PlaceCategory;
  subCategories: string[];
  priceBand: string | null;
  priceBucket: number;
  priceTierDinner: number;
  priceTierLunch: number;
  weeklyTimeline: WeeklyTimeline;
  hoursConfidence: HoursConfidence;
  hoursDisplay: HoursDisplay;
  hoursSpecialDays: HoursSpecialDays;
  hoursPolicies: string[];
  freshnessUpdatedAt: string;
  consensusScore: number;
  consensusGrade: ConsensusGrade;
  tabelog: RatingSummary;
  google: RatingSummary;
  sourceLinks: SourceLinks;
  reserveUrl: string | null;
  callPhone: string | null;
  imageUrl: string | null;
  advisories: string[];
  badges: string[];
  closure: ClosureInfo;
}

export interface ReservationLink {
  label: string;
  url: string | null;
}

export interface PlaceDetailSupplement {
  address: string | null;
  priceLunch: string | null;
  priceDinner: string | null;
  imageUrl: string | null;
  mustOrder: string | null;
  reservationLinks: ReservationLink[];
  issuePayload: {
    placeId: string | null;
    nameEn: string | null;
    nameJp: string | null;
    sources: SourceLinks;
  };
}

export interface PlaceDetail extends PlaceSummary, PlaceDetailSupplement {}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface SearchState {
  center: { lat: number; lng: number };
  bounds: MapBounds | null;
  radiusMeters: number;
  viewportMode: 'viewport';
  activeFilters: ActiveFilters;
  sort: SortKey;
  selectedPlaceId: string | null;
  sheetSnap: SheetSnap;
}

export interface ActiveFilters {
  openNow: boolean;
  closingSoon: boolean;
  openingSoon: boolean;
  maxWalkMinutes: number | null;
  priceMeal: PriceMeal;
  priceTiers: number[];
  categoryKeys: string[];
}

export interface PopularHub {
  id: string;
  label: string;
  nameJp: string;
  lat: number;
  lng: number;
}

export interface DisplayPlace extends PlaceSummary {
  distanceMeters: number;
  walkMinutes: number;
  status: PlaceStatus;
}

export interface PlaceStatus {
  state: 'open' | 'closingSoon' | 'openingSoon' | 'closed' | 'temporarilyClosed' | 'permanentlyClosed';
  label: string;
  detail: string;
  closesAt: string | null;
  opensAt: string | null;
  lastOrderAt: string | null;
}
