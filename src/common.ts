import { ServiceConfiguration } from "./native/types";

export const APP_NAME = "Double Movement Plus";

export type AppSettings = {
  doubleMovementEnabled: boolean;
  enabledToggleAccelerator: number[];
  /** Set once settings from the original Wooting app have been imported (or there were none) */
  legacySettingsImported?: boolean;
} & ServiceConfiguration;

type Size = [width: number, height: number];

export const smallWindowSize: Size = [500, 510];
export const bigWindowSize: Size = [500, 810];
