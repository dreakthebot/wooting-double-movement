
!include LogicLib.nsh

; Driver installers are downloaded and checksum-verified by src/scripts/afterPack.js.
; They're extracted to the temporary plugins folder (cleaned up automatically) rather
; than left in the install folder.
!macro customInstall
  ${ifNot} ${isUpdated}
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"

    ; ViGEmBus (virtual controller driver): only install if it isn't already present.
    ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\ViGEmBus" "ImagePath"
    ${If} $0 == ""
      File "${BUILD_RESOURCES_DIR}\installers\ViGEmBusSetup.exe"
      ; Run the vendor's own installer so you can see and approve what it installs.
      ExecWait '"$PLUGINSDIR\ViGEmBusSetup.exe"'
    ${EndIf}

    ; Wooting Analog SDK (only used for analog input).
    File "${BUILD_RESOURCES_DIR}\installers\wooting_analog_sdk.msi"
    ExecWait 'msiexec /i "$PLUGINSDIR\wooting_analog_sdk.msi" /qb'

    SetOutPath "$INSTDIR"
  ${endIf}
!macroend
