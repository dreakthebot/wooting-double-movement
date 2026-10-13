import { AppSettings } from "common";
import { Key } from "ts-keycode-enum";

export type SocdMode =
  | "Legacy"
  | "LastInputWins"
  | "FirstInputWins"
  | "Neutral";

export interface JoystickAngleConfiguration {
  /** Forward diagonal angle (W+D, and W+A unless splitSides), fraction of 90° */
  upDiagonalAngle: number;
  useLeftRightAngle: boolean;
  /** Single-key strafe angle (D alone, and A alone unless splitSides) */
  leftRightAngle: number;
  analogRange: [number, number];
  /** Give the left side (W+A, A alone) its own angles */
  splitSides: boolean;
  upLeftDiagonalAngle: number;
  leftAngle: number;
  /** Backward diagonal, fraction of 90° away from straight back (0.5 = 45°) */
  downDiagonalAngle: number;
  /** What happens when opposite keys are held together */
  socdMode: SocdMode;
  /** Analog: partial presses move slower */
  analogMagnitude: boolean;
  /** Analog: key-depth exponent, 1 = linear */
  analogCurve: number;
  /** ms for the stick to rotate 90° when direction changes; 0 = instant */
  turnSmoothingMs: number;
}

export const defaultLeftJoystickStrafingAngles: JoystickAngleConfiguration = {
  upDiagonalAngle: 0.6473,
  useLeftRightAngle: true,
  leftRightAngle: 0.7888,
  analogRange: [0.075, 0.9],
  splitSides: false,
  upLeftDiagonalAngle: 0.6473,
  leftAngle: 0.7888,
  downDiagonalAngle: 0.5,
  socdMode: "LastInputWins",
  analogMagnitude: false,
  analogCurve: 1.0,
  turnSmoothingMs: 0,
};

export interface JoystickKeyMapping {
  up?: number;
  up_two?: number;
  down?: number;
  down_two?: number;
  left?: number;
  left_two?: number;
  right?: number;
  right_two?: number;
}

export interface KeyMapping {
  leftJoystick: JoystickKeyMapping;
}

export const defaultKeyMapping: KeyMapping = {
  leftJoystick: {
    up: Key.W,
    down: Key.S,
    left: Key.A,
    right: Key.D,
  },
};

export const defaultToggleAccelerator = [Key.Ctrl, Key.P];

export type ControllerType = "DualShock4" | "Xbox360";

export interface ServiceConfiguration {
  leftJoystickStrafingAngles: JoystickAngleConfiguration;
  keyMapping: KeyMapping;
  useAnalogInput: boolean;
  /** Virtual controller to emulate; changing it restarts the service */
  controllerType: ControllerType;
  /** Only move the stick while a window with this title is focused */
  onlyWhenFocused: boolean;
  focusWindowTitle: string;
}

export const defaultSettings: AppSettings = {
  doubleMovementEnabled: false,
  leftJoystickStrafingAngles: defaultLeftJoystickStrafingAngles,
  keyMapping: defaultKeyMapping,
  enabledToggleAccelerator: defaultToggleAccelerator,
  useAnalogInput: false,
  controllerType: "DualShock4",
  onlyWhenFocused: false,
  focusWindowTitle: "Fortnite",
};

export type SDKState =
  | { type: "Uninitialized" }
  | { type: "Error"; value: string }
  | { type: "DevicesConnected"; value: string[] }
  | { type: "NoDevices" };
