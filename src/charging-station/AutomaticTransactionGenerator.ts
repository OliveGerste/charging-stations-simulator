// Partial Copyright Jerome Benoit. 2021. All Rights Reserved.

import { AuthorizationStatus, AuthorizeResponse, StartTransactionResponse, StopTransactionReason, StopTransactionResponse } from '../types/ocpp/Transaction';

import ChargingStation from './ChargingStation';
import Constants from '../utils/Constants';
import PerformanceStatistics from '../performance/PerformanceStatistics';
import Utils from '../utils/Utils';
import logger from '../utils/Logger';

export default class AutomaticTransactionGenerator {
  public timeToStop: boolean;
  private startDate!: Date;
  private stopDate!: Date;
  private runningDuration!: number;
  private chargingStation: ChargingStation;

  constructor(chargingStation: ChargingStation) {
    this.chargingStation = chargingStation;
    this.timeToStop = true;
  }

  public start(): void {
    this.startDate = new Date();
    this.stopDate = new Date(this.startDate.getTime()
      + (this.chargingStation.stationInfo?.AutomaticTransactionGenerator?.stopAfterHours ?? Constants.CHARGING_STATION_ATG_DEFAULT_STOP_AFTER_HOURS) * 3600 * 1000
      - (this.runningDuration ?? 0));
    this.timeToStop = false;
    for (const connector in this.chargingStation.connectors) {
      if (Utils.convertToInt(connector) > 0) {
        // Avoid hogging the event loop with a busy loop
        setImmediate(() => {
          this.startOnConnector(Utils.convertToInt(connector)).catch(() => { /* This is intentional */ });
        });
      }
    }
    logger.info(this.logPrefix() + ' started and will run for ' + Utils.formatDurationMilliSeconds(this.stopDate.getTime() - this.startDate.getTime()));
  }

  public async stop(reason: StopTransactionReason = StopTransactionReason.NONE): Promise<void> {
    logger.info(`${this.logPrefix()} over and lasted for ${Utils.formatDurationMilliSeconds(this.runningDuration ?? 0)}. Stopping all transactions`);
    for (const connector in this.chargingStation.connectors) {
      const transactionId = this.chargingStation.getConnector(Utils.convertToInt(connector)).transactionId;
      if (this.chargingStation.getConnector(Utils.convertToInt(connector)).transactionStarted) {
        logger.info(this.logPrefix(Utils.convertToInt(connector)) + ' over. Stop transaction ' + transactionId.toString());
        await this.chargingStation.ocppRequestService.sendStopTransaction(transactionId, this.chargingStation.getEnergyActiveImportRegisterByTransactionId(transactionId),
          this.chargingStation.getTransactionIdTag(transactionId), reason);
      }
    }
    this.timeToStop = true;
  }

