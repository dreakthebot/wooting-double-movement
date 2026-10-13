import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  Notification,
  shell,
  Tray,
} from "electron";
import {
  end_gamepad_detection,
  get_xinput_slot,
  start_gamepad_detection,
} from "./native/native";
import ElectronStore from "electron-store";
import { APP_NAME, AppSettings, smallWindowSize } from "./common";
import fs from "fs";
import path from "path";
import install, { REACT_DEVELOPER_TOOLS } from "electron-devtools-installer";
import {
  getLatencyStats,
  getSDKState,
  setServiceConfig,
  startService,
  stopService,
} from "./native";
import {
  defaultKeyMapping,
  defaultLeftJoystickStrafingAngles,
  defaultSettings,
  defaultToggleAccelerator,
  JoystickAngleConfiguration,
  SDKState,
  ServiceConfiguration,
} from "./native/types";
import { functions } from "electron-log";
import { PrettyAcceleratorName } from "./accelerator";
import _ from "lodash";

Object.assign(console, functions);
app.commandLine.appendSwitch("disable-pinch");

const isMac = process.platform === "darwin";

const template: MenuItemConstructorOptions[] = [
  // { role: 'appMenu' }
  ...(isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ] as MenuItemConstructorOptions[],
        },
      ]
    : []),
  // { role: 'fileMenu' }
  {
    label: "File",
    submenu: [
      isMac ? { role: "close" } : { role: "quit" },
    ] as MenuItemConstructorOptions[],
  },
  // { role: 'editMenu' }
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      ...(isMac
        ? [
            { role: "pasteAndMatchStyle" },
            { role: "delete" },
            { role: "selectAll" },
            { type: "separator" },
            {
              label: "Speech",
              submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
            },
          ]
        : [{ role: "delete" }, { type: "separator" }, { role: "selectAll" }]),
    ] as MenuItemConstructorOptions[],
  },
  // { role: 'viewMenu' }
  {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      // { role: "resetZoom" },
      // { role: "zoomIn" },
      // { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ] as MenuItemConstructorOptions[],
  },
  // { role: 'windowMenu' }
  {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      ...(isMac
        ? [
            { type: "separator" },
            { role: "front" },
            { type: "separator" },
            { role: "window" },
          ]
        : [{ role: "close" }]),
    ] as MenuItemConstructorOptions[],
  },
  // {
  //   role: "help",
  //   submenu: [
  //     {
  //       label: "Learn More",
  //       click: async () => {
  //         const { shell } = require("electron");
  //         await shell.openExternal("https://electronjs.org");
  //       },
  //     },
  //   ],
  // },
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);

declare var __dirname: any, process: any;

let mainWindow: Electron.BrowserWindow | null;

/** Opens a link in the browser, but only plain https URLs (no file:, ms-settings:, etc). */
function openExternalSafely(url: string) {
  try {
    if (new URL(url).protocol === "https:") {
      shell.openExternal(url);
      return;
    }
  } catch (_) {
    // invalid URL, fall through
  }
  console.warn(`Blocked opening non-https link: ${url}`);
}

function isDev() {
  return !app.isPackaged;
}

function registerHandlers() {
  ipcMain.on("windowClose", () => {
    mainWindow && mainWindow.close();
    app.quit();
  });

  ipcMain.on("windowMinimize", () => mainWindow && mainWindow.close());

  ipcMain.handle("getVersion", () => app.getVersion());

  ipcMain.on("resize-me", (_, width, height) => {
    console.debug(`Resize to ${width} ${height} requested`);
    if (mainWindow) {
      mainWindow.setMinimumSize(width, height);
      mainWindow.setSize(width, height, true);
    }
  });

}

function createMainWindow() {
  if (mainWindow) {
    return;
  }

  mainWindow = new BrowserWindow({
    width: smallWindowSize[0],
    height: smallWindowSize[1],
    transparent: true,
    frame: false,
    resizable: false,
    show: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadURL(`file://${__dirname}/../public/index.html`);

  // All new windows opened from the app are links: never open them inside the app,
  // and only hand https links to the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", function (event, url) {
    event.preventDefault();
    openExternalSafely(url);
  });

  if (isDev()) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("ready-to-show", () => {
    if (!mainWindow) return;

    mainWindow.show();
    // Auto-updates are intentionally disabled: the official updater would replace this
    // fork with Wooting's build.
  });

  mainWindow.on("closed", () => {
    app.removeAllListeners("browser-window-focus");
    app.removeAllListeners("browser-window-blur");
    mainWindow = null;
  });
}

