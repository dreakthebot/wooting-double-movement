#[allow(unused_imports)]
use log::*;
#[cfg(windows)]
use vigem::{DSReport, XUSBReport};
#[cfg(windows)]
use winapi::um::winuser::GetAsyncKeyState;

use crate::config::{JoystickAngleConfiguration, JoystickKeyMapping, SocdMode};

pub enum JoystickDirection {
    Up,
    Down,
    Left,
    Right,
}

#[derive(Debug)]
struct JoystickDirectionState {
    value: f32,
    /// Order in which this key became active (higher = more recent). 0 = not active.
    pressed_seq: u64,
}

impl JoystickDirectionState {
    pub fn new() -> Self {
        JoystickDirectionState {
            value: 0.0,
            pressed_seq: 0,
        }
    }

    /// Updates the raw value and press order. Returns true if the output may have changed.
    pub fn update_analog(&mut self, value: f32, activation: f32, seq_counter: &mut u64) -> bool {
        let was_active = self.pressed_seq != 0;
        let is_active = value > activation;
        let mut changed = false;

        if is_active && !was_active {
            *seq_counter += 1;
            self.pressed_seq = *seq_counter;
            changed = true;
        } else if !is_active && was_active {
            self.pressed_seq = 0;
            changed = true;
        }

        if value != self.value {
            self.value = value;
            changed = true;
        }
        changed
    }

    #[allow(dead_code)]
    pub fn get(&self) -> f32 {
        self.value
    }

    pub fn get_with_range(&self, analog_range: &(f32, f32)) -> f32 {
        let range_start = analog_range.0;
        let range_end = analog_range.1;
        let value = self.value;
        if value <= range_start {
            0.0
        } else if value > range_end {
            1.0
        } else {
            (value - range_start) / (range_end - range_start)
        }
    }
}

#[derive(Debug)]
pub struct JoystickState {
    up: JoystickDirectionState,
    down: JoystickDirectionState,
    left: JoystickDirectionState,
    right: JoystickDirectionState,
    /// Monotonic counter used to order key presses for the opposite-key (SOCD) modes.
    seq_counter: u64,
    /// Raw value above which a key counts as pressed. Kept in sync with the analog range start.
    activation: f32,
}

/// Resolves one axis from its positive and negative inputs (already range/curve adjusted).
/// Returns a value in -1..=1.
fn resolve_axis(pos: f32, neg: f32, pos_seq: u64, neg_seq: u64, mode: SocdMode) -> f32 {
    if pos > 0.0 && neg > 0.0 {
        match mode {
            SocdMode::Legacy => {
                if neg > pos {
                    -neg
                } else {
                    pos
                }
            }
            SocdMode::LastInputWins => {
                if neg_seq > pos_seq {
                    -neg
                } else {
                    pos
                }
            }
            SocdMode::FirstInputWins => {
                // A seq of 0 shouldn't happen while a key is active, but treat it as oldest.
                if neg_seq != 0 && (pos_seq == 0 || neg_seq < pos_seq) {
                    -neg
                } else {
                    pos
                }
            }
            SocdMode::Neutral => 0.0,
        }
    } else if neg > 0.0 {
        -neg
    } else {
        pos
    }
}


