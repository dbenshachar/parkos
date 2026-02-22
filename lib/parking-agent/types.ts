export const PARKING_NOTIFICATION_TYPES = [
  "payment_confirmed",
  "post_payment_info",
  "renew_reminder",
  "parking_expired",
] as const;

export type ParkingNotificationType = (typeof PARKING_NOTIFICATION_TYPES)[number];

export const PARKING_SESSION_STATUSES = [
  "captured",
  "active",
  "renewed",
  "expired",
  "cancelled",
] as const;

export type ParkingSessionStatus = (typeof PARKING_SESSION_STATUSES)[number];

export type ParkingRulesRundown = {
  headline: string;
  bullets: string[];
  timeLimitSummary: string;
  confidence: "high" | "medium" | "low";
  citations: string[];
};

export type ParkingLocalFacts = {
  category: "paid" | "residential" | "none";
  matchType: "inside" | "nearest" | "none";
  distanceMeters: number | null;
  zoneNumber: string | null;
  rate: string | null;
  description: string | null;
  district: string | null;
  hours: string | null;
  message: string;
  warnings: string[];
  source: "paybyphone-zones" | "residential-zones" | "none";
};

export type ParkingOfficialFact = {
  sourceUrl: string;
  excerpt: string;
  fetchedAtIso: string;
  fromCache: boolean;
};

export type ParkingOfficialFacts = {
  source: "live_web" | "cache" | "none";
  notices: string[];
  facts: ParkingOfficialFact[];
};

export type ParkingContext = {
  location: {
    lat: number;
    lng: number;
    accuracyMeters: number | null;
  };
  session: {
    zoneNumber: string | null;
    rate: string | null;
    category: ParkingLocalFacts["category"];
  };
  localFacts: ParkingLocalFacts;
  officialFacts: ParkingOfficialFacts;
  nowLocalIso: string;
  timezone: "America/Los_Angeles";
};

export type ParkingSessionRow = {
  id: string;
  profile_id: string;
  status: ParkingSessionStatus;
  parked_lat: number;
  parked_lng: number;
  parked_accuracy_meters: number | null;
  captured_zone_number: string | null;
  captured_rate: string | null;
  captured_category: "paid" | "residential" | "none";
  confirmed_zone_number: string | null;
  duration_minutes: number | null;
  starts_at: string | null;
  expires_at: string | null;
  resume_token: string;
  rules_context_json: ParkingContext | null;
  rules_rundown_json: ParkingRulesRundown | null;
  renew_parent_session_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ParkingNotificationStatus = "queued" | "sending" | "sent" | "failed" | "skipped";

export type ParkingNotificationRow = {
  id: string;
  parking_session_id: string;
  profile_id: string;
  notification_type: ParkingNotificationType;
  scheduled_at: string;
  sent_at: string | null;
  status: ParkingNotificationStatus;
  attempt_count: number;
  last_error: string | null;
  twilio_message_sid: string | null;
  message_text: string | null;
  created_at: string;
  updated_at: string;
};

export type ParkingRuleCacheRow = {
  id: string;
  cache_key: string;
  source_url: string;
  facts_json: {
    excerpt: string;
  };
  fetched_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};
