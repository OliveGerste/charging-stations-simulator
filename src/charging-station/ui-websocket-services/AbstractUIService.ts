import { ProtocolCommand, ProtocolRequestHandler } from '../../types/UIProtocol';

import BaseError from '../../exception/BaseError';
import { JsonObject } from '../../types/JsonType';
import UIWebSocketServer from '../UIWebSocketServer';
import logger from '../../utils/Logger';

export default abstract class AbstractUIService {
  protected readonly uiWebSocketServer: UIWebSocketServer;
  protected readonly messageHandlers: Map<ProtocolCommand, ProtocolRequestHandler>;

  constructor(uiWebSocketServer: UIWebSocketServer) {
    this.uiWebSocketServer = uiWebSocketServer;
    this.messageHandlers = new Map<ProtocolCommand, ProtocolRequestHandler>([
      [ProtocolCommand.LIST_CHARGING_STATIONS, this.handleListChargingStations.bind(this)],
    ]);
  }

  public async messageHandler(command: ProtocolCommand, payload: JsonObject): Promise<void> {
    let messageResponse: JsonObject;
    if (this.messageHandlers.has(command)) {
      try {
        // Call the method to build the message response
        messageResponse = (await this.messageHandlers.get(command)(payload)) as JsonObject;
      } catch (error) {
        // Log
        logger.error(this.uiWebSocketServer.logPrefix() + ' Handle message error: %j', error);
        throw error;
      }
    } else {
      // Throw exception
      throw new BaseError(
        `${command} is not implemented to handle message payload ${JSON.stringify(
          payload,
          null,
          2
        )}`
      );
    }
    // Send the built message response
    this.uiWebSocketServer.broadcastToClients(this.buildProtocolMessage(command, messageResponse));
  }

  protected buildProtocolMessage(command: ProtocolCommand, payload: JsonObject): string {
    return JSON.stringify([command, payload]);
  }

  private handleListChargingStations(): string[] {
    return Array.from(this.uiWebSocketServer.chargingStations);
  }
}
