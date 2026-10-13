//! Detects whether the game window is focused, so the virtual controller can go quiet
//! when you alt-tab. Uses only the foreground window's title: it never opens a handle to
//! the game process, which anti-cheat protected games may treat as suspicious.

/// Case-insensitive "title contains needle". An empty needle matches everything.
pub fn title_matches(title: &str, needle: &str) -> bool {
    let needle = needle.trim();
    if needle.is_empty() {
        return true;
    }
    title.to_lowercase().contains(&needle.to_lowercase())
}

#[cfg(windows)]
pub fn foreground_window_title() -> Option<String> {
    use winapi::um::winuser::{GetForegroundWindow, GetWindowTextW};
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }
        let mut buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len <= 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

#[cfg(not(windows))]
#[allow(dead_code)]
pub fn foreground_window_title() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_fortnite_title() {
        assert!(title_matches("Fortnite  ", "Fortnite"));
        assert!(title_matches("FORTNITE", "fortnite"));
        assert!(!title_matches("Discord", "Fortnite"));
        assert!(title_matches("anything", "  "));
    }
}
