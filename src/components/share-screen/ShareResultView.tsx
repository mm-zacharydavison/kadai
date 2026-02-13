import { Box, Text } from "ink";
import type { ShareResult } from "../../core/share.ts";

export function ShareResultView({ result }: { result: ShareResult }) {
  return (
    <Box flexDirection="column">
      {result.status === "success" ? (
        <Box flexDirection="column">
          <Text color="green">✓ Actions shared successfully</Text>
          {result.prUrl && (
            <Box marginTop={1}>
              <Text>PR: {result.prUrl}</Text>
            </Box>
          )}
          {result.branchName && !result.prUrl && (
            <Box marginTop={1}>
              <Text>Branch: {result.branchName}</Text>
            </Box>
          )}
        </Box>
      ) : (
        <Text color="red">✗ {result.error ?? "Share failed"}</Text>
      )}
      <Box marginTop={1}>
        <Text dimColor>Press enter or esc to continue</Text>
      </Box>
    </Box>
  );
}
