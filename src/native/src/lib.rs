#[macro_use]
extern crate lazy_static;
extern crate wooting_analog_wrapper;

use dirs::config_dir;
use log::*;
use neon::event::EventQueue;
use neon::handle::Root;
use neon::prelude::*;
use simplelog::*;
use std::fs::{create_dir_all, OpenOptions};
use std::sync::atomic::{AtomicBool, Ordering};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::Duration;

mod config;
mod controller;
mod focus;
#[cfg(windows)]
mod service;

use config::ServiceConfiguration;
#[cfg(windows)]
use service::Service;

/// Raises the Windows timer resolution to 1ms for as long as it's alive.
struct HighResTimer;

impl HighResTimer {
    #[allow(dead_code)]
    fn new() -> Self {
        #[cfg(windows)]
        unsafe {
            winapi::um::timeapi::timeBeginPeriod(1);
        }
        HighResTimer
    }
}

impl Drop for HighResTimer {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            winapi::um::timeapi::timeEndPeriod(1);
        }
    }
}

lazy_static! {
    static ref MSG_THREAD_RUNNING: AtomicBool = AtomicBool::new(false);
    static ref MESSAGE_LOOP: Mutex<Option<thread::JoinHandle<()>>> = Mutex::new(None);
}

#[cfg(windows)]
lazy_static! {
    static ref SERVICE: Arc<Mutex<Service>> = Arc::new(Mutex::new(Service::new()));
}

/// Locks a mutex, recovering it if an earlier panic poisoned it. Without this, a single
/// panic would make every later lock fail and the app would be stuck until restarted.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| {
        warn!("Recovering a lock poisoned by an earlier panic");
        poisoned.into_inner()
    })
}

#[cfg(windows)]
fn service() -> MutexGuard<'static, Service> {
    lock(&SERVICE)
}

/// Polling errors are usually transient (e.g. one failed report). Only give up after this
/// many in a row (~0.25s at 1ms per tick).
#[allow(dead_code)]
const MAX_CONSECUTIVE_POLL_ERRORS: u32 = 250;

#[allow(dead_code)]
fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        format!("panic: {}", s)
    } else if let Some(s) = payload.downcast_ref::<String>() {
        format!("panic: {}", s)
    } else {
        "panic with unknown payload".to_string()
    }
}

/// Calls the JS `onError` callback (on the JS thread) with `message`.
#[allow(dead_code)]
fn report_fatal(queue: &EventQueue, callback: Root<JsFunction>, message: String) {
    let sent = queue.try_send(move |mut cx| {
        let callback = callback.into_inner(&mut cx);
        let this = cx.undefined();
        let error = cx.error(message)?.upcast::<JsValue>();
        callback.call(&mut cx, this, vec![error])?;
        Ok(())
    });
    if sent.is_err() {
        error!("Could not deliver service error to the UI");
    }
}

/// Releases a JS callback handle on the JS thread (dropping it elsewhere leaks it).
#[allow(dead_code)]
fn release_callback(queue: &EventQueue, callback: Root<JsFunction>) {
    let _ = queue.try_send(move |mut cx| {
        callback.drop(&mut cx);
        Ok(())
    });
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    let mut targets: Vec<Box<dyn SharedLogger>> = vec![TermLogger::new(
        LevelFilter::Debug,
        Config::default(),
        TerminalMode::Mixed,
        ColorChoice::Always,
    )];
    let dir = config_dir().unwrap().join("double-movement-plus/logs");
    match create_dir_all(&dir) {
        Ok(_) => {
            let log_path = dir.join("service.log");
            match OpenOptions::new()
                .create(true)
                .write(true)
                .append(true)
                .open(log_path)
            {
                Ok(file) => {
                    targets.push(WriteLogger::new(
                        LevelFilter::Debug,
                        Config::default(),
                        file,
                    ));
                    println!("Successfully created WriteLogger");
                }
                Err(e) => {
                    println!("Error creating service log file {:?}", e);
                }
            }
        }
        Err(e) => {
            println!("Error creating logging directory {:?}", e);
        }
    }

    if let Err(e) = CombinedLogger::init(targets) {
        println!("Failed to init CombinedLogger {:?}", e);
    }

    info!("Service module initialized");

    cx.export_function("start_service", start_service)?;
    cx.export_function("stop_service", stop_service)?;
    cx.export_function("get_xinput_slot", get_xinput_slot)?;
    cx.export_function("get_sdk_state", get_sdk_state)?;
    cx.export_function("set_config", set_config)?;
    cx.export_function("start_gamepad_detection", start_gamepad_detection)?;
    cx.export_function("end_gamepad_detection", end_gamepad_detection)?;

    Ok(())
}

