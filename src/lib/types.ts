export type HoursConfidence = 'low' | 'medium' | 'high';
export type ConsensusGrade = 'A' | 'B' | 'C' | 'D' | 'E';
export type SheetSnap = 'peek' | 'mid' | 'full';
export type SortKey = 'best' | 'distanceAsc' | 'distanceDesc' | 'priceAsc' | 'priceDesc' | 'tabelog' | 'google';

export interface DailyWindow {
  open: string;
  close: string;
  crossesMidnight: boolean;
  lastOrder: string | null;
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
  weeklyTimeline: WeeklyTimeline;
  hoursConfidence: HoursConfidence;
  freshnessUpdatedAt: string;
  consensusScore: number;
  consensusGrade: ConsensusGrade;
  tabelog: RatingSummary;
  google: RatingSummary;
  sourceLinks: SourceLinks;
  reserveUrl: string | null;
  callPhone: string | null;
  advisories: string[];
  badges: string[];
}

export interface ReservationLink {
  label: string;
  url: string | null;
}

export interface PlaceDetail extends PlaceSummary {
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
  maxWalkMinutes: number | null;
  priceBands: string[];
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
  state: 'open' | 'closingSoon' | 'closed';
  label: string;
  detail: string;
  closesAt: string | null;
  opensAt: string | null;
  lastOrderAt: string | null;
}
