// Partial Copyright Jerome Benoit. 2021. All Rights Reserved.

import {
  ChangeAvailabilityRequest,
  ChangeConfigurationRequest,
  ClearChargingProfileRequest,
  DiagnosticsStatusNotificationRequest,
  GetConfigurationRequest,
  GetDiagnosticsRequest,
  MessageTrigger,
  OCPP16AvailabilityType,
  OCPP16BootNotificationRequest,
  OCPP16HeartbeatRequest,
  OCPP16IncomingRequestCommand,
  OCPP16RequestCommand,
  OCPP16StatusNotificationRequest,
  OCPP16TriggerMessageRequest,
  RemoteStartTransactionRequest,
  RemoteStopTransactionRequest,
  ResetRequest,
  SetChargingProfileRequest,
  UnlockConnectorRequest,
} from '../../../types/ocpp/1.6/Requests';
import {
  ChangeAvailabilityResponse,
  ChangeConfigurationResponse,
  ClearChargingProfileResponse,
  DiagnosticsStatusNotificationResponse,
  GetConfigurationResponse,
  GetDiagnosticsResponse,
  OCPP16BootNotificationResponse,
  OCPP16HeartbeatResponse,
  OCPP16StatusNotificationResponse,
  OCPP16TriggerMessageResponse,
  SetChargingProfileResponse,
  UnlockConnectorResponse,
} from '../../../types/ocpp/1.6/Responses';
import {
  ChargingProfilePurposeType,
  OCPP16ChargingProfile,
} from '../../../types/ocpp/1.6/ChargingProfile';
import { Client, FTPResponse } from 'basic-ftp';
import {
  OCPP16AuthorizationStatus,
  OCPP16AuthorizeRequest,
  OCPP16AuthorizeResponse,
  OCPP16StartTransactionRequest,
  OCPP16StartTransactionResponse,
  OCPP16StopTransactionReason,
  OCPP16StopTransactionRequest,
  OCPP16StopTransactionResponse,
} from '../../../types/ocpp/1.6/Transaction';
import {
  OCPP16MeterValuesRequest,
  OCPP16MeterValuesResponse,
} from '../../../types/ocpp/1.6/MeterValues';
import {
  OCPP16StandardParametersKey,
  OCPP16SupportedFeatureProfiles,
} from '../../../types/ocpp/1.6/Configuration';

import type ChargingStation from '../../ChargingStation';
import Constants from '../../../utils/Constants';
import { DefaultResponse } from '../../../types/ocpp/Responses';
import { ErrorType } from '../../../types/ocpp/ErrorType';
import { IncomingRequestHandler } from '../../../types/ocpp/Requests';
import { JsonObject } from '../../../types/JsonType';
import { OCPP16ChargePointErrorCode } from '../../../types/ocpp/1.6/ChargePointErrorCode';
import { OCPP16ChargePointStatus } from '../../../types/ocpp/1.6/ChargePointStatus';
import { OCPP16DiagnosticsStatus } from '../../../types/ocpp/1.6/DiagnosticsStatus';
import { OCPP16ServiceUtils } from './OCPP16ServiceUtils';
import { OCPPConfigurationKey } from '../../../types/ocpp/Configuration';
import OCPPError from '../../../exception/OCPPError';
import OCPPIncomingRequestService from '../OCPPIncomingRequestService';
import { URL } from 'url';
import Utils from '../../../utils/Utils';
import fs from 'fs';
import logger from '../../../utils/Logger';
import path from 'path';
import tar from 'tar';

const moduleName = 'OCPP16IncomingRequestService';

export default class OCPP16IncomingRequestService extends OCPPIncomingRequestService {
  private incomingRequestHandlers: Map<OCPP16IncomingRequestCommand, IncomingRequestHandler>;

  public constructor(chargingStation: ChargingStation) {
    if (new.target?.name === moduleName) {
      throw new TypeError(`Cannot construct ${new.target?.name} instances directly`);
    }
    super(chargingStation);
    this.incomingRequestHandlers = new Map<OCPP16IncomingRequestCommand, IncomingRequestHandler>([
      [OCPP16IncomingRequestCommand.RESET, this.handleRequestReset.bind(this)],
      [OCPP16IncomingRequestCommand.CLEAR_CACHE, this.handleRequestClearCache.bind(this)],
      [OCPP16IncomingRequestCommand.UNLOCK_CONNECTOR, this.handleRequestUnlockConnector.bind(this)],
      [
        OCPP16IncomingRequestCommand.GET_CONFIGURATION,
        this.handleRequestGetConfiguration.bind(this),
      ],
      [
        OCPP16IncomingRequestCommand.CHANGE_CONFIGURATION,
        this.handleRequestChangeConfiguration.bind(this),
      ],
      [
        OCPP16IncomingRequestCommand.SET_CHARGING_PROFILE,
        this.handleRequestSetChargingProfile.bind(this),
      ],
      [
        OCPP16IncomingRequestCommand.CLEAR_CHARGING_PROFILE,
        this.handleRequestClearChargingProfile.bind(this),
      ],
      [
        OCPP16IncomingRequestCommand.CHANGE_AVAILABILITY,
        this.handleRequestChangeAvailability.bind(this),
      ],
      [
        OCPP16IncomingRequestCommand.REMOTE_START_TRANSACTION,
        this.handleRequestRemoteStartTransaction.bind(this),
      ],
      [
        OCPP16IncomingRequestCommand.REMOTE_STOP_TRANSACTION,
        this.handleRequestRemoteStopTransaction.bind(this),
      ],
      [OCPP16IncomingRequestCommand.GET_DIAGNOSTICS, this.handleRequestGetDiagnostics.bind(this)],
      [OCPP16IncomingRequestCommand.TRIGGER_MESSAGE, this.handleRequestTriggerMessage.bind(this)],
    ]);
  }

