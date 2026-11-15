export const GOOGLE_TYPES: Record<string, string[]>;
export const GOOGLE_PURPOSES: string[];
export const NOT_SHARING: { serviceProvider: string; userInitiated: string };

export interface Collected {
  type: string;
  required: boolean;
  ephemeral: boolean;
  purposes: string[];
  what: string;
}
export type Answer = string[] | { none: string };

export const COLLECTED: Collected[];
export const OUTSIDE: Record<string, { exception: string | null; why: string }>;
export const BUSINESSES: { exception: string; why: string };
export const POLICY_PARTS: Record<string, Answer>;
export const PERMISSIONS: Record<string, Answer>;

export interface Answers {
  COLLECTED: Collected[];
  PERMISSIONS: Record<string, Answer>;
  POLICY_PARTS: Record<string, Answer>;
  OUTSIDE: Record<string, { exception: string | null; why: string }>;
}
export function dataSafetyFaults(input: { permissions: string[]; policyParts: string[]; outsideIds: string[] }, answers?: Answers): string[];
