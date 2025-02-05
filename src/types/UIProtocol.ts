import { JsonObject } from './JsonType';

export enum Protocol {
  UI = 'ui',
}

export enum ProtocolVersion {
  '0.0.1' = '0.0.1',
}

export enum ProtocolCommand {
  LIST_CHARGING_STATIONS = 'listChargingStations',
  START_TRANSACTION = 'startTransaction',
  STOP_TRANSACTION = 'stopTransaction',
  UNKNOWN = 'unknown',
}

export type ProtocolRequest = [ProtocolCommand, JsonObject];

export type ProtocolRequestHandler = (
  payload: JsonObject
) => void | Promise<void> | JsonObject | Promise<JsonObject>;