  public async incomingRequestHandler(
    messageId: string,
    commandName: OCPP16IncomingRequestCommand,
    commandPayload: JsonObject
  ): Promise<void> {
    let response: JsonObject;
    if (
      this.chargingStation.getOcppStrictCompliance() &&
      this.chargingStation.isInPendingState() &&
      (commandName === OCPP16IncomingRequestCommand.REMOTE_START_TRANSACTION ||
        commandName === OCPP16IncomingRequestCommand.REMOTE_STOP_TRANSACTION)
    ) {
      throw new OCPPError(
        ErrorType.SECURITY_ERROR,
        `${commandName} cannot be issued to handle request payload ${JSON.stringify(
          commandPayload,
          null,
          2
        )} while the charging station is in pending state on the central server`,
        commandName
      );
    }
    if (
      this.chargingStation.isRegistered() ||
      (!this.chargingStation.getOcppStrictCompliance() && this.chargingStation.isInUnknownState())
    ) {
      if (this.incomingRequestHandlers.has(commandName)) {
        try {
          // Call the method to build the response
          response = await this.incomingRequestHandlers.get(commandName)(commandPayload);
        } catch (error) {
          // Log
          logger.error(this.chargingStation.logPrefix() + ' Handle request error: %j', error);
          throw error;
        }
      } else {
        // Throw exception
        throw new OCPPError(
          ErrorType.NOT_IMPLEMENTED,
          `${commandName} is not implemented to handle request payload ${JSON.stringify(
            commandPayload,
            null,
            2
          )}`,
          commandName
        );
      }
    } else {
      throw new OCPPError(
        ErrorType.SECURITY_ERROR,
        `${commandName} cannot be issued to handle request payload ${JSON.stringify(
          commandPayload,
          null,
          2
        )} while the charging station is not registered on the central server.`,
        commandName
      );
    }
    // Send the built response
    await this.chargingStation.ocppRequestService.sendResponse(messageId, response, commandName);
  }

  // Simulate charging station restart
  private handleRequestReset(commandPayload: ResetRequest): DefaultResponse {
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    setImmediate(async (): Promise<void> => {
      await this.chargingStation.reset(
        (commandPayload.type + 'Reset') as OCPP16StopTransactionReason
      );
    });
    logger.info(
      `${this.chargingStation.logPrefix()} ${
        commandPayload.type
      } reset command received, simulating it. The station will be back online in ${Utils.formatDurationMilliSeconds(
        this.chargingStation.stationInfo.resetTime
      )}`
    );
    return Constants.OCPP_RESPONSE_ACCEPTED;
  }

  private handleRequestClearCache(): DefaultResponse {
    return Constants.OCPP_RESPONSE_ACCEPTED;
  }

  private async handleRequestUnlockConnector(
    commandPayload: UnlockConnectorRequest
  ): Promise<UnlockConnectorResponse> {
    const connectorId = commandPayload.connectorId;
    if (connectorId === 0) {
      logger.error(
        this.chargingStation.logPrefix() + ' Trying to unlock connector ' + connectorId.toString()
      );
      return Constants.OCPP_RESPONSE_UNLOCK_NOT_SUPPORTED;
    }
    if (this.chargingStation.getConnectorStatus(connectorId)?.transactionStarted) {
      const transactionId = this.chargingStation.getConnectorStatus(connectorId).transactionId;
      if (
        this.chargingStation.getBeginEndMeterValues() &&
        this.chargingStation.getOcppStrictCompliance() &&
        !this.chargingStation.getOutOfOrderEndMeterValues()
      ) {
        // FIXME: Implement OCPP version agnostic helpers
        const transactionEndMeterValue = OCPP16ServiceUtils.buildTransactionEndMeterValue(
          this.chargingStation,
          connectorId,
          this.chargingStation.getEnergyActiveImportRegisterByTransactionId(transactionId)
        );
        await this.chargingStation.ocppRequestService.requestHandler<
          OCPP16MeterValuesRequest,
          OCPP16MeterValuesResponse
        >(OCPP16RequestCommand.METER_VALUES, {
          connectorId,
          transactionId,
          meterValue: transactionEndMeterValue,
        });
      }
      const stopResponse = await this.chargingStation.ocppRequestService.requestHandler<
        OCPP16StopTransactionRequest,
        OCPP16StopTransactionResponse
      >(OCPP16RequestCommand.STOP_TRANSACTION, {
        transactionId,
        meterStop: this.chargingStation.getEnergyActiveImportRegisterByTransactionId(transactionId),
        idTag: this.chargingStation.getTransactionIdTag(transactionId),
        reason: OCPP16StopTransactionReason.UNLOCK_COMMAND,
      });
      if (stopResponse.idTagInfo?.status === OCPP16AuthorizationStatus.ACCEPTED) {
        return Constants.OCPP_RESPONSE_UNLOCKED;
      }
      return Constants.OCPP_RESPONSE_UNLOCK_FAILED;
    }
    await this.chargingStation.ocppRequestService.requestHandler<
      OCPP16StatusNotificationRequest,
      OCPP16StatusNotificationResponse
    >(OCPP16RequestCommand.STATUS_NOTIFICATION, {
      connectorId,
      status: OCPP16ChargePointStatus.AVAILABLE,
      errorCode: OCPP16ChargePointErrorCode.NO_ERROR,
    });
    this.chargingStation.getConnectorStatus(connectorId).status = OCPP16ChargePointStatus.AVAILABLE;
    return Constants.OCPP_RESPONSE_UNLOCKED;
  }

