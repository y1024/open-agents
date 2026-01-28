/**
 * Component for rendering collapsed groups of consecutive tool calls.
 * Used to reduce visual clutter for completed read/glob/grep operations.
 */
import React from "react";
import { Box, Text } from "ink";
import type { CollapsedGroup } from "../lib/message-collapsing";

export type CollapsedToolGroupProps = {
  group: CollapsedGroup;
};

/** Map tool type to display name */
function getToolDisplayName(toolType: CollapsedGroup["toolType"]): string {
  switch (toolType) {
    case "tool-read":
      return "Read";
    case "tool-glob":
      return "Glob";
    case "tool-grep":
      return "Grep";
  }
}

/**
 * Render a collapsed group of tool calls.
 * Shows a compact summary like "● Read 5 files" or "● 3 glob searches"
 */
export function CollapsedToolGroup({ group }: CollapsedToolGroupProps) {
  const toolName = getToolDisplayName(group.toolType);

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box>
        <Text color="green">● </Text>
        <Text bold color="white">
          {toolName}
        </Text>
        <Text color="gray"> (</Text>
        <Text color="white">{group.summary}</Text>
        <Text color="gray">)</Text>
      </Box>
    </Box>
  );
}
