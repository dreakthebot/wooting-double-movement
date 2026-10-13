#[cfg(windows)]
use multiinput::{KeyId, ToPrimitive};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct JoystickAngleConfiguration {
    #[serde(rename = "upDiagonalAngle")]
    pub up_diagonal_angle: f32,

    #[serde(rename = "useLeftRightAngle")]
    pub use_left_right_angle: bool,

    #[serde(rename = "leftRightAngle")]
    pub left_right_angle: f32,

    #[serde(rename = "analogRange")]
    pub analog_range: (f32, f32),

    /// When true, the left side (Forward+Left, Left alone) uses its own angles below.
    /// When false, the left side mirrors `up_diagonal_angle` / `left_right_angle`.
    #[serde(rename = "splitSides", default)]
    pub split_sides: bool,

    #[serde(rename = "upLeftDiagonalAngle", default = "default_up_diagonal")]
    pub up_left_diagonal_angle: f32,

    #[serde(rename = "leftAngle", default = "default_left_right")]
    pub left_angle: f32,

    /// Backward diagonal (Back+Left/Right), as a fraction of 90° away from straight back.
    /// 0.5 = 45°, which matches the original hardcoded behaviour.
    #[serde(rename = "downDiagonalAngle", default = "default_down_diagonal")]
    pub down_diagonal_angle: f32,

    /// What happens when opposite keys (W+S or A+D) are held together.
    #[serde(rename = "socdMode", default)]
    pub socd_mode: SocdMode,

    /// Analog only: scale stick distance by key depth so partial presses walk.
    #[serde(rename = "analogMagnitude", default)]
    pub analog_magnitude: bool,

    /// Analog only: exponent applied to key depth. 1.0 = linear, >1.0 gives finer
    /// control at light presses (e.g. gentle steering with A/D while W is held).
    #[serde(rename = "analogCurve", default = "default_analog_curve")]
    pub analog_curve: f32,

    /// Turn smoothing: milliseconds the stick takes to rotate 90° around its edge when the
    /// direction changes. 0 = instant (off). Distance stays at full the whole time.
    #[serde(rename = "turnSmoothingMs", default)]
    pub turn_smoothing_ms: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq)]
pub enum SocdMode {
    /// Original behaviour: the deeper-pressed key wins; on a tie Forward/Right win.
    Legacy,
    /// The most recently pressed key wins (snap-tap). Releasing it hands control back.
    LastInputWins,
    /// The first key pressed keeps control until released.
    FirstInputWins,
    /// Opposite keys cancel out to neutral on that axis.
    Neutral,
}

impl Default for SocdMode {
    fn default() -> Self {
        SocdMode::LastInputWins
    }
}

fn default_up_diagonal() -> f32 {
    0.6473
}
fn default_left_right() -> f32 {
    0.7888
}
fn default_down_diagonal() -> f32 {
    0.5
}
fn default_analog_curve() -> f32 {
    1.0
}

#[derive(Serialize, Deserialize, Debug)]
pub struct JoystickKeyMapping {
    pub up: Option<u8>,
    pub up_two: Option<u8>,
    pub left: Option<u8>,
    pub left_two: Option<u8>,
    pub down: Option<u8>,
    pub down_two: Option<u8>,
    pub right: Option<u8>,
    pub right_two: Option<u8>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct KeyMapping {
    #[serde(rename = "leftJoystick")]
    pub left_joystick: JoystickKeyMapping,
}

impl Default for KeyMapping {
    fn default() -> Self {
        KeyMapping {
            #[cfg(windows)]
            left_joystick: JoystickKeyMapping {
                up: KeyId::to_u8(&KeyId::W),
                up_two: None,
                down: KeyId::to_u8(&KeyId::S),
                down_two: None,
                left: KeyId::to_u8(&KeyId::A),
                left_two: None,
                right: KeyId::to_u8(&KeyId::D),
                right_two: None,
            },
            #[cfg(not(windows))]
            left_joystick: JoystickKeyMapping {
                up: Some(0),
                up_two: None,
                down: Some(0),
                down_two: None,
                left: Some(0),
                left_two: None,
                right: Some(0),
                right_two: None,
            },
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ServiceConfiguration {
    #[serde(rename = "leftJoystickStrafingAngles")]
    pub left_joystick_strafing_angles: JoystickAngleConfiguration,
    #[serde(rename = "keyMapping")]
    pub key_mapping: KeyMapping,
    #[serde(rename = "useAnalogInput")]
    pub use_analog_input: bool,
}

impl Default for ServiceConfiguration {
    fn default() -> Self {
        ServiceConfiguration {
            left_joystick_strafing_angles: JoystickAngleConfiguration {
                up_diagonal_angle: 0.67,
                use_left_right_angle: false,
                left_right_angle: 0.78,
                analog_range: (0.0, 1.0),
                split_sides: false,
                up_left_diagonal_angle: default_up_diagonal(),
                left_angle: default_left_right(),
                down_diagonal_angle: default_down_diagonal(),
                socd_mode: SocdMode::default(),
                analog_magnitude: false,
                analog_curve: default_analog_curve(),
                turn_smoothing_ms: 0.0,
            },
            key_mapping: KeyMapping::default(),
            use_analog_input: false,
        }
    }
}