  private handleRequestGetConfiguration(
    commandPayload: GetConfigurationRequest
  ): GetConfigurationResponse {
    const configurationKey: OCPPConfigurationKey[] = [];
    const unknownKey: string[] = [];
    if (Utils.isEmptyArray(commandPayload.key)) {
      for (const configuration of this.chargingStation.ocppConfiguration.configurationKey) {
        if (Utils.isUndefined(configuration.visible)) {
          configuration.visible = true;
        }
        if (!configuration.visible) {
          continue;
        }
        configurationKey.push({
          key: configuration.key,
          readonly: configuration.readonly,
          value: configuration.value,
        });
      }
    } else {
      for (const key of commandPayload.key) {
        const keyFound = this.chargingStation.getConfigurationKey(key);
        if (keyFound) {
          if (Utils.isUndefined(keyFound.visible)) {
            keyFound.visible = true;
          }
          if (!keyFound.visible) {
            continue;
          }
          configurationKey.push({
            key: keyFound.key,
            readonly: keyFound.readonly,
            value: keyFound.value,
          });
        } else {
          unknownKey.push(key);
        }
      }
    }
    return {
      configurationKey,
      unknownKey,
    };
  }

  private handleRequestChangeConfiguration(
    commandPayload: ChangeConfigurationRequest
  ): ChangeConfigurationResponse {
    // JSON request fields type sanity check
    if (!Utils.isString(commandPayload.key)) {
      logger.error(
        `${this.chargingStation.logPrefix()} ${
          OCPP16IncomingRequestCommand.CHANGE_CONFIGURATION
        } request key field is not a string:`,
        commandPayload
      );
    }
    if (!Utils.isString(commandPayload.value)) {
      logger.error(
        `${this.chargingStation.logPrefix()} ${
          OCPP16IncomingRequestCommand.CHANGE_CONFIGURATION
        } request value field is not a string:`,
        commandPayload
      );
    }
    const keyToChange = this.chargingStation.getConfigurationKey(commandPayload.key, true);
    if (!keyToChange) {
      return Constants.OCPP_CONFIGURATION_RESPONSE_NOT_SUPPORTED;
    } else if (keyToChange && keyToChange.readonly) {
      return Constants.OCPP_CONFIGURATION_RESPONSE_REJECTED;
    } else if (keyToChange && !keyToChange.readonly) {
      let valueChanged = false;
      if (keyToChange.value !== commandPayload.value) {
        this.chargingStation.setConfigurationKeyValue(
          commandPayload.key,
          commandPayload.value,
          true
        );
        valueChanged = true;
      }
      let triggerHeartbeatRestart = false;
      if (keyToChange.key === OCPP16StandardParametersKey.HeartBeatInterval && valueChanged) {
        this.chargingStation.setConfigurationKeyValue(
          OCPP16StandardParametersKey.HeartbeatInterval,
          commandPayload.value
        );
        triggerHeartbeatRestart = true;
      }
      if (keyToChange.key === OCPP16StandardParametersKey.HeartbeatInterval && valueChanged) {
        this.chargingStation.setConfigurationKeyValue(
          OCPP16StandardParametersKey.HeartBeatInterval,
          commandPayload.value
        );
        triggerHeartbeatRestart = true;
      }
      if (triggerHeartbeatRestart) {
        this.chargingStation.restartHeartbeat();
      }
      if (keyToChange.key === OCPP16StandardParametersKey.WebSocketPingInterval && valueChanged) {
        this.chargingStation.restartWebSocketPing();
      }
      if (keyToChange.reboot) {
        return Constants.OCPP_CONFIGURATION_RESPONSE_REBOOT_REQUIRED;
      }
      return Constants.OCPP_CONFIGURATION_RESPONSE_ACCEPTED;
    }
  }

  private handleRequestSetChargingProfile(
    commandPayload: SetChargingProfileRequest
  ): SetChargingProfileResponse {
    if (
      !OCPP16ServiceUtils.checkFeatureProfile(
        this.chargingStation,
        OCPP16SupportedFeatureProfiles.SmartCharging,
        OCPP16IncomingRequestCommand.SET_CHARGING_PROFILE
      )
    ) {
      return Constants.OCPP_SET_CHARGING_PROFILE_RESPONSE_NOT_SUPPORTED;
    }
    if (!this.chargingStation.getConnectorStatus(commandPayload.connectorId)) {
      logger.error(
        `${this.chargingStation.logPrefix()} Trying to set charging profile(s) to a non existing connector Id ${
          commandPayload.connectorId
        }`
      );
      return Constants.OCPP_SET_CHARGING_PROFILE_RESPONSE_REJECTED;
    }
    if (
      commandPayload.csChargingProfiles.chargingProfilePurpose ===
        ChargingProfilePurposeType.CHARGE_POINT_MAX_PROFILE &&
      commandPayload.connectorId !== 0
    ) {
      return Constants.OCPP_SET_CHARGING_PROFILE_RESPONSE_REJECTED;
    }
    if (
      commandPayload.csChargingProfiles.chargingProfilePurpose ===
        ChargingProfilePurposeType.TX_PROFILE &&
      (commandPayload.connectorId === 0 ||
        !this.chargingStation.getConnectorStatus(commandPayload.connectorId)?.transactionStarted)
    ) {
      return Constants.OCPP_SET_CHARGING_PROFILE_RESPONSE_REJECTED;
    }
    this.chargingStation.setChargingProfile(
      commandPayload.connectorId,
      commandPayload.csChargingProfiles
    );
    logger.debug(
      `${this.chargingStation.logPrefix()} Charging profile(s) set on connector id ${
        commandPayload.connectorId
      }, dump their stack: %j`,
      this.chargingStation.getConnectorStatus(commandPayload.connectorId).chargingProfiles
    );
    return Constants.OCPP_SET_CHARGING_PROFILE_RESPONSE_ACCEPTED;
  }

