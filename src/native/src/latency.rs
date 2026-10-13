//! Measures how quickly the app turns key presses into stick updates.
//!
//! Each loop tick records:
//! - the tick interval (how long between two key checks). A key pressed right after a
//!   check waits up to one interval to be seen, so on average half an interval.
//! - the processing time of ticks that sent a new stick position to the virtual
//!   controller (reading keys, computing the angle, and the driver call).
//!
//! Stats are gathered over a short window and published as a snapshot for the UI.

use serde::Serialize;
use std::time::Duration;

#[derive(Serialize, Debug, Clone, Default, PartialEq)]
pub struct LatencySnapshot {
    /// The interval the loop aims for, in microseconds.
    #[serde(rename = "targetIntervalUs")]
    pub target_interval_us: u32,
    #[serde(rename = "avgIntervalUs")]
    pub avg_interval_us: u32,
    /// 99% of intervals were at or below this.
    #[serde(rename = "p99IntervalUs")]
    pub p99_interval_us: u32,
    #[serde(rename = "maxIntervalUs")]
    pub max_interval_us: u32,
    /// Checks per second actually achieved.
    #[serde(rename = "checksPerSecond")]
    pub checks_per_second: u32,
    /// Processing time of ticks that sent a stick update (detection to driver call done).
    #[serde(rename = "avgSendUs")]
    pub avg_send_us: u32,
    #[serde(rename = "maxSendUs")]
    pub max_send_us: u32,
    /// Stick updates sent during the window.
    #[serde(rename = "updatesSent")]
    pub updates_sent: u32,
    /// Typical delay the app adds: half an interval of waiting plus processing.
    #[serde(rename = "typicalDelayUs")]
    pub typical_delay_us: u32,
    /// Near-worst delay: a p99 interval of waiting plus the slowest send.
    #[serde(rename = "worstDelayUs")]
    pub worst_delay_us: u32,
    /// Whether the loop got high-priority scheduling from Windows.
    #[serde(rename = "highPriority")]
    pub high_priority: bool,
    /// Whether the high-resolution timer is in use (false = fallback sleep).
    #[serde(rename = "highResTimer")]
    pub high_res_timer: bool,
}

pub struct LatencyWindow {
    target: Duration,
    intervals_us: Vec<u32>,
    elapsed: Duration,
    send_total_us: u64,
    send_max_us: u32,
    sends: u32,
}

/// How often a snapshot is published.
pub const WINDOW: Duration = Duration::from_millis(500);

fn us(d: Duration) -> u32 {
    d.as_micros().min(u32::MAX as u128) as u32
}

impl LatencyWindow {
    pub fn new(target: Duration) -> Self {
        LatencyWindow {
            target,
            intervals_us: Vec::with_capacity(4096),
            elapsed: Duration::ZERO,
            send_total_us: 0,
            send_max_us: 0,
            sends: 0,
        }
    }

    /// Records one tick. `sent` is the processing time if this tick sent an update.
    pub fn record(&mut self, interval: Duration, sent: Option<Duration>) {
        self.intervals_us.push(us(interval));
        self.elapsed += interval;
        if let Some(s) = sent {
            let s = us(s);
            self.send_total_us += s as u64;
            self.send_max_us = self.send_max_us.max(s);
            self.sends += 1;
        }
    }

    pub fn is_full(&self) -> bool {
        self.elapsed >= WINDOW
    }

    /// Builds a snapshot and starts a new window.
    pub fn take_snapshot(&mut self, high_priority: bool, high_res_timer: bool) -> LatencySnapshot {
        let n = self.intervals_us.len();
        let mut snap = LatencySnapshot {
            target_interval_us: us(self.target),
            high_priority,
            high_res_timer,
            updates_sent: self.sends,
            ..Default::default()
        };
        if n > 0 {
            let total: u64 = self.intervals_us.iter().map(|&v| v as u64).sum();
            snap.avg_interval_us = (total / n as u64) as u32;
            let mut sorted = self.intervals_us.clone();
            sorted.sort_unstable();
            let idx = ((n as f64) * 0.99).ceil() as usize;
            snap.p99_interval_us = sorted[idx.saturating_sub(1).min(n - 1)];
            snap.max_interval_us = *sorted.last().unwrap();
            let secs = self.elapsed.as_secs_f64();
            if secs > 0.0 {
                snap.checks_per_second = (n as f64 / secs).round() as u32;
            }
        }
        if self.sends > 0 {
            snap.avg_send_us = (self.send_total_us / self.sends as u64) as u32;
            snap.max_send_us = self.send_max_us;
        }
        // If nothing was sent this window, processing is still bounded by the work of a
        // tick; report the waiting part on its own.
        snap.typical_delay_us = snap.avg_interval_us / 2 + snap.avg_send_us;
        snap.worst_delay_us = snap.p99_interval_us + snap.max_send_us;

        self.intervals_us.clear();
        self.elapsed = Duration::ZERO;
        self.send_total_us = 0;
        self.send_max_us = 0;
        self.sends = 0;
        snap
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_interval_and_send_stats() {
        let mut w = LatencyWindow::new(Duration::from_micros(250));
        // 99 ticks at 250us, one slow tick at 2ms
        for _ in 0..99 {
            w.record(Duration::from_micros(250), None);
        }
        w.record(Duration::from_micros(2000), Some(Duration::from_micros(40)));
        w.record(Duration::from_micros(250), Some(Duration::from_micros(20)));
        let s = w.take_snapshot(true, true);
        assert_eq!(s.target_interval_us, 250);
        assert_eq!(s.max_interval_us, 2000);
        assert_eq!(s.p99_interval_us, 250, "one outlier in 101 stays out of p99");
        assert_eq!(s.avg_send_us, 30);
        assert_eq!(s.max_send_us, 40);
        assert_eq!(s.updates_sent, 2);
        assert_eq!(s.worst_delay_us, 250 + 40);
        assert!(s.checks_per_second > 3000 && s.checks_per_second < 4000);
    }

    #[test]
    fn window_resets_after_snapshot() {
        let mut w = LatencyWindow::new(Duration::from_micros(250));
        for _ in 0..2000 {
            w.record(Duration::from_micros(250), None);
        }
        assert!(w.is_full());
        w.take_snapshot(false, false);
        assert!(!w.is_full());
        let s = w.take_snapshot(false, false);
        assert_eq!(s.avg_interval_us, 0);
        assert_eq!(s.updates_sent, 0);
    }
}
