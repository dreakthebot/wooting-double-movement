import {
  VStack,
  Flex,
  Heading,
  Kbd,
  Spacer,
  Switch,
  Text,
  Select,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  HStack,
  Input,
} from "@chakra-ui/react";
import { useRemoteValue } from "ipc";
import {
  ControllerType,
  JoystickAngleConfiguration,
  SocdMode,
} from "native/types";
import React, { useCallback, useState } from "react";
import { InfoTooltip } from "../general/InfoTooltip";
import { AngleControl } from "../settings/angle/AngleControl";
import { strafeAngleRange } from "./StrafeSettings";
import { keybindDisplay } from "./Utils";
import { ResponsivenessPanel } from "./Responsiveness";
import { CurveEditor, CurvePoint } from "./CurveEditor";

const backDiagonalRange: [number, number] = [30, 70];

function SectionTitle(props: { title: string; children: React.ReactNode }) {
  return (
    <Flex>
      <Heading size="sm">{props.title}</Heading>
      <InfoTooltip ml="7px" mt="2px">
        <Text pt="1" fontSize="sm">
          {props.children}
        </Text>
      </InfoTooltip>
    </Flex>
  );
}

function RuleWarning(props: { children: React.ReactNode }) {
  return (
    <Text fontSize="xs" color="orange.400">
      ⚠ {props.children}
    </Text>
  );
}

function ToggleRow(props: {
  title: string;
  tooltip: React.ReactNode;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <Flex width="100%" onClick={props.onToggle} cursor="pointer">
      <SectionTitle title={props.title}>{props.tooltip}</SectionTitle>
      <Spacer />
      {/* Render as div so onClick isn't triggered twice */}
      <Switch colorScheme="accent" isChecked={props.checked} as="div" />
    </Flex>
  );
}

/** Slider that only commits on release, so the service isn't flooded with config updates. */
function ValueSlider(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState<number | null>(null);
  const shown = local ?? props.value;
  return (
    <HStack width="100%" spacing="4">
      <Slider
        colorScheme="accent"
        min={props.min}
        max={props.max}
        step={props.step}
        value={shown}
        onChange={setLocal}
        onChangeEnd={(v) => {
          setLocal(null);
          if (v !== props.value) props.onChange(v);
        }}
      >
        <SliderTrack>
          <SliderFilledTrack />
        </SliderTrack>
        <SliderThumb />
      </Slider>
      <Text minWidth="64px" textAlign="right" fontSize="sm">
        {props.format(shown)}
      </Text>
    </HStack>
  );
}