  private handleRequestClearChargingProfile(
    commandPayload: ClearChargingProfileRequest
  ): ClearChargingProfileResponse {
    if (
      !OCPP16ServiceUtils.checkFeatureProfile(
        this.chargingStation,
        OCPP16SupportedFeatureProfiles.SmartCharging,
        OCPP16IncomingRequestCommand.CLEAR_CHARGING_PROFILE
      )
    ) {
      return Constants.OCPP_CLEAR_CHARGING_PROFILE_RESPONSE_UNKNOWN;
    }
    const connectorStatus = this.chargingStation.getConnectorStatus(commandPayload.connectorId);
    if (!connectorStatus) {
      logger.error(
        `${this.chargingStation.logPrefix()} Trying to clear a charging profile(s) to a non existing connector Id ${
          commandPayload.connectorId
        }`
      );
      return Constants.OCPP_CLEAR_CHARGING_PROFILE_RESPONSE_UNKNOWN;
    }
    if (commandPayload.connectorId && !Utils.isEmptyArray(connectorStatus.chargingProfiles)) {
      connectorStatus.chargingProfiles = [];
      logger.debug(
        `${this.chargingStation.logPrefix()} Charging profile(s) cleared on connector id ${
          commandPayload.connectorId
        }, dump their stack: %j`,
        connectorStatus.chargingProfiles
      );
      return Constants.OCPP_CLEAR_CHARGING_PROFILE_RESPONSE_ACCEPTED;
    }
    if (!commandPayload.connectorId) {
      let clearedCP = false;
      for (const connectorId of this.chargingStation.connectors.keys()) {
        if (
          !Utils.isEmptyArray(this.chargingStation.getConnectorStatus(connectorId).chargingProfiles)
        ) {
          this.chargingStation
            .getConnectorStatus(connectorId)
            .chargingProfiles?.forEach((chargingProfile: OCPP16ChargingProfile, index: number) => {
              let clearCurrentCP = false;
              if (chargingProfile.chargingProfileId === commandPayload.id) {
                clearCurrentCP = true;
              }
              if (
                !commandPayload.chargingProfilePurpose &&
                chargingProfile.stackLevel === commandPayload.stackLevel
              ) {
                clearCurrentCP = true;
              }
              if (
                !chargingProfile.stackLevel &&
                chargingProfile.chargingProfilePurpose === commandPayload.chargingProfilePurpose
              ) {
                clearCurrentCP = true;
              }
              if (
                chargingProfile.stackLevel === commandPayload.stackLevel &&
                chargingProfile.chargingProfilePurpose === commandPayload.chargingProfilePurpose
              ) {
                clearCurrentCP = true;
              }
              if (clearCurrentCP) {
                connectorStatus.chargingProfiles[index] = {} as OCPP16ChargingProfile;
                logger.debug(
                  `${this.chargingStation.logPrefix()} Matching charging profile(s) cleared on connector id ${
                    commandPayload.connectorId
                  }, dump their stack: %j`,
                  connectorStatus.chargingProfiles
                );
                clearedCP = true;
              }
            });
        }
      }
      if (clearedCP) {
        return Constants.OCPP_CLEAR_CHARGING_PROFILE_RESPONSE_ACCEPTED;
      }
    }
    return Constants.OCPP_CLEAR_CHARGING_PROFILE_RESPONSE_UNKNOWN;
  }

