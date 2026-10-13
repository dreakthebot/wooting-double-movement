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
} from "@chakra-ui/react";
import { useRemoteValue } from "ipc";
import { JoystickAngleConfiguration, SocdMode } from "native/types";
import React, { useCallback, useState } from "react";
import { InfoTooltip } from "../general/InfoTooltip";
import { AngleControl } from "../settings/angle/AngleControl";
import { strafeAngleRange } from "./StrafeSettings";
import { keybindDisplay } from "./Utils";

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
        <SectionTitle title="Opposite keys">
          What happens when opposite keys are held together, e.g. holding {W}{" "}
          and tapping {S}, or rolling from {A} to {D}. "Last pressed wins" lets
          a tap override a held key and hands control back when you release it.
        </SectionTitle>
        <Select
          size="sm"
          value={config.socdMode}
          onChange={(e) => update({ socdMode: e.target.value as SocdMode })}
        >
          <option value="LastInputWins">Last pressed wins (snap-tap)</option>
          <option value="FirstInputWins">First pressed wins</option>
          <option value="Neutral">Cancel out (stop)</option>
          <option value="Legacy">Original (Forward / Right always win)</option>
        </Select>
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
        <SectionTitle title="Analog steering curve">
          Analog input only. With {W} held, how far you press {A}/{D} sets how
          sharp the diagonal is. Higher values make light presses steer more
          gently for finer control; 1.0 is linear.
        </SectionTitle>
        <ValueSlider
          value={config.analogCurve}
          min={0.5}
          max={3}
          step={0.1}
          format={(v) => v.toFixed(1)}
          onChange={(v) => update({ analogCurve: v })}
        />
      </VStack>

      <Text fontSize="xs" color="gray.500">
        <Kbd>Tip</Kbd> These settings apply instantly while double movement is
        enabled.
      </Text>
    </VStack>
  );
}