fn start_service(mut cx: FunctionContext) -> JsResult<JsBoolean> {
    {
        let mut message_loop = lock(&MESSAGE_LOOP);
        if let Some(handle) = message_loop.as_ref() {
            if !handle.is_finished() {
                warn!("start_service was called when the service was already running, ignoring...");
                return Ok(cx.boolean(true));
            }
            // The loop stopped on its own (after an error); clean it up and start fresh.
            if let Some(handle) = message_loop.take() {
                let _ = handle.join();
            }
        }
    }

    let config_arg = cx.argument::<JsString>(0)?.value(&mut cx);
    info!("Received config {}", config_arg);
    let config: ServiceConfiguration = match serde_json::from_str(&config_arg[..]) {
        Ok(c) => c,
        Err(e) => {
            error!("Invalid config passed to start_service: {}", e);
            return Ok(cx.boolean(false));
        }
    };

    // Optional JS callback for errors that happen after startup.
    let callback = match cx.argument_opt(1) {
        Some(value) => match value.downcast::<JsFunction, _>(&mut cx) {
            Ok(f) => Some(f.root(&mut cx)),
            Err(_) => None,
        },
        None => None,
    };
    #[allow(unused_variables)]
    let queue = cx.queue();

    #[cfg(windows)]
    {
        let init = catch_unwind(AssertUnwindSafe(|| service().init(config)));
        let failure = match init {
            Ok(Ok(())) => None,
            Ok(Err(e)) => Some(format!("{:#}", e)),
            Err(panic) => Some(panic_message(panic.as_ref())),
        };
        if let Some(message) = failure {
            error!("The service failed to start: {}", message);
            // Undo any partial setup (ViGEm connection, analog SDK) so a retry starts clean.
            service().stop();
            if let Some(callback) = callback {
                release_callback(&queue, callback);
            }
            return Ok(cx.boolean(false));
        }
    }
    #[cfg(not(windows))]
    drop(config);

    MSG_THREAD_RUNNING.store(true, Ordering::SeqCst);
    info!("Starting service");
    #[cfg(windows)]
    lock(&MESSAGE_LOOP).replace(thread::spawn(move || {
        // Windows' default timer resolution is ~15.6ms, which would turn the 1ms sleep
        // below into ~64 updates/sec. Request 1ms resolution while the loop runs.
        let _timer = HighResTimer::new();
        let mut callback = callback;
        let mut consecutive_errors: u32 = 0;

        while MSG_THREAD_RUNNING.load(Ordering::SeqCst) {
            let result = catch_unwind(AssertUnwindSafe(|| service().poll()));
            let fatal = match result {
                Ok(Ok(())) => {
                    consecutive_errors = 0;
                    None
                }
                Ok(Err(e)) => {
                    consecutive_errors += 1;
                    if consecutive_errors == 1 || consecutive_errors % 100 == 0 {
                        error!("Error during polling (x{}): {:#}", consecutive_errors, e);
                    }
                    if consecutive_errors >= MAX_CONSECUTIVE_POLL_ERRORS {
                        Some(format!("{:#}", e))
                    } else {
                        None
                    }
                }
                Err(panic) => Some(panic_message(panic.as_ref())),
            };

            if let Some(message) = fatal {
                error!("Service stopped after an error: {}", message);
                MSG_THREAD_RUNNING.store(false, Ordering::SeqCst);
                // Centre the stick so the character doesn't keep walking.
                let _ = catch_unwind(AssertUnwindSafe(|| service().neutral()));
                if let Some(callback) = callback.take() {
                    report_fatal(&queue, callback, message);
                }
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }

        if let Some(callback) = callback.take() {
            release_callback(&queue, callback);
        }
    }));

    #[cfg(not(windows))]
    if let Some(callback) = callback {
        callback.drop(&mut cx);
    }

    return Ok(cx.boolean(true));
}

fn stop_service(mut cx: FunctionContext) -> JsResult<JsNull> {
    MSG_THREAD_RUNNING.store(false, Ordering::SeqCst);
    info!("Stopping service");
    #[cfg(windows)]
    {
        if let Some(thread) = lock(&MESSAGE_LOOP).take() {
            if thread.join().is_err() {
                error!("Service thread ended with a panic");
            }
        }
        service().stop();
    }
    return Ok(cx.null());
}

fn get_xinput_slot(mut cx: FunctionContext) -> JsResult<JsValue> {
    #[cfg(windows)]
    let slot = service().get_xinput_slot();

    #[cfg(windows)]
    if let Some(slot) = slot {
        return Ok(cx.number(slot).upcast());
    }

    return Ok(cx.null().upcast());
}

fn get_sdk_state(mut cx: FunctionContext) -> JsResult<JsValue> {
    #[cfg(windows)]
    {
        let state = service().get_sdk_state();

        return Ok(cx
            .string(serde_json::to_string(&state).expect("Failed to serialize sdk state"))
            .upcast());
    }

    #[cfg(not(windows))]
    return Ok(cx.null().upcast());
}

fn set_config(mut cx: FunctionContext) -> JsResult<JsNull> {
    let config_arg = cx.argument::<JsString>(0)?.value(&mut cx);
    let config: ServiceConfiguration = match serde_json::from_str(&config_arg[..]) {
        Ok(c) => c,
        Err(e) => {
            error!("Invalid config passed to set_config: {}", e);
            return Ok(cx.null());
        }
    };
    info!("Received config {:?}", config);
    #[cfg(windows)]
    if let Err(e) = service().set_config(config) {
        error!("Failed to apply config: {:#}", e);
    }
    return Ok(cx.null());
}

fn start_gamepad_detection(mut cx: FunctionContext) -> JsResult<JsNull> {
    #[cfg(windows)]
    service().set_gamepad_detection_state(true);
    return Ok(cx.null());
}

fn end_gamepad_detection(mut cx: FunctionContext) -> JsResult<JsNull> {
    #[cfg(windows)]
    service().set_gamepad_detection_state(false);
    return Ok(cx.null());
}
