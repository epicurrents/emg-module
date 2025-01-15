import type { BiosignalDataService, BiosignalResource } from "@epicurrents/core/dist/types"

export interface EmgDataService extends BiosignalDataService {

}

export type EmgModuleSettings = {

}

export interface EmgResource extends BiosignalResource {
}

export type SetupEmgWorkerResponse = {
    length: number
    samplingRate: number
}