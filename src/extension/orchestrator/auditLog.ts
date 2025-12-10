/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../util/vs/platform/instantiation/common/instantiation';

export const IOrchestratorAuditLogService = createDecorator<IOrchestratorAuditLogService>('orchestratorAuditLogService');

export interface IOrchestratorAuditLogService {
readonly _serviceBrand: undefined;
log(message: string, data?: any): void;
getLogs(): Promise<any[]>;
}

export class OrchestratorAuditLogService implements IOrchestratorAuditLogService {
declare readonly _serviceBrand: undefined;
private logs: any[] = [];

log(message: string, data?: any): void {
this.logs.push({ timestamp: new Date(), message, data });
}

async getLogs(): Promise<any[]> {
return this.logs;
}
}