export function MovementSettingsTab() {
  const [keyMapping] = useRemoteValue("keyMapping");
  const [config, setConfig] = useRemoteValue("leftJoystickStrafingAngles");
  const [controllerType, setControllerType] = useRemoteValue("controllerType");
  const [onlyWhenFocused, setOnlyWhenFocused] =
    useRemoteValue("onlyWhenFocused");
  const [focusTitle, setFocusTitle] = useRemoteValue("focusWindowTitle");
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const update = useCallback(
    (patch: Partial<JoystickAngleConfiguration>) =>
      setConfig({ ...config, ...patch }),
    [config]
  );

  const k = keyMapping.leftJoystick;
  const W = keybindDisplay(k.up, "W");
  const A = keybindDisplay(k.left, "A");
  const S = keybindDisplay(k.down, "S");
  const D = keybindDisplay(k.right, "D");

  const toggleSplit = useCallback(() => {
    if (!config.splitSides) {
      // Start the left side as a mirror of the right so nothing changes until adjusted
      update({
        splitSides: true,
        upLeftDiagonalAngle: config.upDiagonalAngle,
        leftAngle: config.leftRightAngle,
      });
    } else {
      update({ splitSides: false });
    }
  }, [config, update]);

  return (
    <VStack align="stretch" spacing="5" pb="4">
      <VStack align="stretch" spacing="2">
        <ToggleRow
          title="Keep sprint while strafing"
          checked={config.keepSprint ?? true}
          onToggle={() => update({ keepSprint: !(config.keepSprint ?? true) })}
          tooltip={
            <>
              Fortnite only lets you sprint while you move within about{" "}
              {config.sprintMaxAngle ?? 70}° of straight forward. This keeps every
              forward direction inside that limit, including {A} or {D} pressed on
              their own, so strafing never drops you out of sprint. Wider angle
              settings are capped at the limit while this is on.
            </>
          }
        />
        <Text fontSize="xs" color="gray.500">
          Caps {W}+{A}, {W}+{D}, and {A}/{D} alone at {config.sprintMaxAngle ?? 70}° from forward.
        </Text>
      </VStack>

      <VStack align="stretch" spacing="2">
        <SectionTitle title="Controller type">
          Which controller the app pretends to be. If the game ignores the
          stick, try the other one. Changing this briefly restarts the virtual
          controller.
        </SectionTitle>
        <Select
          size="sm"
          value={controllerType ?? "DualShock4"}
          onChange={(e) =>
            setControllerType(e.target.value as ControllerType)
          }
        >
          <option value="DualShock4">PlayStation (DualShock 4)</option>
          <option value="Xbox360">Xbox 360</option>
        </Select>
      </VStack>

      <VStack align="stretch" spacing="2">
        <ToggleRow
          title="Only while game is focused"
          checked={!!onlyWhenFocused}
          onToggle={() => setOnlyWhenFocused(!onlyWhenFocused)}
          tooltip={
            <>
              The stick only moves while a window whose title contains the text
              below is in front. Alt-tabbing centres the stick, so typing{" "}
              {W}
              {A}
              {S}
              {D} elsewhere won't move you in game.
            </>
          }
        />
        {onlyWhenFocused && (
          <Input
            size="sm"
            value={titleDraft ?? focusTitle ?? "Fortnite"}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (titleDraft !== null && titleDraft !== focusTitle) {
                setFocusTitle(titleDraft);
              }
              setTitleDraft(null);
            }}
            placeholder="Window title contains…"
          />
        )}
      </VStack>

      <VStack align="stretch" spacing="2">
        <SectionTitle title="Opposite keys">
          What happens when opposite keys are held together, e.g. holding {W}{" "}
          and tapping {S}, or rolling from {A} to {D}. "Last pressed wins" lets
          a tap override a held key and hands control back when you release it.
          Similar "snap tap" features have been banned in some games; check the
          game's rules before using anything other than Original.
        </SectionTitle>
        <Select
          size="sm"
          value={config.socdMode}
          onChange={(e) => update({ socdMode: e.target.value as SocdMode })}
        >
          <option value="Legacy">Original (Forward / Right always win)</option>
          <option value="LastInputWins">Last pressed wins (snap-tap)</option>
          <option value="FirstInputWins">First pressed wins</option>
          <option value="Neutral">Cancel out (stop)</option>
        </Select>
        {config.socdMode !== "Legacy" && (
          <RuleWarning>
            Snap-tap style input has been banned in some games. Check the
            game's rules before using it.
          </RuleWarning>
        )}
      </VStack>

      <VStack align="stretch" spacing="2">
        <SectionTitle title="Turn smoothing">
          When you tap a strafe key, the stick rotates around its edge over this
          many milliseconds (per 90°) instead of snapping, staying at full
          distance the whole time. Some games keep more speed through smooth
          turns than sudden ones. 0 = instant. Adds this much delay to direction
          changes, so start low (10–30 ms).
        </SectionTitle>
        <ValueSlider
          value={config.turnSmoothingMs}
          min={0}
          max={80}
          step={5}
          format={(v) => (v === 0 ? "Off" : `${v} ms`)}
          onChange={(v) => update({ turnSmoothingMs: v })}
        />
        {config.turnSmoothingMs > 0 && (
          <RuleWarning>
            One key press produces a series of stick movements, which can
            count as a macro. Fortnite treats macros as cheating.
          </RuleWarning>
        )}
      </VStack>

      <VStack align="stretch" spacing="2">
        <SectionTitle title="Backward diagonal">
          Angle away from straight back when pressing {S}+{A} or {S}+{D}. 45°
          is the original behaviour.
        </SectionTitle>
        <AngleControl
          angle={config.downDiagonalAngle}
          setAngle={(v) => update({ downDiagonalAngle: v })}
          min={backDiagonalRange[0]}
          max={backDiagonalRange[1]}
        />
      </VStack>

      <VStack align="stretch" spacing="2">
        <ToggleRow
          title="Separate left side angles"
          checked={config.splitSides}
          onToggle={toggleSplit}
          tooltip={
            <>
              Give {W}+{A} and {A} alone their own angles. The Strafing tab then
              controls the right side ({W}+{D} and {D} alone).
            </>
          }
        />
        {config.splitSides && (
          <>
            <Text fontSize="sm">
              {W}+{A} angle
            </Text>
            <AngleControl
              angle={config.upLeftDiagonalAngle}
              setAngle={(v) => update({ upLeftDiagonalAngle: v })}
              min={strafeAngleRange[0]}
              max={strafeAngleRange[1]}
            />
            {config.useLeftRightAngle && (
              <>
                <Text fontSize="sm">{A} alone angle</Text>
                <AngleControl
                  angle={config.leftAngle}
                  setAngle={(v) => update({ leftAngle: v })}
                  min={strafeAngleRange[0]}
                  max={strafeAngleRange[1]}
                />
              </>
            )}
          </>
        )}
      </VStack>

      <VStack align="stretch" spacing="2">
        <ToggleRow
          title="Analog speed (walking)"
          checked={config.analogMagnitude}
          onToggle={() => update({ analogMagnitude: !config.analogMagnitude })}
          tooltip={
            <>
              Analog input only. Pressing a key partway moves you slower. Off
              keeps you at full speed whenever a key is past its actuation point.
            </>
          }
        />
      </VStack>

      <VStack align="stretch" spacing="2">
        <SectionTitle title="Analog response curve">
          Analog input only. Shapes how far you press a key (left to right)
          into how much it counts (bottom to top). With {W} held, this decides
          how much a partial {A}/{D} press turns you. Drag the points, or pick a
          preset. Points below the dashed line make light presses gentler;
          above it, sharper. A full press always counts 100%.
        </SectionTitle>
        <CurveEditor
          points={(config.analogCurvePoints ?? []) as CurvePoint[]}
          onChange={(points) => update({ analogCurvePoints: points })}
          fullAngle={Math.min(
            config.upDiagonalAngle * 90,
            config.keepSprint ?? true ? config.sprintMaxAngle ?? 70 : 90
          )}
        />
      </VStack>

      <ResponsivenessPanel />

      <Text fontSize="xs" color="gray.500">
        <Kbd>Tip</Kbd> These settings apply instantly while double movement is
        enabled.
      </Text>
    </VStack>
  );
}
