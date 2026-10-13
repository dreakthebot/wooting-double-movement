import React from "react";
import { Card } from "./components/general/Card";
import {
  CloseButton,
  VStack,
  Heading,
  Box,
  Spacer,
  Flex,
} from "@chakra-ui/react";
import { Markdown } from "./components/markdown";

interface Props {
  version: string;
  onClose: () => void;
}

// Bundled with the app rather than fetched from GitHub, so opening the notes never
// contacts a server.
const CHANGELOG = `
## 1.6.0 — Double Movement Plus

Fork of Wooting Double Movement 1.5.0.

**Movement**
- New **Movement** tab: opposite-key modes, turn smoothing, backward diagonal angle, separate left/right angles, analog walking speed and steering curve.
- Controller type switch (PlayStation / Xbox 360).
- Optional "only while game is focused" mode.
- Riskier options (snap-tap modes, turn smoothing) are off by default and show a warning.

**Fixes**
- Input loop now runs at ~1000 Hz instead of being limited by the Windows timer (~64 Hz), so quick taps are no longer missed.
- Errors no longer leave the app stuck: the service reports failures, centres the stick and can be turned back on.
- Fixed crashes when keyboards are plugged in or removed.

**Privacy & safety**
- No auto-updates, announcements or other network calls.
- Links only open if they're https.
- Separate name and settings from the original app; your original settings are imported once.
`;

export function UpdateNotes(props: Props) {
  return (
    <Card h="fill-available" p="6" overflow="hidden">
      <VStack h="100%" overflow="hidden">
        <Flex w="100%">
          <Heading>Update Notes</Heading>
          <Spacer />
          <CloseButton onClick={props.onClose} h="100%" />
        </Flex>
        <Box overflowY="auto" h="100%" w="100%">
          <Markdown>{CHANGELOG}</Markdown>
        </Box>
      </VStack>
    </Card>
  );
}