mod utils {
    /// Accepts x,y as values between -1 -> 1
    /// `up_d_param` / `down_d_param` are the forward and backward diagonal angles as a
    /// fraction of 90° (0.5 = 45°).
    pub fn process_circular_direction(
        x: f32,
        y: f32,
        up_d_param: f32,
        down_d_param: f32,
        horizontal_angle: Option<f32>,
    ) -> (f32, f32) {
        if x == 0.0 && y == 0.0 {
            return (0.0, 0.0);
        }

        // The factors that adjust the angles of the joystick output
        // Convert the d_param from 0->1 to -1 -> 1
        let s_d = if y > 0.0 {
            (up_d_param * 2.0) - 1.0
        } else if y < 0.0 {
            (down_d_param * 2.0) - 1.0
        } else {
            0.0
        };

        // The input number for this is 0->1 which corresponds to the 2 -> 0 range of this parameter, so we need to convert
        let s_y = horizontal_angle.map(|v| (1.0 - v) * 2.0).unwrap_or(0.0);

        let k_x = x;
        let k_y = y;

        let k_a_x = f32::abs(k_x);
        let k_a_y = f32::abs(k_y);

        let k_p_x = if k_x == 0.0 { 1.0 } else { k_x / k_a_x };
        let k_p_y = if k_y == 0.0 { 1.0 } else { k_y / k_a_y };

        let r = {
            if k_a_x > k_a_y {
                (k_a_y * (1f32 - s_d - s_y * k_p_y) + s_y * k_p_y * k_a_x) / k_a_x
            } else {
                (k_a_x * (s_d + 1f32)) / k_a_y
            }
        };

        let d_x: f32;
        let d_y: f32;
        let pi_4 = std::f32::consts::FRAC_PI_4;
        if k_a_x > k_a_y {
            // D1
            d_x = k_p_x * f32::cos(r * pi_4);
            d_y = k_p_y * f32::sin(r * pi_4);
        } else {
            // D2
            d_x = k_p_x * f32::sin(r * pi_4);
            d_y = k_p_y * f32::cos(r * pi_4);
        }

        // let max_k_a = f32::max(k_a_x, k_a_y);
        let max_k_a = 1.0;

        let out_x = max_k_a * d_x;
        let out_y = max_k_a * d_y;

        (out_x, out_y)
    }

    #[allow(dead_code)]
    pub fn float_to_xusb_js_axis(value: f32) -> i16 {
        let mut value = (value.max(-1.0).min(1.0) * 32767.0) as i16;
        if value < i16::MIN + 10 {
            value = i16::MIN;
        }

        value
    }

    #[allow(dead_code)]
    pub fn float_to_ds4_js_axis(value: f32) -> u8 {
        let value = (value.max(-1.0).min(1.0) * 127.0) + 128.0;
        if value >= (u8::MAX - 1) as f32 {
            return u8::MAX;
        }

        if value <= (u8::MIN + 1) as f32 {
            return u8::MIN;
        }

        value as u8
    }
}

impl JoystickState {
    pub fn new() -> Self {
        Self {
            up: JoystickDirectionState::new(),
            down: JoystickDirectionState::new(),
            left: JoystickDirectionState::new(),
            right: JoystickDirectionState::new(),
            seq_counter: 0,
            activation: 0.0,
        }
    }

    /// Sets the raw value above which a key counts as pressed (use the analog range start).
    pub fn set_activation(&mut self, activation: f32) {
        self.activation = activation;
    }

    pub fn get_key_state(&mut self, bind: u8) -> bool {
        #[cfg(windows)]
        {
            let state = unsafe { GetAsyncKeyState(bind as i32) as u32 };
            state & 0x8000 != 0
        }
        #[cfg(not(windows))]
        false
    }

    pub fn set_direction_state_digital(
        &mut self,
        direction: JoystickDirection,
        state: bool,
    ) -> bool {
        self.set_direction_state_analog(direction, if state { 1.0 } else { 0.0 })
    }

    pub fn set_direction_state_analog(&mut self, direction: JoystickDirection, state: f32) -> bool {
        // Digital presses (1.0) must always count as active even if the range start is high.
        let activation = self.activation.min(0.999);
        let counter = &mut self.seq_counter;
        match direction {
            JoystickDirection::Up => self.up.update_analog(state, activation, counter),
            JoystickDirection::Down => self.down.update_analog(state, activation, counter),
            JoystickDirection::Left => self.left.update_analog(state, activation, counter),
            JoystickDirection::Right => self.right.update_analog(state, activation, counter),
        }
    }

    #[allow(dead_code)]
    pub fn update_key_state(
        &mut self,
        direction: JoystickDirection,
        bind_one: Option<&u8>,
        bind_two: Option<&u8>,
    ) -> bool {
        let mut key_state = false;
        if let Some(bind_one) = bind_one {
            key_state |= self.get_key_state(*bind_one);
        }
        if let Some(bind_two) = bind_two {
            key_state |= self.get_key_state(*bind_two);
        }
        self.set_direction_state_digital(direction, key_state)
    }

    #[allow(dead_code)]
    pub fn update_key_states(&mut self, mappings: &JoystickKeyMapping) -> bool {
        self.update_key_state(
            JoystickDirection::Up,
            mappings.up.as_ref(),
            mappings.up_two.as_ref(),
        ) | self.update_key_state(
            JoystickDirection::Down,
            mappings.down.as_ref(),
            mappings.down_two.as_ref(),
        ) | self.update_key_state(
            JoystickDirection::Left,
            mappings.left.as_ref(),
            mappings.left_two.as_ref(),
        ) | self.update_key_state(
            JoystickDirection::Right,
            mappings.right.as_ref(),
            mappings.right_two.as_ref(),
        )
    }

