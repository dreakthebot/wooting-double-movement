//! Timing for the input loop: a high-resolution wait and high-priority scheduling.
//!
//! On Windows the loop uses a high-resolution waitable timer (Windows 10 1803+), which can
//! wake reliably in well under 1ms. If that isn't available it falls back to `Sleep` with the
//! system timer raised to 1ms. The loop thread also registers with the Multimedia Class
//! Scheduler Service ("Games" task), the same mechanism games and audio apps use, so it keeps
//! getting CPU time on schedule while a game is using the processor heavily.

use std::time::Duration;

/// How often the loop checks the keys. 0.25ms = 4000 checks/second, which keeps up with
/// 8000Hz keyboards while costing very little CPU (each check does almost no work).
pub const LOOP_INTERVAL: Duration = Duration::from_micros(250);

#[cfg(windows)]
mod imp {
    use super::*;
    use winapi::shared::ntdef::LARGE_INTEGER;
    use winapi::um::avrt::{AvRevertMmThreadCharacteristics, AvSetMmThreadCharacteristicsW};
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::processthreadsapi::{GetCurrentThread, SetThreadPriority};
    use winapi::um::synchapi::{CreateWaitableTimerExW, SetWaitableTimer, WaitForSingleObject};
    use winapi::um::timeapi::{timeBeginPeriod, timeEndPeriod};
    use winapi::um::winbase::{INFINITE, THREAD_PRIORITY_HIGHEST};
    use winapi::um::winnt::{HANDLE, TIMER_ALL_ACCESS};

    const CREATE_WAITABLE_TIMER_HIGH_RESOLUTION: u32 = 0x0000_0002;

    pub struct LoopTimer {
        timer: HANDLE,
        interval: Duration,
        raised_period: bool,
    }

    // The handle is only used from the loop thread that created it.
    unsafe impl Send for LoopTimer {}

    impl LoopTimer {
        pub fn new(interval: Duration) -> Self {
            let timer = unsafe {
                CreateWaitableTimerExW(
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                    TIMER_ALL_ACCESS,
                )
            };
            // Fallback path needs the 1ms system timer; the high-res timer doesn't.
            let raised_period = timer.is_null();
            if raised_period {
                unsafe {
                    timeBeginPeriod(1);
                }
            }
            LoopTimer {
                timer,
                interval,
                raised_period,
            }
        }

        pub fn is_high_res(&self) -> bool {
            !self.timer.is_null()
        }

        /// Waits roughly one interval.
        pub fn wait(&self) {
            if self.timer.is_null() {
                std::thread::sleep(Duration::from_millis(1));
                return;
            }
            unsafe {
                let mut due: LARGE_INTEGER = std::mem::zeroed();
                // Negative = relative time, in 100ns units.
                *due.QuadPart_mut() = -((self.interval.as_nanos() / 100) as i64).max(1);
                if SetWaitableTimer(self.timer, &due, 0, None, std::ptr::null_mut(), 0) == 0 {
                    std::thread::sleep(Duration::from_millis(1));
                    return;
                }
                WaitForSingleObject(self.timer, INFINITE);
            }
        }
    }

    impl Drop for LoopTimer {
        fn drop(&mut self) {
            unsafe {
                if !self.timer.is_null() {
                    CloseHandle(self.timer);
                }
                if self.raised_period {
                    timeEndPeriod(1);
                }
            }
        }
    }

    /// Raises the current thread's scheduling priority for as long as it's alive.
    pub struct PriorityGuard {
        mmcss: HANDLE,
        elevated: bool,
    }

    impl PriorityGuard {
        pub fn new() -> Self {
            let name: Vec<u16> = "Games\0".encode_utf16().collect();
            let mut task_index: u32 = 0;
            let mmcss = unsafe { AvSetMmThreadCharacteristicsW(name.as_ptr(), &mut task_index) };
            let elevated = if !mmcss.is_null() {
                true
            } else {
                // MMCSS unavailable (service disabled): fall back to a plain priority bump.
                unsafe { SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST as i32) != 0 }
            };
            PriorityGuard { mmcss, elevated }
        }

        pub fn is_elevated(&self) -> bool {
            self.elevated
        }
    }

    impl Drop for PriorityGuard {
        fn drop(&mut self) {
            if !self.mmcss.is_null() {
                unsafe {
                    AvRevertMmThreadCharacteristics(self.mmcss);
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::*;

    pub struct LoopTimer {
        interval: Duration,
    }

    impl LoopTimer {
        pub fn new(interval: Duration) -> Self {
            LoopTimer { interval }
        }
        pub fn is_high_res(&self) -> bool {
            true
        }
        pub fn wait(&self) {
            std::thread::sleep(self.interval);
        }
    }

    pub struct PriorityGuard;

    impl PriorityGuard {
        pub fn new() -> Self {
            PriorityGuard
        }
        pub fn is_elevated(&self) -> bool {
            false
        }
    }
}

pub use imp::{LoopTimer, PriorityGuard};
