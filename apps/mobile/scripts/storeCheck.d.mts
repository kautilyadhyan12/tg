export const STORE_ID: string;
export const ANDROID_16: number;
export const PAGE_16_KB: number;
export const NEVER_IN_THE_STORE: string[];

export interface Badging {
  id: string | null;
  versionCode: string | null;
  versionName: string | null;
  targetSdk: number | null;
  debuggable: boolean;
}

export interface StoreFacts {
  versionCode: string;
  versionName: string;
  badging: Badging;
  permissions: string[];
  cleartext: boolean;
  builtIn: { apiUrl?: unknown; webUrl?: unknown; copyName?: unknown; package?: unknown } | null;
  uploadKey: string;
  apkSigners: string[];
  aabSigners: string[];
  apkAligned: boolean;
  libraries: { name: string; alignments: number[] | null }[];
}

export function loadAlignments(bytes: Uint8Array): number[] | null;
export function readBadging(text: string): Badging;
export function declaredPermissions(xmltree: string): string[];
export function fingerprintsIn(text: string): string[];
export function storeFaults(facts: StoreFacts): string[];
export function gather(input: { folder: string; versionCode: string; versionName: string; keyStore: string; keyAlias: string }): StoreFacts;