    pub fn get_basic_direction(&self, config: Option<&JoystickAngleConfiguration>) -> (f32, f32) {
        let config = match config {
            Some(c) => c,
            None => return (0.0, 0.0),
        };

        let analog_range = config.analog_range;
        let curve = if config.analog_curve.is_finite() && config.analog_curve > 0.0 {
            config.analog_curve
        } else {
            1.0
        };
        let shape = |v: f32| if curve == 1.0 { v } else { v.powf(curve) };

        let up = shape(self.up.get_with_range(&analog_range));
        let down = shape(self.down.get_with_range(&analog_range));
        let left = shape(self.left.get_with_range(&analog_range));
        let right = shape(self.right.get_with_range(&analog_range));

        let y = resolve_axis(
            up,
            down,
            self.up.pressed_seq,
            self.down.pressed_seq,
            config.socd_mode,
        );
        let x = resolve_axis(
            right,
            left,
            self.right.pressed_seq,
            self.left.pressed_seq,
            config.socd_mode,
        );

        // Pick the angles for the side we're moving towards.
        let use_left_side = config.split_sides && x < 0.0;
        let up_angle = if use_left_side {
            config.up_left_diagonal_angle
        } else {
            config.up_diagonal_angle
        };
        let strafe_angle = if !config.use_left_right_angle {
            1.0
        } else if use_left_side {
            config.left_angle
        } else {
            config.left_right_angle
        };

        // Keep sprint: cap forward diagonals and lone A/D presses at the sprint limit.
        // A lone A/D press with single-key strafing off would point 90° sideways; the cap
        // tilts it forward to the limit instead.
        let (up_angle, strafe_angle) = if config.keep_sprint {
            let limit = (config.sprint_max_angle.clamp(45.0, 90.0)) / 90.0;
            (up_angle.min(limit), strafe_angle.min(limit))
        } else {
            (up_angle, strafe_angle)
        };

        let (out_x, out_y) = utils::process_circular_direction(
            x,
            y,
            up_angle,
            config.down_diagonal_angle,
            Some(strafe_angle),
        );

        if config.analog_magnitude {
            let magnitude = f32::max(x.abs(), y.abs()).min(1.0);
            (out_x * magnitude, out_y * magnitude)
        } else {
            (out_x, out_y)
        }
    }

    #[allow(dead_code)]
    pub fn get_xusb_direction(&self, config: Option<&JoystickAngleConfiguration>) -> (i16, i16) {
        let (x, y) = self.get_basic_direction(config);

        (
            utils::float_to_xusb_js_axis(x),
            utils::float_to_xusb_js_axis(y),
        )
    }

    #[allow(dead_code)]
    pub fn get_ds4_direction(&self, config: Option<&JoystickAngleConfiguration>) -> (u8, u8) {
        let (x, y) = self.get_basic_direction(config);
        (
            utils::float_to_ds4_js_axis(x),
            utils::float_to_ds4_js_axis(-y),
        )
    }
}

/// Rotates the stick towards its target direction at a limited speed instead of snapping,
/// keeping it at the target's distance from centre throughout.
#[derive(Debug, Default)]
pub struct TurnSmoother {
    angle: Option<f32>,
    last: Option<std::time::Instant>,
}

impl TurnSmoother {
    pub fn new() -> Self {
        Self::default()
    }

