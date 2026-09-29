import { scValToNative, xdr } from '@stellar/stellar-sdk';

export const CONTRACT_VERSION = 1 as const;

export type EventType =
  | 'player_registered'
  | 'milestone_approved'
  | 'milestone_revoked'
  | 'scout_subscribed'
  | 'player_contacted'
  | 'trial_offer_logged'
  | 'fees_withdrawn'
  | 'unknown';

export interface DecodedSchemaEvent {
  type: EventType;
  version: number;
  data: Record<string, unknown>;
}

interface EventDefinition {
  topic: string;
  decode(value: unknown): Record<string, unknown>;
}

function decodeObject(value: unknown, topic: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Event "${topic}" payload must be a map or struct`);
  }
  return value as Record<string, unknown>;
}

function define(topic: EventType): EventDefinition {
  return {
    topic,
    decode: (value) => decodeObject(value, topic),
  };
}

/** The v1 contract event topics and their payload decoders. */
export const EVENT_SCHEMA_V1: Record<Exclude<EventType, 'unknown'>, EventDefinition> = {
  player_registered: define('player_registered'),
  milestone_approved: define('milestone_approved'),
  milestone_revoked: define('milestone_revoked'),
  scout_subscribed: define('scout_subscribed'),
  player_contacted: define('player_contacted'),
  trial_offer_logged: define('trial_offer_logged'),
  fees_withdrawn: define('fees_withdrawn'),
};

function topicName(topic: xdr.ScVal | undefined): string | null {
  if (!topic) return null;
  try {
    const native = scValToNative(topic);
    return typeof native === 'string' ? native : null;
  } catch {
    return null;
  }
}

export function decodeV1SorobanEvent(
  topics: xdr.ScVal[],
  value: xdr.ScVal | undefined,
): DecodedSchemaEvent {
  const name = topicName(topics[0]);
  const definition = name
    ? EVENT_SCHEMA_V1[name as Exclude<EventType, 'unknown'>]
    : undefined;

  if (!definition) {
    return {
      type: 'unknown',
      version: CONTRACT_VERSION,
      data: {
        rawTopicXdr: topics.map((topic) => topic.toXDR('base64')),
        rawValueXdr: value?.toXDR('base64') ?? null,
        topic: name,
      },
    };
  }

  return {
    type: name as Exclude<EventType, 'unknown'>,
    version: CONTRACT_VERSION,
    data: definition.decode(value ? scValToNative(value) : {}),
  };
}

const HORIZON_FUNCTIONS: Record<string, Exclude<EventType, 'unknown'>> = {
  register_player: 'player_registered',
  approve_milestone: 'milestone_approved',
  revoke_milestone: 'milestone_revoked',
  subscribe: 'scout_subscribed',
  pay_to_contact: 'player_contacted',
  log_trial_offer: 'trial_offer_logged',
  withdraw_fees: 'fees_withdrawn',
};

/** Decodes the same v1 schema from a Horizon operation fallback. */
export function decodeV1HorizonOperation(
  operation: Record<string, unknown>,
): DecodedSchemaEvent {
  const functionName = String(operation.function ?? '');
  const type =
    HORIZON_FUNCTIONS[functionName] ??
    Object.entries(HORIZON_FUNCTIONS).find(([name]) =>
      functionName.includes(name),
    )?.[1];
  if (!type) {
    return {
      type: 'unknown',
      version: CONTRACT_VERSION,
      data: { rawOperation: operation },
    };
  }

  return {
    type,
    version: CONTRACT_VERSION,
    data: { ...operation },
  };
}