  private async handleRequestChangeAvailability(
    commandPayload: ChangeAvailabilityRequest
  ): Promise<ChangeAvailabilityResponse> {
    const connectorId: number = commandPayload.connectorId;
    if (!this.chargingStation.getConnectorStatus(connectorId)) {
      logger.error(
        `${this.chargingStation.logPrefix()} Trying to change the availability of a non existing connector Id ${connectorId.toString()}`
      );
      return Constants.OCPP_AVAILABILITY_RESPONSE_REJECTED;
    }
    const chargePointStatus: OCPP16ChargePointStatus =
      commandPayload.type === OCPP16AvailabilityType.OPERATIVE
        ? OCPP16ChargePointStatus.AVAILABLE
        : OCPP16ChargePointStatus.UNAVAILABLE;
    if (connectorId === 0) {
      let response: ChangeAvailabilityResponse = Constants.OCPP_AVAILABILITY_RESPONSE_ACCEPTED;
      for (const id of this.chargingStation.connectors.keys()) {
        if (this.chargingStation.getConnectorStatus(id)?.transactionStarted) {
          response = Constants.OCPP_AVAILABILITY_RESPONSE_SCHEDULED;
        }
        this.chargingStation.getConnectorStatus(id).availability = commandPayload.type;
        if (response === Constants.OCPP_AVAILABILITY_RESPONSE_ACCEPTED) {
          await this.chargingStation.ocppRequestService.requestHandler<
            OCPP16StatusNotificationRequest,
            OCPP16StatusNotificationResponse
          >(OCPP16RequestCommand.STATUS_NOTIFICATION, {
            connectorId: id,
            status: chargePointStatus,
            errorCode: OCPP16ChargePointErrorCode.NO_ERROR,
          });
          this.chargingStation.getConnectorStatus(id).status = chargePointStatus;
        }
      }
      return response;
    } else if (
      connectorId > 0 &&
      (this.chargingStation.getConnectorStatus(0).availability ===
        OCPP16AvailabilityType.OPERATIVE ||
        (this.chargingStation.getConnectorStatus(0).availability ===
          OCPP16AvailabilityType.INOPERATIVE &&
          commandPayload.type === OCPP16AvailabilityType.INOPERATIVE))
    ) {
      if (this.chargingStation.getConnectorStatus(connectorId)?.transactionStarted) {
        this.chargingStation.getConnectorStatus(connectorId).availability = commandPayload.type;
        return Constants.OCPP_AVAILABILITY_RESPONSE_SCHEDULED;
      }
      this.chargingStation.getConnectorStatus(connectorId).availability = commandPayload.type;
      await this.chargingStation.ocppRequestService.requestHandler<
        OCPP16StatusNotificationRequest,
        OCPP16StatusNotificationResponse
      >(OCPP16RequestCommand.STATUS_NOTIFICATION, {
        connectorId,
        status: chargePointStatus,
        errorCode: OCPP16ChargePointErrorCode.NO_ERROR,
      });
      this.chargingStation.getConnectorStatus(connectorId).status = chargePointStatus;
      return Constants.OCPP_AVAILABILITY_RESPONSE_ACCEPTED;
    }
    return Constants.OCPP_AVAILABILITY_RESPONSE_REJECTED;
  }

  private async handleRequestRemoteStartTransaction(
    commandPayload: RemoteStartTransactionRequest
  ): Promise<DefaultResponse> {
    const transactionConnectorId = commandPayload.connectorId;
    const connectorStatus = this.chargingStation.getConnectorStatus(transactionConnectorId);
    if (transactionConnectorId) {
      await this.chargingStation.ocppRequestService.requestHandler<
        OCPP16StatusNotificationRequest,
        OCPP16StatusNotificationResponse
      >(OCPP16RequestCommand.STATUS_NOTIFICATION, {
        connectorId: transactionConnectorId,
        status: OCPP16ChargePointStatus.PREPARING,
        errorCode: OCPP16ChargePointErrorCode.NO_ERROR,
      });
      connectorStatus.status = OCPP16ChargePointStatus.PREPARING;
      if (this.chargingStation.isChargingStationAvailable() && connectorStatus) {
        // Check if authorized
        if (this.chargingStation.getAuthorizeRemoteTxRequests()) {
          let authorized = false;
          if (
            this.chargingStation.getLocalAuthListEnabled() &&
            this.chargingStation.hasAuthorizedTags() &&
            this.chargingStation.authorizedTags.find((value) => value === commandPayload.idTag)
          ) {
            connectorStatus.localAuthorizeIdTag = commandPayload.idTag;
            connectorStatus.idTagLocalAuthorized = true;
            authorized = true;
          } else if (this.chargingStation.getMayAuthorizeAtRemoteStart()) {
            connectorStatus.authorizeIdTag = commandPayload.idTag;
            const authorizeResponse: OCPP16AuthorizeResponse =
              await this.chargingStation.ocppRequestService.requestHandler<
                OCPP16AuthorizeRequest,
                OCPP16AuthorizeResponse
              >(OCPP16RequestCommand.AUTHORIZE, {
                idTag: commandPayload.idTag,
              });
            if (authorizeResponse?.idTagInfo?.status === OCPP16AuthorizationStatus.ACCEPTED) {
              authorized = true;
            }
          } else {
            logger.warn(
              `${this.chargingStation.logPrefix()} The charging station configuration expects authorize at remote start transaction but local authorization or authorize isn't enabled`
            );
          }
          if (authorized) {
            // Authorization successful, start transaction
            if (
              this.setRemoteStartTransactionChargingProfile(
                transactionConnectorId,
                commandPayload.chargingProfile
              )
            ) {
              connectorStatus.transactionRemoteStarted = true;
              if (
                (
                  await this.chargingStation.ocppRequestService.requestHandler<
                    OCPP16StartTransactionRequest,
                    OCPP16StartTransactionResponse
                  >(OCPP16RequestCommand.START_TRANSACTION, {
                    connectorId: transactionConnectorId,
                    idTag: commandPayload.idTag,
                  })
                ).idTagInfo.status === OCPP16AuthorizationStatus.ACCEPTED
              ) {
                logger.debug(
                  this.chargingStation.logPrefix() +
                    ' Transaction remotely STARTED on ' +
                    this.chargingStation.stationInfo.chargingStationId +
                    '#' +
                    transactionConnectorId.toString() +
                    ' for idTag ' +
                    commandPayload.idTag
                );
                return Constants.OCPP_RESPONSE_ACCEPTED;
              }
              return this.notifyRemoteStartTransactionRejected(
                transactionConnectorId,
                commandPayload.idTag
              );
            }
            return this.notifyRemoteStartTransactionRejected(
              transactionConnectorId,
              commandPayload.idTag
            );
          }
          return this.notifyRemoteStartTransactionRejected(
            transactionConnectorId,
            commandPayload.idTag
          );
        }
        // No authorization check required, start transaction
        if (
          this.setRemoteStartTransactionChargingProfile(
            transactionConnectorId,
            commandPayload.chargingProfile
          )
        ) {
          connectorStatus.transactionRemoteStarted = true;
          if (
            (
              await this.chargingStation.ocppRequestService.requestHandler<
                OCPP16StartTransactionRequest,
                OCPP16StartTransactionResponse
              >(OCPP16RequestCommand.START_TRANSACTION, {
                connectorId: transactionConnectorId,
                idTag: commandPayload.idTag,
              })
            ).idTagInfo.status === OCPP16AuthorizationStatus.ACCEPTED
          ) {
            logger.debug(
              this.chargingStation.logPrefix() +
                ' Transaction remotely STARTED on ' +
                this.chargingStation.stationInfo.chargingStationId +
                '#' +
                transactionConnectorId.toString() +
                ' for idTag ' +
                commandPayload.idTag
            );
            return Constants.OCPP_RESPONSE_ACCEPTED;
          }
          return this.notifyRemoteStartTransactionRejected(
            transactionConnectorId,
            commandPayload.idTag
          );
        }
        return this.notifyRemoteStartTransactionRejected(
          transactionConnectorId,
          commandPayload.idTag
        );
      }
      return this.notifyRemoteStartTransactionRejected(
        transactionConnectorId,
        commandPayload.idTag
      );
    }
    return this.notifyRemoteStartTransactionRejected(transactionConnectorId, commandPayload.idTag);
  }