    /// `ms_per_90` = milliseconds to rotate 90°. 0 or less disables smoothing.
    pub fn step(
        &mut self,
        target: (f32, f32),
        ms_per_90: f32,
        now: std::time::Instant,
    ) -> (f32, f32) {
        let dt_ms = self
            .last
            .map(|t| now.saturating_duration_since(t).as_secs_f32() * 1000.0)
            .unwrap_or(0.0)
            .min(50.0);
        self.last = Some(now);

        let (tx, ty) = target;
        let magnitude = (tx * tx + ty * ty).sqrt();
        if magnitude < 1e-6 {
            self.angle = None;
            return (0.0, 0.0);
        }
        let target_angle = ty.atan2(tx);

        let current = match self.angle {
            Some(a) if ms_per_90.is_finite() && ms_per_90 > 0.0 => a,
            _ => {
                self.angle = Some(target_angle);
                return target;
            }
        };

        let pi = std::f32::consts::PI;
        let mut diff = target_angle - current;
        while diff > pi {
            diff -= 2.0 * pi;
        }
        while diff < -pi {
            diff += 2.0 * pi;
        }

        let max_step = std::f32::consts::FRAC_PI_2 * dt_ms / ms_per_90;
        let new_angle = if diff.abs() <= max_step {
            target_angle
        } else {
            current + diff.signum() * max_step
        };
        self.angle = Some(new_angle);

        if new_angle == target_angle {
            target
        } else {
            (new_angle.cos() * magnitude, new_angle.sin() * magnitude)
        }
    }
}

pub struct ControllerState {
    pub left_joystick: JoystickState,
    pub right_joystick: JoystickState,
}

impl ControllerState {
    pub fn new() -> Self {
        Self {
            left_joystick: JoystickState::new(),
            right_joystick: JoystickState::new(),
        }
    }

    #[cfg(windows)]
    #[allow(dead_code)]
    pub fn get_xusb_report_from_axis(&self, x: f32, y: f32) -> XUSBReport {
        let (lx, ly) = (
            utils::float_to_xusb_js_axis(x),
            utils::float_to_xusb_js_axis(y),
        );
        let (rx, ry) = (
            utils::float_to_xusb_js_axis(0.0),
            utils::float_to_xusb_js_axis(0.0),
        );
        XUSBReport {
            s_thumb_lx: lx,
            s_thumb_ly: ly,
            s_thumb_rx: rx,
            s_thumb_ry: ry,
            ..XUSBReport::default()
        }
    }

    #[cfg(windows)]
    #[allow(dead_code)]
    pub fn get_xusb_report(&self, config: Option<&JoystickAngleConfiguration>) -> XUSBReport {
        let (lx, ly) = self.left_joystick.get_xusb_direction(config);
        let (rx, ry) = self.right_joystick.get_xusb_direction(None);
        XUSBReport {
            s_thumb_lx: lx,
            s_thumb_ly: ly,
            s_thumb_rx: rx,
            s_thumb_ry: ry,
            ..XUSBReport::default()
        }
    }

    #[cfg(windows)]
    #[allow(dead_code)]
    pub fn get_ds4_report_from_axis(&self, x: f32, y: f32) -> DSReport {
        let (lx, ly) = (
            utils::float_to_ds4_js_axis(x),
            utils::float_to_ds4_js_axis(-y),
        );
        let (rx, ry) = (
            utils::float_to_ds4_js_axis(0.0),
            utils::float_to_ds4_js_axis(0.0),
        );
        DSReport {
            b_thumb_lx: lx,
            b_thumb_ly: ly,
            b_thumb_rx: rx,
            b_thumb_ry: ry,
            ..DSReport::default()
        }
    }

