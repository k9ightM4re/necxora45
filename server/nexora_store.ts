import fs from 'fs';
import path from 'path';

export interface MediaRecord {
  id: string;
  ownerUid: string;
  kind: 'avatar' | 'cover' | 'post' | 'story' | 'reel' | 'dm' | 'general';
  mimeType: string;
  ext: string;
  size: number;
  fileName: string;
  createdAtMs: number;
}

export interface GeoUserLocation {
  uid: string;
  displayName: string;
  username: string;
  lat: number;
  lon: number;
  city: string;
  discoverable: boolean;
  updatedAtMs: number;
}

export interface LocalDiscoveryEvent {
  id: string;
  title: string;
  description: string;
  category: string;
  city: string;
  lat: number;
  lon: number;
  startsAt: string;
  hostUid: string;
  hostName: string;
  rsvpUids: string[];
  createdAtMs: number;
}

export interface UserPreferencesSync {
  uid: string;
  closeFriendUids: string[];
  mutedUids: string[];
  quietMode: boolean;
  notifyDms: boolean;
  notifyMentions: boolean;
  notifyLikes: boolean;
  notifyFollows: boolean;
  updatedAtMs: number;
}

export interface PushSubscriptionEntry {
  endpoint: string;
  keys?: Record<string, string>;
  createdAtMs: number;
}

interface StoreData {
  media: Record<string, MediaRecord>;
  locations: Record<string, GeoUserLocation>;
  events: Record<string, LocalDiscoveryEvent>;
  preferences: Record<string, UserPreferencesSync>;
  pushSubscriptions: Record<string, PushSubscriptionEntry[]>;
}

const DATA_DIR = path.resolve(process.cwd(), '.data');
const STORE_PATH = path.join(DATA_DIR, 'nexora_store.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

function ensureDirs(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true, mode: 0o700 });
  }
}

export function roundCoarseCoordinate(value: number): number {
  return Math.round(Number(value) * 100) / 100;
}

export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

class NexoraStore {
  private data: StoreData = {
    media: {},
    locations: {},
    events: {},
    preferences: {},
    pushSubscriptions: {},
  };

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      ensureDirs();
      if (!fs.existsSync(STORE_PATH)) return;
      const raw = fs.readFileSync(STORE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        this.data = {
          media: parsed.media || {},
          locations: parsed.locations || {},
          events: parsed.events || {},
          preferences: parsed.preferences || {},
          pushSubscriptions: parsed.pushSubscriptions || {},
        };
      }
    } catch {
      // Preserve clean fallback state if store hasn't initialized yet
    }
  }

  private persist(): void {
    try {
      ensureDirs();
      const tmp = `${STORE_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, STORE_PATH);
    } catch {
      // Non-fatal persistence guard
    }
  }

  saveMedia(record: MediaRecord): MediaRecord {
    this.data.media[record.id] = record;
    this.persist();
    return record;
  }

  getMedia(id: string): MediaRecord | null {
    return this.data.media[id] || null;
  }

  deleteMedia(id: string): boolean {
    if (!this.data.media[id]) return false;
    delete this.data.media[id];
    this.persist();
    return true;
  }

  upsertLocation(entry: GeoUserLocation): GeoUserLocation {
    const clean: GeoUserLocation = {
      ...entry,
      lat: roundCoarseCoordinate(entry.lat),
      lon: roundCoarseCoordinate(entry.lon),
      updatedAtMs: Date.now(),
    };
    this.data.locations[entry.uid] = clean;
    this.persist();
    return clean;
  }

  listNearbyUsers(lat: number, lon: number, radiusKm: number, excludeUid: string) {
    const out: Array<{
      uid: string;
      displayName: string;
      username: string;
      city: string;
      distanceKm: number;
      updatedAtMs: number;
    }> = [];
    for (const loc of Object.values(this.data.locations)) {
      if (!loc.discoverable || loc.uid === excludeUid) continue;
      const distanceKm = haversineDistanceKm(lat, lon, loc.lat, loc.lon);
      if (distanceKm <= radiusKm) {
        out.push({
          uid: loc.uid,
          displayName: loc.displayName,
          username: loc.username,
          city: loc.city,
          distanceKm,
          updatedAtMs: loc.updatedAtMs,
        });
      }
    }
    return out.sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 50);
  }

  createLocalEvent(event: LocalDiscoveryEvent): LocalDiscoveryEvent {
    const clean: LocalDiscoveryEvent = {
      ...event,
      lat: roundCoarseCoordinate(event.lat),
      lon: roundCoarseCoordinate(event.lon),
    };
    this.data.events[clean.id] = clean;
    this.persist();
    return clean;
  }

  listNearbyEvents(lat: number | null, lon: number | null, radiusKm: number) {
    const items = Object.values(this.data.events).map((ev) => ({
      ...ev,
      distanceKm:
        lat !== null && lon !== null ? haversineDistanceKm(lat, lon, ev.lat, ev.lon) : null,
    }));
    const filtered =
      lat !== null && lon !== null
        ? items.filter((ev) => (ev.distanceKm ?? Infinity) <= radiusKm)
        : items;
    return filtered.sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, 40);
  }

  toggleEventRsvp(eventId: string, uid: string): LocalDiscoveryEvent | null {
    const ev = this.data.events[eventId];
    if (!ev) return null;
    const set = new Set(ev.rsvpUids || []);
    if (set.has(uid)) {
      set.delete(uid);
    } else {
      set.add(uid);
    }
    ev.rsvpUids = Array.from(set).slice(0, 500);
    this.persist();
    return ev;
  }

  getUserPreferences(uid: string): UserPreferencesSync {
    return (
      this.data.preferences[uid] || {
        uid,
        closeFriendUids: [],
        mutedUids: [],
        quietMode: false,
        notifyDms: true,
        notifyMentions: true,
        notifyLikes: true,
        notifyFollows: true,
        updatedAtMs: 0,
      }
    );
  }

  upsertUserPreferences(
    uid: string,
    patch: Partial<Omit<UserPreferencesSync, 'uid' | 'updatedAtMs'>>
  ): UserPreferencesSync {
    const cur = this.getUserPreferences(uid);
    const next: UserPreferencesSync = {
      ...cur,
      ...patch,
      uid,
      closeFriendUids: Array.isArray(patch.closeFriendUids)
        ? Array.from(new Set(patch.closeFriendUids.map((s) => String(s).slice(0, 128)))).slice(0, 200)
        : cur.closeFriendUids,
      mutedUids: Array.isArray(patch.mutedUids)
        ? Array.from(new Set(patch.mutedUids.map((s) => String(s).slice(0, 128)))).slice(0, 200)
        : cur.mutedUids,
      updatedAtMs: Date.now(),
    };
    this.data.preferences[uid] = next;
    this.persist();
    return next;
  }

  savePushSubscription(uid: string, sub: PushSubscriptionEntry): void {
    const existing = this.data.pushSubscriptions[uid] || [];
    const deduped = existing.filter((s) => s.endpoint !== sub.endpoint);
    deduped.push(sub);
    this.data.pushSubscriptions[uid] = deduped.slice(-10);
    this.persist();
  }
}

export const nexoraStore = new NexoraStore();