  private async notifyRemoteStartTransactionRejected(
    connectorId: number,
    idTag: string
  ): Promise<DefaultResponse> {
    if (
      this.chargingStation.getConnectorStatus(connectorId).status !==
      OCPP16ChargePointStatus.AVAILABLE
    ) {
      await this.chargingStation.ocppRequestService.requestHandler<
        OCPP16StatusNotificationRequest,
        OCPP16StatusNotificationResponse
      >(OCPP16RequestCommand.STATUS_NOTIFICATION, {
        connectorId,
        status: OCPP16ChargePointStatus.AVAILABLE,
        errorCode: OCPP16ChargePointErrorCode.NO_ERROR,
      });
      this.chargingStation.getConnectorStatus(connectorId).status =
        OCPP16ChargePointStatus.AVAILABLE;
    }
    logger.warn(
      this.chargingStation.logPrefix() +
        ' Remote starting transaction REJECTED on connector Id ' +
        connectorId.toString() +
        ', idTag ' +
        idTag +
        ', availability ' +
        this.chargingStation.getConnectorStatus(connectorId).availability +
        ', status ' +
        this.chargingStation.getConnectorStatus(connectorId).status
    );
    return Constants.OCPP_RESPONSE_REJECTED;
  }

  private setRemoteStartTransactionChargingProfile(
    connectorId: number,
    cp: OCPP16ChargingProfile
  ): boolean {
    if (cp && cp.chargingProfilePurpose === ChargingProfilePurposeType.TX_PROFILE) {
      this.chargingStation.setChargingProfile(connectorId, cp);
      logger.debug(
        `${this.chargingStation.logPrefix()} Charging profile(s) set at remote start transaction on connector id ${connectorId}, dump their stack: %j`,
        this.chargingStation.getConnectorStatus(connectorId).chargingProfiles
      );
      return true;
    } else if (cp && cp.chargingProfilePurpose !== ChargingProfilePurposeType.TX_PROFILE) {
      logger.warn(
        `${this.chargingStation.logPrefix()} Not allowed to set ${
          cp.chargingProfilePurpose
        } charging profile(s) at remote start transaction`
      );
      return false;
    } else if (!cp) {
      return true;
    }
  }

  private async handleRequestRemoteStopTransaction(
    commandPayload: RemoteStopTransactionRequest
  ): Promise<DefaultResponse> {
    const transactionId = commandPayload.transactionId;
    for (const connectorId of this.chargingStation.connectors.keys()) {
      if (
        connectorId > 0 &&
        this.chargingStation.getConnectorStatus(connectorId)?.transactionId === transactionId
      ) {
        await this.chargingStation.ocppRequestService.requestHandler<
          OCPP16StatusNotificationRequest,
          OCPP16StatusNotificationResponse
        >(OCPP16RequestCommand.STATUS_NOTIFICATION, {
          connectorId,
          status: OCPP16ChargePointStatus.FINISHING,
          errorCode: OCPP16ChargePointErrorCode.NO_ERROR,
        });
        this.chargingStation.getConnectorStatus(connectorId).status =
          OCPP16ChargePointStatus.FINISHING;
        if (
          this.chargingStation.getBeginEndMeterValues() &&
          this.chargingStation.getOcppStrictCompliance() &&
          !this.chargingStation.getOutOfOrderEndMeterValues()
        ) {
          // FIXME: Implement OCPP version agnostic helpers
          const transactionEndMeterValue = OCPP16ServiceUtils.buildTransactionEndMeterValue(
            this.chargingStation,
            connectorId,
            this.chargingStation.getEnergyActiveImportRegisterByTransactionId(transactionId)
          );
          await this.chargingStation.ocppRequestService.requestHandler<
            OCPP16MeterValuesRequest,
            OCPP16MeterValuesResponse
          >(OCPP16RequestCommand.METER_VALUES, {
            connectorId,
            transactionId,
            meterValue: transactionEndMeterValue,
          });
        }
        await this.chargingStation.ocppRequestService.requestHandler<
          OCPP16StopTransactionRequest,
          OCPP16StopTransactionResponse
        >(OCPP16RequestCommand.STOP_TRANSACTION, {
          transactionId,
          meterStop:
            this.chargingStation.getEnergyActiveImportRegisterByTransactionId(transactionId),
          idTag: this.chargingStation.getTransactionIdTag(transactionId),
        });
        return Constants.OCPP_RESPONSE_ACCEPTED;
      }
    }
    logger.info(
      this.chargingStation.logPrefix() +
        ' Trying to remote stop a non existing transaction ' +
        transactionId.toString()
    );
    return Constants.OCPP_RESPONSE_REJECTED;
  }

