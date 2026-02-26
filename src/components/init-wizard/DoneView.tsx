import { Box, Text } from "ink";
import type { WriteInitFilesResult } from "../../core/init-wizard.ts";

export function DoneView({ result }: { result: WriteInitFilesResult }) {
  return (
    <Box flexDirection="column">
      <Text>Created .kadai/config.ts</Text>
      {result.sampleCreated && <Text>Created .kadai/actions/hello.sh</Text>}
      {result.skillCreated && <Text>Created .claude/skills/kadai/SKILL.md</Text>}
      <Text>{"\n"}Done! Run kadai again to get started.</Text>
    </Box>
  );
}
