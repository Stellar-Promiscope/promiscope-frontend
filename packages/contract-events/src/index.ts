import type { xdr } from '@stellar/stellar-sdk';
import {
  CONTRACT_VERSION,
  decodeV1HorizonOperation,
  decodeV1SorobanEvent,
  type DecodedSchemaEvent,
  type EventType,
} from './schema/v1';

export { CONTRACT_VERSION, decodeV1HorizonOperation, decodeV1SorobanEvent } from './schema/v1';
export type { DecodedSchemaEvent, EventType } from './schema/v1';

export interface VersionedEvent extends DecodedSchemaEvent {
  version: number;
}

export interface RawSorobanEventInput {
  topic: xdr.ScVal[];
  value?: xdr.ScVal;
  contractVersion?: number;
}

export function decodeSorobanEvent(input: RawSorobanEventInput): VersionedEvent {
  if ((input.contractVersion ?? CONTRACT_VERSION) === CONTRACT_VERSION) {
    return decodeV1SorobanEvent(input.topic, input.value);
  }
  return {
    type: 'unknown',
    version: input.contractVersion ?? -1,
    data: {
      rawTopicXdr: input.topic.map((topic) => topic.toXDR('base64')),
      rawValueXdr: input.value?.toXDR('base64') ?? null,
      reason: 'unsupported_contract_version',
    },
  };
}

export interface HorizonOperationInput {
  operation: Record<string, unknown>;
  contractVersion?: number;
}

export function decodeHorizonOperation(
  input: HorizonOperationInput,
): VersionedEvent {
  if ((input.contractVersion ?? CONTRACT_VERSION) === CONTRACT_VERSION) {
    return decodeV1HorizonOperation(input.operation);
  }
  return {
    type: 'unknown',
    version: input.contractVersion ?? -1,
    data: {
      rawOperation: input.operation,
      reason: 'unsupported_contract_version',
    },
  };
}