  private async handleRequestGetDiagnostics(
    commandPayload: GetDiagnosticsRequest
  ): Promise<GetDiagnosticsResponse> {
    if (
      !OCPP16ServiceUtils.checkFeatureProfile(
        this.chargingStation,
        OCPP16SupportedFeatureProfiles.FirmwareManagement,
        OCPP16IncomingRequestCommand.GET_DIAGNOSTICS
      )
    ) {
      return Constants.OCPP_RESPONSE_EMPTY;
    }
    logger.debug(
      this.chargingStation.logPrefix() +
        ' ' +
        OCPP16IncomingRequestCommand.GET_DIAGNOSTICS +
        ' request received: %j',
      commandPayload
    );
    const uri = new URL(commandPayload.location);
    if (uri.protocol.startsWith('ftp:')) {
      let ftpClient: Client;
      try {
        const logFiles = fs
          .readdirSync(path.resolve(__dirname, '../../../../'))
          .filter((file) => file.endsWith('.log'))
          .map((file) => path.join('./', file));
        const diagnosticsArchive =
          this.chargingStation.stationInfo.chargingStationId + '_logs.tar.gz';
        tar.create({ gzip: true }, logFiles).pipe(fs.createWriteStream(diagnosticsArchive));
        ftpClient = new Client();
        const accessResponse = await ftpClient.access({
          host: uri.host,
          ...(!Utils.isEmptyString(uri.port) && { port: Utils.convertToInt(uri.port) }),
          ...(!Utils.isEmptyString(uri.username) && { user: uri.username }),
          ...(!Utils.isEmptyString(uri.password) && { password: uri.password }),
        });
        let uploadResponse: FTPResponse;
        if (accessResponse.code === 220) {
          // eslint-disable-next-line @typescript-eslint/no-misused-promises
          ftpClient.trackProgress(async (info) => {
            logger.info(
              `${this.chargingStation.logPrefix()} ${
                info.bytes / 1024
              } bytes transferred from diagnostics archive ${info.name}`
            );
            await this.chargingStation.ocppRequestService.requestHandler<
              DiagnosticsStatusNotificationRequest,
              DiagnosticsStatusNotificationResponse
            >(OCPP16RequestCommand.DIAGNOSTICS_STATUS_NOTIFICATION, {
              status: OCPP16DiagnosticsStatus.Uploading,
            });
          });
          uploadResponse = await ftpClient.uploadFrom(
            path.join(path.resolve(__dirname, '../../../../'), diagnosticsArchive),
            uri.pathname + diagnosticsArchive
          );
          if (uploadResponse.code === 226) {
            await this.chargingStation.ocppRequestService.requestHandler<
              DiagnosticsStatusNotificationRequest,
              DiagnosticsStatusNotificationResponse
            >(OCPP16RequestCommand.DIAGNOSTICS_STATUS_NOTIFICATION, {
              status: OCPP16DiagnosticsStatus.Uploaded,
            });
            if (ftpClient) {
              ftpClient.close();
            }
            return { fileName: diagnosticsArchive };
          }
          throw new OCPPError(
            ErrorType.GENERIC_ERROR,
            `Diagnostics transfer failed with error code ${accessResponse.code.toString()}${
              uploadResponse?.code && '|' + uploadResponse?.code.toString()
            }`,
            OCPP16IncomingRequestCommand.GET_DIAGNOSTICS
          );
        }
        throw new OCPPError(
          ErrorType.GENERIC_ERROR,
          `Diagnostics transfer failed with error code ${accessResponse.code.toString()}${
            uploadResponse?.code && '|' + uploadResponse?.code.toString()
          }`,
          OCPP16IncomingRequestCommand.GET_DIAGNOSTICS
        );
      } catch (error) {
        await this.chargingStation.ocppRequestService.requestHandler<
          DiagnosticsStatusNotificationRequest,
          DiagnosticsStatusNotificationResponse
        >(OCPP16RequestCommand.DIAGNOSTICS_STATUS_NOTIFICATION, {
          status: OCPP16DiagnosticsStatus.UploadFailed,
        });
        if (ftpClient) {
          ftpClient.close();
        }
        return this.handleIncomingRequestError(
          OCPP16IncomingRequestCommand.GET_DIAGNOSTICS,
          error as Error,
          { errorResponse: Constants.OCPP_RESPONSE_EMPTY }
        );
      }
    } else {
      logger.error(
        `${this.chargingStation.logPrefix()} Unsupported protocol ${
          uri.protocol
        } to transfer the diagnostic logs archive`
      );
      await this.chargingStation.ocppRequestService.requestHandler<
        DiagnosticsStatusNotificationRequest,
        DiagnosticsStatusNotificationResponse
      >(OCPP16RequestCommand.DIAGNOSTICS_STATUS_NOTIFICATION, {
        status: OCPP16DiagnosticsStatus.UploadFailed,
      });
      return Constants.OCPP_RESPONSE_EMPTY;
    }
  }