    #[cfg(windows)]
    #[allow(dead_code)]
    pub fn get_ds4_report(&self, config: Option<&JoystickAngleConfiguration>) -> DSReport {
        let (lx, ly) = self.left_joystick.get_ds4_direction(config);
        let (rx, ry) = self.right_joystick.get_ds4_direction(None);
        DSReport {
            b_thumb_lx: lx,
            b_thumb_ly: ly,
            b_thumb_rx: rx,
            b_thumb_ry: ry,
            ..DSReport::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ServiceConfiguration;
    use std::time::{Duration, Instant};

    fn cfg() -> JoystickAngleConfiguration {
        ServiceConfiguration::default().left_joystick_strafing_angles
    }

    fn deg_from_forward((x, y): (f32, f32)) -> f32 {
        x.atan2(y).to_degrees()
    }

    fn press(js: &mut JoystickState, d: JoystickDirection) {
        js.set_direction_state_digital(d, true);
    }
    fn release(js: &mut JoystickState, d: JoystickDirection) {
        js.set_direction_state_digital(d, false);
    }

    #[test]
    fn last_input_wins_lets_s_override_held_w() {
        let mut js = JoystickState::new();
        let mut c = cfg();
        c.socd_mode = SocdMode::LastInputWins;
        press(&mut js, JoystickDirection::Up);
        press(&mut js, JoystickDirection::Down);
        let (_, y) = js.get_basic_direction(Some(&c));
        assert!(y < -0.99, "S should win while W is held, got y={}", y);
        release(&mut js, JoystickDirection::Down);
        let (_, y) = js.get_basic_direction(Some(&c));
        assert!(y > 0.99, "releasing S hands control back to W, got y={}", y);
    }

    #[test]
    fn legacy_mode_keeps_original_w_priority() {
        let mut js = JoystickState::new();
        let c = cfg();
        assert_eq!(c.socd_mode, SocdMode::Legacy, "original behaviour is the default");
        press(&mut js, JoystickDirection::Up);
        press(&mut js, JoystickDirection::Down);
        assert!(js.get_basic_direction(Some(&c)).1 > 0.99);
    }

    #[test]
    fn a_then_d_snap_tap_and_neutral() {
        let mut js = JoystickState::new();
        let mut c = cfg();
        c.socd_mode = SocdMode::LastInputWins;
        press(&mut js, JoystickDirection::Left);
        press(&mut js, JoystickDirection::Right);
        // Keep sprint tilts lone A/D to 70°, so x is sin(70°) ≈ 0.94 rather than 1
        assert!(js.get_basic_direction(Some(&c)).0 > 0.9, "D pressed last wins");
        c.socd_mode = SocdMode::FirstInputWins;
        assert!(js.get_basic_direction(Some(&c)).0 < -0.9, "A pressed first wins");
        c.socd_mode = SocdMode::Neutral;
        assert_eq!(js.get_basic_direction(Some(&c)), (0.0, 0.0));
    }

    #[test]
    fn split_sides_give_different_w_a_and_w_d_angles() {
        let mut c = cfg();
        c.split_sides = true;
        c.up_diagonal_angle = 60.0 / 90.0; // W+D
        c.up_left_diagonal_angle = 50.0 / 90.0; // W+A

        let mut js = JoystickState::new();
        press(&mut js, JoystickDirection::Up);
        press(&mut js, JoystickDirection::Right);
        let wd = deg_from_forward(js.get_basic_direction(Some(&c)));
        release(&mut js, JoystickDirection::Right);
        press(&mut js, JoystickDirection::Left);
        let wa = deg_from_forward(js.get_basic_direction(Some(&c)));

        assert!((wd - 60.0).abs() < 0.5, "W+D {}", wd);
        assert!((wa + 50.0).abs() < 0.5, "W+A {}", wa);
    }

    #[test]
    fn unsplit_sides_stay_mirrored() {
        let c = cfg();
        let mut js = JoystickState::new();
        press(&mut js, JoystickDirection::Up);
        press(&mut js, JoystickDirection::Right);
        let wd = deg_from_forward(js.get_basic_direction(Some(&c)));
        release(&mut js, JoystickDirection::Right);
        press(&mut js, JoystickDirection::Left);
        let wa = deg_from_forward(js.get_basic_direction(Some(&c)));
        assert!((wd + wa).abs() < 0.01);
    }

    #[test]
    fn backward_diagonal_default_is_45_and_configurable() {
        let mut c = cfg();
        let mut js = JoystickState::new();
        press(&mut js, JoystickDirection::Down);
        press(&mut js, JoystickDirection::Right);
        let a = deg_from_forward(js.get_basic_direction(Some(&c)));
        assert!((a - 135.0).abs() < 0.5, "default back diagonal {}", a);
        c.down_diagonal_angle = 30.0 / 90.0;
        let a = deg_from_forward(js.get_basic_direction(Some(&c)));
        assert!((a - 150.0).abs() < 0.5, "30° from straight back {}", a);
    }

    #[test]
    fn output_stays_at_full_distance() {
        let c = cfg();
        let mut js = JoystickState::new();
        press(&mut js, JoystickDirection::Up);
        press(&mut js, JoystickDirection::Right);
        let (x, y) = js.get_basic_direction(Some(&c));
        assert!(((x * x + y * y).sqrt() - 1.0).abs() < 1e-4);
    }

    #[test]
    fn analog_magnitude_and_curve() {
        let mut c = cfg();
        c.analog_range = (0.0, 1.0);
        let mut js = JoystickState::new();
        js.set_direction_state_analog(JoystickDirection::Up, 0.5);
        assert!((js.get_basic_direction(Some(&c)).1 - 1.0).abs() < 1e-4, "off: full speed");
        c.analog_magnitude = true;
        assert!((js.get_basic_direction(Some(&c)).1 - 0.5).abs() < 1e-4, "on: half speed");

        // Curve: W full, A half-pressed steers less with curve 2.0 than linear
        c.analog_magnitude = false;
        js.set_direction_state_analog(JoystickDirection::Up, 1.0);
        js.set_direction_state_analog(JoystickDirection::Left, 0.5);
        let linear = deg_from_forward(js.get_basic_direction(Some(&c))).abs();
        c.analog_curve = 2.0;
        let curved = deg_from_forward(js.get_basic_direction(Some(&c))).abs();
        assert!(curved < linear, "curved {} vs linear {}", curved, linear);
    }

    #[test]
    fn turn_smoother_rotates_at_full_distance() {
        let mut s = TurnSmoother::new();
        let t0 = Instant::now();
        assert_eq!(s.step((0.0, 1.0), 40.0, t0), (0.0, 1.0)); // forward
        // Snap target to the right (90°). After 20ms of a 40ms-per-90° setting: ~45°.
        let (x, y) = s.step((1.0, 0.0), 40.0, t0 + Duration::from_millis(20));
        assert!((deg_from_forward((x, y)) - 45.0).abs() < 1.0);
        assert!(((x * x + y * y).sqrt() - 1.0).abs() < 1e-4, "stays at full distance");
        let out = s.step((1.0, 0.0), 40.0, t0 + Duration::from_millis(45));
        assert_eq!(out, (1.0, 0.0), "arrives at target");
    }

    /// Times the stick math. Run with: cargo test --release --lib -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_stick_math() {
        let mut c = cfg();
        c.socd_mode = SocdMode::LastInputWins;
        c.split_sides = true;
        let mut js = JoystickState::new();
        let mut smoother = TurnSmoother::new();
        let n = 1_000_000u32;
        let start = Instant::now();
        let mut acc = 0.0f32;
        for i in 0..n {
            // Alternate W+D and W+A every iteration so every call does real work
            js.set_direction_state_digital(JoystickDirection::Up, true);
            js.set_direction_state_digital(JoystickDirection::Right, i % 2 == 0);
            js.set_direction_state_digital(JoystickDirection::Left, i % 2 == 1);
            let target = js.get_basic_direction(Some(&c));
            let (x, y) = smoother.step(target, 20.0, start + Duration::from_micros(i as u64 * 250));
            acc += x + y;
        }
        let per = start.elapsed().as_nanos() as f64 / n as f64;
        println!("stick math: {:.0} ns per update (checksum {})", per, acc);
    }

    #[test]
    fn keep_sprint_caps_strafes_at_70() {
        let mut c = cfg();
        assert!(c.keep_sprint, "on by default");
        // Even with single-key strafing off (pure sideways) and a wide diagonal set,
        // nothing in the forward half goes past 70°.
        c.use_left_right_angle = false;
        c.up_diagonal_angle = 80.0 / 90.0;

        let mut js = JoystickState::new();
        press(&mut js, JoystickDirection::Right);
        let d_alone = deg_from_forward(js.get_basic_direction(Some(&c)));
        assert!((d_alone - 70.0).abs() < 0.5, "D alone {}", d_alone);

        press(&mut js, JoystickDirection::Up);
        let wd = deg_from_forward(js.get_basic_direction(Some(&c)));
        assert!((wd - 70.0).abs() < 0.5, "W+D {}", wd);

        // Smaller angles are left alone
        c.up_diagonal_angle = 55.0 / 90.0;
        let wd = deg_from_forward(js.get_basic_direction(Some(&c)));
        assert!((wd - 55.0).abs() < 0.5, "W+D {}", wd);

        // Off: A/D alone goes straight sideways again
        c.keep_sprint = false;
        release(&mut js, JoystickDirection::Up);
        let d_alone = deg_from_forward(js.get_basic_direction(Some(&c)));
        assert!((d_alone - 90.0).abs() < 0.5, "D alone without cap {}", d_alone);
    }

    #[test]
    fn turn_smoother_off_is_instant() {
        let mut s = TurnSmoother::new();
        let t0 = Instant::now();
        s.step((0.0, 1.0), 0.0, t0);
        assert_eq!(s.step((1.0, 0.0), 0.0, t0 + Duration::from_millis(1)), (1.0, 0.0));
    }
}
