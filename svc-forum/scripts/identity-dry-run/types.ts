/**
 * Shared types for the identity mapping dry-run tool.
 */

export type IdentityCategory = 'uuid' | 'business-agent-id' | 'empty' | 'unknown';

export interface IdentityValue {
  value: string;
  category: IdentityCategory;
  table: string;
  field: string;
  recordId: string;
}

export interface ForumIdentityField {
  table: string;
  column: string;
  sample: IdentityValue[];
  totalCount: number;
  distinctCount: number;
  uuidCount: number;
  businessAgentIdCount: number;
  emptyCount: number;
  unknownCount: number;
}

export interface MixedIdentityThread {
  threadId: string;
  threadTitle: string;
  identityValues: { source: string; value: string; category: IdentityCategory }[];
}

export interface ParticipantMessageMismatch {
  threadId: string;
  threadTitle: string;
  participantAgentId: string;
  messageAuthorIds: string[];
}

export interface AdcUser {
  id: string;
  name: string;
  role: string;
  agentId: string | null;
}

export interface AdcInventory {
  totalUsers: number;
  roleAgentCount: number;
  agentIdPopulated: number;
  agentIdMissing: number;
  duplicateAgentIds: { agentId: string; userIds: string[] }[];
  sameAgentIdMultipleUuids: { agentId: string; uuids: string[] }[];
  specificAgents: { name: string; id: string; agentId: string | null }[];
  /** All ADC users (for mapping). UUIDs masked in console output. */
  users: AdcUser[];
}

export type MappingStatus =
  | 'exact'
  | 'missing-source-agent-id'
  | 'missing-adc-agent'
  | 'duplicate-adc-agent-id'
  | 'multiple-candidate'
  | 'historical-business-id'
  | 'unknown';

export interface MappingResult {
  forumIdentityValue: string;
  forumTable: string;
  forumField: string;
  mappingStatus: MappingStatus;
  mappedToAgentId?: string;
  note?: string;
}

export interface DryRunReport {
  generatedAt: string;
  identityMode: string;
  forumInventory: {
    totalIdentityValues: number;
    fields: ForumIdentityField[];
    mixedIdentityThreads: MixedIdentityThread[];
    participantMessageMismatches: ParticipantMessageMismatch[];
  };
  adcInventory: AdcInventory;
  mappingResults: MappingResult[];
  risks: string[];
  canSwitch: boolean;
  summary: {
    totalForumIdentities: number;
    uuidIdentities: number;
    businessAgentIds: number;
    emptyNullIdentities: number;
    unknownIdentities: number;
    exactMappings: number;
    missingAgentIdMappings: number;
    missingAdcMappings: number;
    duplicateMappings: number;
    mixedThreadCount: number;
    mismatchCount: number;
    totalActiveReviewers: number;
    mappableReviewers: number;
    canSwitch: boolean;
  };
}