const isSingleInstance = app.requestSingleInstanceLock();

if (isSingleInstance) {
  app.on("second-instance", () => mainWindow && mainWindow.show());
} else {
  app.quit();
}

if (isDev()) {
  app.setAppUserModelId(process.execPath);
} else {
  app.setAppUserModelId("DoubleMovementPlus.App");
}

app.on("ready", () => {
  serviceManager.init();
  registerHandlers();
  createMainWindow();
  create_tray();
  if (isDev()) {
    install(REACT_DEVELOPER_TOOLS, {
      loadExtensionOptions: { allowFileAccess: true },
    })
      .then((name: string) => console.log(`Added Extension:  ${name}`))
      .catch((err: string) => console.log("An error occurred: ", err));

    // installExtension(REDUX_DEVTOOLS)
    //   .then((name: string) => console.log(`Added Extension:  ${name}`))
    //   .catch((err: string) => console.log("An error occurred: ", err));
  }
});

app.on("window-all-closed", () => {});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  serviceManager.deinit();
});

app.on("activate", () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

function showOrCreateMainWindow() {
  if (mainWindow) {
    mainWindow?.show();
  } else {
    createMainWindow();
  }
}

let tray: Tray | null = null;
const contextMenu = Menu.buildFromTemplate([
  {
    label: "Show Window",
    click: () => {
      showOrCreateMainWindow();
    },
  },
  {
    label: "Toggle Double Movement",
    type: "checkbox",
    //We can tell from the ServiceState whether the service is enabled or not
    checked: false,
    click: ({ checked }) => serviceManager.set_double_movement_enabled(checked),
  },
  { type: "separator" },
  {
    label: "Quit",
    click: () => app.quit(),
  },
]);

function create_tray() {
  if (!tray) {
    tray = new Tray(`${__dirname}/../build/icon.ico`);
    tray.setToolTip(APP_NAME);
    tray.on("double-click", () => {
      showOrCreateMainWindow();
    });
    tray.on("click", () => {
      if (tray) {
        tray.popUpContextMenu();
      }
    });
  }

  contextMenu.items[1].checked = serviceManager.doubleMovementEnabled();
  tray.setContextMenu(contextMenu);
}

let notification: Notification | null = null;
function showNotification(state: boolean) {
  if (notification !== null) {
    notification.close();
    notification = null;
  }

  const config = {
    title: APP_NAME + " " + (state ? "Enabled" : "Disabled"),
    icon: `${__dirname}/../build/icon.ico`,
  };
  notification = new Notification(config);
  notification.show();
}

class ServiceManager {
  running: boolean = false;
  store = new ElectronStore<AppSettings>({
    defaults: defaultSettings,
    migrations: {
      ">=1.4.0": (store) => {
        console.log("Migrating settings to 1.4.0");
        const angles = store.get("leftJoystickAngles") as any;
        // If it has the old setting then lets migrate it to the new one
        if (
          angles &&
          "rightUpAngle" in angles &&
          angles["rightUpAngle"] !== undefined
        ) {
          const newAngles: JoystickAngleConfiguration = {
            ...defaultLeftJoystickStrafingAngles,
            // Leave it turned off for people coming from previous versions
            useLeftRightAngle: false,
            //@ts-ignore
            upDiagonalAngle: angles["rightUpAngle"],
          };
          console.log("Migrated angles: ", newAngles);
          store.set("leftJoystickStrafingAngles", newAngles);
        }
      },
      ">=1.5.0": (store) => {
        console.log("Migrating settings to 1.5.0");
        const angles = store.get("leftJoystickAngles") as any;

        const newAngles: JoystickAngleConfiguration = {
          ...defaultLeftJoystickStrafingAngles,
          ...angles,
        };
        console.log("Migrated angles: ", newAngles);
        store.set("leftJoystickStrafingAngles", newAngles);
      },
    },
  });

  sdk_state: SDKState = { type: "Uninitialized" };

  /**
   * This fork stores its settings separately from the original Wooting app. On first run,
   * copy the original app's angles, keybinds and hotkey across (not the on/off state).
   */
  importLegacySettings() {
    if (this.store.get("legacySettingsImported")) return;
    this.store.set("legacySettingsImported", true);

    const legacyPath = path.join(
      app.getPath("appData"),
      "wooting-double-movement",
      "config.json"
    );
    try {
      if (!fs.existsSync(legacyPath)) return;
      const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
      if (legacy.leftJoystickStrafingAngles) {
        this.store.set("leftJoystickStrafingAngles", {
          ...defaultLeftJoystickStrafingAngles,
          ...legacy.leftJoystickStrafingAngles,
        });
      }
      if (legacy.keyMapping) this.store.set("keyMapping", legacy.keyMapping);
      if (Array.isArray(legacy.enabledToggleAccelerator))
        this.store.set(
          "enabledToggleAccelerator",
          legacy.enabledToggleAccelerator
        );
      if (typeof legacy.useAnalogInput === "boolean")
        this.store.set("useAnalogInput", legacy.useAnalogInput);
      console.log("Imported settings from the original Wooting app");
    } catch (e) {
      console.warn("Couldn't import the original app's settings", e);
    }
  }

  init() {
    this.importLegacySettings();
    if (this.store.get("doubleMovementEnabled")) {
      this.start();
    }

    ipcMain.handle("store_getAll", (_, name: string) => {
      return this.store.store;
    });

    ipcMain.handle("store_get", (_, name: string) => {
      return this.store.get(name);
    });

    ipcMain.on("store_set", (_, name: keyof AppSettings, value) => {
      const previous = this.store.get(name);
      this.store_set(name, value);
      this.update_state();

      if (name === "controllerType") {
        // The virtual controller's type is fixed once created, so recreate it.
        if (this.running && previous !== value) {
          this.stop();
          this.start();
        }
      } else if (
        name == "leftJoystickStrafingAngles" ||
        name === "keyMapping" ||
        name === "useAnalogInput" ||
        name === "onlyWhenFocused" ||
        name === "focusWindowTitle"
      ) {
        this.update_config();
      }
    });

    ipcMain.on("reset-advanced-strafing", (_) => {
      this.resetAdvancedStrafingConfig();
    });
    ipcMain.on("reset-advanced-bind", (_) => {
      this.resetAdvancedKeyBindConfig();
    });

    const registerToggleShortcut = (acceleratorParts: number[]) => {
      if (acceleratorParts.length === 0) {
        console.warn("Attempted to register empty accelerator");
        return;
      }

      const accelerator = PrettyAcceleratorName(
        "accelerator",
        acceleratorParts
      );
      console.debug(
        `Registering toggle shortcut with accelerator ${accelerator}`
      );
      const ret = globalShortcut.register(accelerator, () => {
        console.debug("Toggle accelerator was pressed");
        this.set_double_movement_enabled(!this.doubleMovementEnabled());
      });

      if (!ret) {
        console.error("Failed to register globalShortcut");
      }
    };

    const registerShortcuts = () => {
      const accelerator = this.store.get("enabledToggleAccelerator");
      if (accelerator.length > 0) registerToggleShortcut(accelerator);
    };
    registerShortcuts();

    this.store.onDidChange("enabledToggleAccelerator", (newValue, oldValue) => {
      if (oldValue && oldValue.length > 0)
        globalShortcut.unregister(
          PrettyAcceleratorName("accelerator", oldValue)
        );
      else console.warn("Old accelerator is undefined, not unregistering...");

      if (newValue && newValue.length > 0) registerToggleShortcut(newValue);
      else
        console.warn(
          "New acceleartor is undefined, not registering shortcut..."
        );
    });

    ipcMain.on("hotkey-edit-start", (_) => {
      console.debug("Unregister all");
      globalShortcut.unregisterAll();
    });

    ipcMain.on("hotkey-edit-cancel", (_) => {
      console.debug("Hotkey edit cancelled");
      registerShortcuts();
    });

    ipcMain.handle("get_latency_stats", (_) => {
      return this.running ? getLatencyStats() : null;
    });

    ipcMain.handle("get_sdk_state", (_) => {
      return this.sdk_state;
    });

    ipcMain.on("start-gamepad-detection", (_) => {
      start_gamepad_detection();
    });

    ipcMain.on("end-gamepad-detection", (_) => {
      end_gamepad_detection();
    });

    ipcMain.on("open-url", function (event, url) {
      openExternalSafely(url);
    });

    setInterval(() => {
      this.check_sdk_state();
    }, 1000);
  }

  check_sdk_state() {
    let newState: SDKState;
    // TODO: More optimal getter
    if (this.running && this.serviceConfiguration().useAnalogInput) {
      newState = getSDKState();
    } else {
      newState = { type: "Uninitialized" };
    }

    if (!_.isEqual(newState, this.sdk_state)) {
      this.sdk_state = newState;
      mainWindow?.webContents.send("sdk_state_changed", newState);
    }
  }

  store_set<Key extends keyof AppSettings>(name: Key, value: AppSettings[Key]) {
    mainWindow?.webContents.send("store_changed", name, value);
    this.store.set(name, value);
  }

  doubleMovementEnabled(): boolean {
    return this.store.get("doubleMovementEnabled");
  }

  set_double_movement_enabled(value: boolean) {
    showNotification(value);
    this.store_set("doubleMovementEnabled", value);
    this.update_state();
  }

  serviceConfiguration(): ServiceConfiguration {
    return {
      leftJoystickStrafingAngles: {
        ...defaultLeftJoystickStrafingAngles,
        ...this.store.get("leftJoystickStrafingAngles"),
      },
      keyMapping: {
        ...defaultKeyMapping,
        ...this.store.get("keyMapping"),
      },
      useAnalogInput: this.store.get("useAnalogInput") ?? false,
      controllerType:
        this.store.get("controllerType") ?? defaultSettings.controllerType,
      onlyWhenFocused:
        this.store.get("onlyWhenFocused") ?? defaultSettings.onlyWhenFocused,
      focusWindowTitle:
        this.store.get("focusWindowTitle") ?? defaultSettings.focusWindowTitle,
    };
  }

  resetAdvancedKeyBindConfig() {
    this.store_set("keyMapping", defaultKeyMapping);
    this.update_config();
  }

  resetAdvancedStrafingConfig() {
    this.store_set(
      "leftJoystickStrafingAngles",
      defaultLeftJoystickStrafingAngles
    );
    this.update_config();
  }

  update_config() {
    if (this.running) {
      setServiceConfig(this.serviceConfiguration());
    }
  }

  update_state() {
    create_tray();

    if (this.doubleMovementEnabled()) {
      this.start();
    } else {
      this.stop();
    }
  }

  deinit() {
    if (this.running) {
      this.stop();
    }
  }

  onError = (error: Error) => {
    console.error(error);
    dialog.showErrorBox(
      `${APP_NAME} stopped`,
      `The virtual controller stopped because of an error, so double movement has been turned off. You can turn it back on to retry.\n\nIf this keeps happening, check that "Nefarius Virtual Gamepad Emulation Bus" (ViGEmBus) is installed.\n\n${error}`
    );
    this.set_double_movement_enabled(false);
  };

  restart() {
    this.stop();
    this.start();
  }

  start() {
    if (this.running) return;

    let started = false;
    try {
      started = startService(this.serviceConfiguration(), this.onError);
    } catch (e) {
      console.error("startService threw", e);
    }

    if (!started) {
      dialog.showErrorBox(
        `${APP_NAME} couldn't start`,
        `The virtual controller couldn't be created, so double movement has been turned off.\n\nThis is usually because "Nefarius Virtual Gamepad Emulation Bus" (ViGEmBus) isn't installed correctly. Check the log file for details.`
      );
      // Only record that it's off; the service isn't running so there's nothing to stop.
      this.store_set("doubleMovementEnabled", false);
      create_tray();
      return;
    }

    this.running = true;

    setTimeout(() => {
      const slot = get_xinput_slot();
      if (slot != null && slot > 0) {
        dialog.showMessageBox({
          type: "error",
          title: "Player slot warning",
          message: `${APP_NAME}'s controller is not in player slot 1, rather slot ${
            slot + 1
          }. You might experience issues in game. \n\nRemove all connected controllers, remove any virtual controllers, and restart this app.`,
        });
      }
    }, 1000);

    this.check_sdk_state();
  }

  stop() {
    if (this.running) {
      stopService();
      this.running = false;

      this.check_sdk_state();
    }
  }
}

const serviceManager = new ServiceManager();