  private async startOnConnector(connectorId: number): Promise<void> {
    logger.info(this.logPrefix(connectorId) + ' started on connector');
    let transactionSkip = 0;
    let totalTransactionSkip = 0;
    while (!this.timeToStop) {
      if ((new Date()) > this.stopDate) {
        await this.stop();
        break;
      }
      if (!this.chargingStation.isRegistered()) {
        logger.error(this.logPrefix(connectorId) + ' Entered in transaction loop while the charging station is not registered');
        break;
      }
      if (!this.chargingStation.isChargingStationAvailable()) {
        logger.info(this.logPrefix(connectorId) + ' Entered in transaction loop while the charging station is unavailable');
        await this.stop();
        break;
      }
      if (!this.chargingStation.isConnectorAvailable(connectorId)) {
        logger.info(`${this.logPrefix(connectorId)} Entered in transaction loop while the connector ${connectorId} is unavailable, stop it`);
        break;
      }
      if (!this.chargingStation?.ocppRequestService) {
        logger.info(`${this.logPrefix(connectorId)} Transaction loop waiting for charging station service to be initialized`);
        do {
          await Utils.sleep(Constants.CHARGING_STATION_ATG_INITIALIZATION_TIME);
        } while (!this.chargingStation?.ocppRequestService);
      }
      const wait = Utils.getRandomInt(this.chargingStation.stationInfo.AutomaticTransactionGenerator.maxDelayBetweenTwoTransactions,
        this.chargingStation.stationInfo.AutomaticTransactionGenerator.minDelayBetweenTwoTransactions) * 1000;
      logger.info(this.logPrefix(connectorId) + ' waiting for ' + Utils.formatDurationMilliSeconds(wait));
      await Utils.sleep(wait);
      const start = Utils.secureRandom();
      if (start < this.chargingStation.stationInfo.AutomaticTransactionGenerator.probabilityOfStart) {
        transactionSkip = 0;
        // Start transaction
        const startResponse = await this.startTransaction(connectorId);
        if (startResponse?.idTagInfo?.status !== AuthorizationStatus.ACCEPTED) {
          logger.warn(this.logPrefix(connectorId) + ' transaction rejected');
          await Utils.sleep(Constants.CHARGING_STATION_ATG_WAIT_TIME);
        } else {
          // Wait until end of transaction
          const waitTrxEnd = Utils.getRandomInt(this.chargingStation.stationInfo.AutomaticTransactionGenerator.maxDuration,
            this.chargingStation.stationInfo.AutomaticTransactionGenerator.minDuration) * 1000;
          logger.info(this.logPrefix(connectorId) + ' transaction ' + this.chargingStation.getConnector(connectorId).transactionId.toString() + ' will stop in ' + Utils.formatDurationMilliSeconds(waitTrxEnd));
          await Utils.sleep(waitTrxEnd);
          // Stop transaction
          if (this.chargingStation.getConnector(connectorId)?.transactionStarted) {
            logger.info(this.logPrefix(connectorId) + ' stop transaction ' + this.chargingStation.getConnector(connectorId).transactionId.toString());
            await this.stopTransaction(connectorId);
          }
        }
      } else {
        transactionSkip++;
        totalTransactionSkip++;
        logger.info(this.logPrefix(connectorId) + ' skipped transaction ' + transactionSkip.toString() + '/' + totalTransactionSkip.toString());
      }
      this.runningDuration = (new Date()).getTime() - this.startDate.getTime();
    }
    logger.info(this.logPrefix(connectorId) + ' stopped on connector');
  }

  private async startTransaction(connectorId: number): Promise<StartTransactionResponse | AuthorizeResponse> {
    const measureId = 'StartTransaction with ATG';
    const beginId = PerformanceStatistics.beginMeasure(measureId);
    let startResponse: StartTransactionResponse;
    if (this.chargingStation.hasAuthorizedTags()) {
      const tagId = this.chargingStation.getRandomTagId();
      if (this.chargingStation.getAutomaticTransactionGeneratorRequireAuthorize()) {
        // Authorize tagId
        const authorizeResponse = await this.chargingStation.ocppRequestService.sendAuthorize(connectorId, tagId);
        if (authorizeResponse?.idTagInfo?.status === AuthorizationStatus.ACCEPTED) {
          logger.info(this.logPrefix(connectorId) + ' start transaction for tagID ' + tagId);
          // Start transaction
          startResponse = await this.chargingStation.ocppRequestService.sendStartTransaction(connectorId, tagId);
          PerformanceStatistics.endMeasure(measureId, beginId);
          return startResponse;
        }
        PerformanceStatistics.endMeasure(measureId, beginId);
        return authorizeResponse;
      }
      logger.info(this.logPrefix(connectorId) + ' start transaction for tagID ' + tagId);
      // Start transaction
      startResponse = await this.chargingStation.ocppRequestService.sendStartTransaction(connectorId, tagId);
      PerformanceStatistics.endMeasure(measureId, beginId);
      return startResponse;
    }
    logger.info(this.logPrefix(connectorId) + ' start transaction without a tagID');
    startResponse = await this.chargingStation.ocppRequestService.sendStartTransaction(connectorId);
    PerformanceStatistics.endMeasure(measureId, beginId);
    return startResponse;
  }

  private async stopTransaction(connectorId: number): Promise<StopTransactionResponse> {
    const measureId = 'StopTransaction with ATG';
    const beginId = PerformanceStatistics.beginMeasure(measureId);
    const transactionId = this.chargingStation.getConnector(connectorId).transactionId;
    const stopResponse = this.chargingStation.ocppRequestService.sendStopTransaction(transactionId,
      this.chargingStation.getEnergyActiveImportRegisterByTransactionId(transactionId), this.chargingStation.getTransactionIdTag(transactionId));
    PerformanceStatistics.endMeasure(measureId, beginId);
    return stopResponse;
  }

  private logPrefix(connectorId?: number): string {
    if (connectorId) {
      return Utils.logPrefix(' ' + this.chargingStation.stationInfo.chargingStationId + ' | ATG on connector #' + connectorId.toString() + ':');
    }
    return Utils.logPrefix(' ' + this.chargingStation.stationInfo.chargingStationId + ' | ATG:');
  }
}
