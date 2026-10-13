import { Flex, Heading, SimpleGrid, Text, VStack } from "@chakra-ui/react";
import { ipcRenderer } from "electron";
import { LatencyStats } from "native/types";
import React, { useEffect, useState } from "react";
import { InfoTooltip } from "../general/InfoTooltip";

const ms = (us: number) => (us / 1000).toFixed(us < 1000 ? 2 : 1) + " ms";

function Stat(props: { label: string; value: string; hint?: string }) {
  return (
    <VStack align="flex-start" spacing="0">
      <Text fontSize="xs" textTransform="uppercase" letterSpacing="0.06em" color="gray.500">
        {props.label}
      </Text>
      <Text fontFamily="mono" fontSize="lg" style={{ fontVariantNumeric: "tabular-nums" }}>
        {props.value}
      </Text>
      {props.hint && (
        <Text fontSize="xs" color="gray.500">
          {props.hint}
        </Text>
      )}
    </VStack>
  );
}

/** Live measurements of how quickly key presses become stick updates. */
export function ResponsivenessPanel() {
  const [stats, setStats] = useState<LatencyStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () =>
      ipcRenderer
        .invoke("get_latency_stats")
        .then((s: LatencyStats | null) => !cancelled && setStats(s))
        .catch(() => !cancelled && setStats(null));
    poll();
    const id = setInterval(poll, 500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <VStack align="stretch" spacing="2">
      <Flex>
        <Heading size="sm">Responsiveness</Heading>
        <InfoTooltip ml="7px" mt="2px">
          <Text pt="1" fontSize="sm">
            How long this app takes to turn a key press into a stick update, measured live on
            your PC. "Typical delay" is the average wait until the next key check plus the time
            to send the update. Your keyboard's polling and the game's own frame rate add their
            own delay on top, outside this app.
          </Text>
        </InfoTooltip>
      </Flex>
      {!stats ? (
        <Text fontSize="sm" color="gray.500">
          Turn double movement on to measure.
        </Text>
      ) : (
        <>
          <SimpleGrid columns={2} spacingX="4" spacingY="3">
            <Stat label="Typical delay" value={ms(stats.typicalDelayUs)} />
            <Stat label="Near-worst delay" value={ms(stats.worstDelayUs)} hint="99% of presses are faster" />
            <Stat
              label="Key checks / sec"
              value={stats.checksPerSecond.toLocaleString()}
              hint={`every ${ms(stats.avgIntervalUs)} (aim ${ms(stats.targetIntervalUs)})`}
            />
            <Stat
              label="Send time"
              value={stats.updatesSent > 0 ? ms(stats.avgSendUs) : "—"}
              hint={stats.updatesSent > 0 ? `max ${ms(stats.maxSendUs)}` : "press a key to measure"}
            />
          </SimpleGrid>
          <Text fontSize="xs" color={stats.highPriority && stats.highResTimer ? "gray.500" : "orange.400"}>
            {stats.highResTimer ? "High-resolution timer on" : "High-resolution timer unavailable (needs Windows 10 1803+), using 1 ms fallback"}
            {" · "}
            {stats.highPriority ? "high-priority scheduling on" : "high-priority scheduling unavailable"}
          </Text>
        </>
      )}
    </VStack>
  );
}