  private handleRequestTriggerMessage(
    commandPayload: OCPP16TriggerMessageRequest
  ): OCPP16TriggerMessageResponse {
    if (
      !OCPP16ServiceUtils.checkFeatureProfile(
        this.chargingStation,
        OCPP16SupportedFeatureProfiles.RemoteTrigger,
        OCPP16IncomingRequestCommand.TRIGGER_MESSAGE
      )
    ) {
      return Constants.OCPP_TRIGGER_MESSAGE_RESPONSE_NOT_IMPLEMENTED;
    }
    // TODO: factor out the check on connector id
    if (commandPayload?.connectorId < 0) {
      logger.warn(
        `${this.chargingStation.logPrefix()} ${
          OCPP16IncomingRequestCommand.TRIGGER_MESSAGE
        } incoming request received with invalid connectorId ${commandPayload.connectorId}`
      );
      return Constants.OCPP_TRIGGER_MESSAGE_RESPONSE_REJECTED;
    }
    try {
      switch (commandPayload.requestedMessage) {
        case MessageTrigger.BootNotification:
          setTimeout(() => {
            this.chargingStation.ocppRequestService
              .requestHandler<OCPP16BootNotificationRequest, OCPP16BootNotificationResponse>(
                OCPP16RequestCommand.BOOT_NOTIFICATION,
                {
                  chargePointModel:
                    this.chargingStation.getBootNotificationRequest().chargePointModel,
                  chargePointVendor:
                    this.chargingStation.getBootNotificationRequest().chargePointVendor,
                  chargeBoxSerialNumber:
                    this.chargingStation.getBootNotificationRequest().chargeBoxSerialNumber,
                  firmwareVersion:
                    this.chargingStation.getBootNotificationRequest().firmwareVersion,
                  chargePointSerialNumber:
                    this.chargingStation.getBootNotificationRequest().chargePointSerialNumber,
                  iccid: this.chargingStation.getBootNotificationRequest().iccid,
                  imsi: this.chargingStation.getBootNotificationRequest().imsi,
                  meterSerialNumber:
                    this.chargingStation.getBootNotificationRequest().meterSerialNumber,
                  meterType: this.chargingStation.getBootNotificationRequest().meterType,
                },
                { skipBufferingOnError: true, triggerMessage: true }
              )
              .then((value) => {
                this.chargingStation.bootNotificationResponse = value;
              })
              .catch(() => {
                /* This is intentional */
              });
          }, Constants.OCPP_TRIGGER_MESSAGE_DELAY);
          return Constants.OCPP_TRIGGER_MESSAGE_RESPONSE_ACCEPTED;
        case MessageTrigger.Heartbeat:
          setTimeout(() => {
            this.chargingStation.ocppRequestService
              .requestHandler<OCPP16HeartbeatRequest, OCPP16HeartbeatResponse>(
                OCPP16RequestCommand.HEARTBEAT,
                null,
                {
                  triggerMessage: true,
                }
              )
              .catch(() => {
                /* This is intentional */
              });
          }, Constants.OCPP_TRIGGER_MESSAGE_DELAY);
          return Constants.OCPP_TRIGGER_MESSAGE_RESPONSE_ACCEPTED;
        case MessageTrigger.StatusNotification:
          setTimeout(() => {
            if (commandPayload?.connectorId) {
              this.chargingStation.ocppRequestService
                .requestHandler<OCPP16StatusNotificationRequest, OCPP16StatusNotificationResponse>(
                  OCPP16RequestCommand.STATUS_NOTIFICATION,
                  {
                    connectorId: commandPayload.connectorId,
                    errorCode: OCPP16ChargePointErrorCode.NO_ERROR,
                    status: this.chargingStation.getConnectorStatus(commandPayload.connectorId)
                      .status,
                  },
                  {
                    triggerMessage: true,
                  }
                )
                .catch(() => {
                  /* This is intentional */
                });
            } else {
              for (const connectorId of this.chargingStation.connectors.keys()) {
                this.chargingStation.ocppRequestService
                  .requestHandler<
                    OCPP16StatusNotificationRequest,
                    OCPP16StatusNotificationResponse
                  >(
                    OCPP16RequestCommand.STATUS_NOTIFICATION,
                    {
                      connectorId,
                      errorCode: OCPP16ChargePointErrorCode.NO_ERROR,
                      status: this.chargingStation.getConnectorStatus(connectorId).status,
                    },
                    {
                      triggerMessage: true,
                    }
                  )
                  .catch(() => {
                    /* This is intentional */
                  });
              }
            }
          }, Constants.OCPP_TRIGGER_MESSAGE_DELAY);
          return Constants.OCPP_TRIGGER_MESSAGE_RESPONSE_ACCEPTED;
        default:
          return Constants.OCPP_TRIGGER_MESSAGE_RESPONSE_NOT_IMPLEMENTED;
      }
    } catch (error) {
      return this.handleIncomingRequestError(
        OCPP16IncomingRequestCommand.TRIGGER_MESSAGE,
        error as Error,
        { errorResponse: Constants.OCPP_TRIGGER_MESSAGE_RESPONSE_REJECTED }
      );
    }
  }
}
