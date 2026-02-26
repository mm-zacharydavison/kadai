import { Spinner } from "@inkjs/ui";
import { Box, Text } from "ink";
import { useState } from "react";
import {
  type InitResult,
  type WriteInitFilesResult,
  writeInitFiles,
} from "../../core/init-wizard.ts";
import { DoneView } from "./DoneView.tsx";

type Phase = "writing" | "done";

interface InitWizardProps {
  cwd: string;
  onDone: (result: InitResult) => void;
}

export function InitWizard({ cwd, onDone }: InitWizardProps) {
  const [phase, setPhase] = useState<Phase>("writing");
  const [writeResult, setWriteResult] = useState<WriteInitFilesResult | null>(
    null,
  );

  // Start writing immediately
  if (phase === "writing" && !writeResult) {
    writeInitFiles(cwd).then((result) => {
      setWriteResult(result);
      setPhase("done");
      onDone({ kadaiDir: `${cwd}/.kadai` });
    });
  }

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Box marginBottom={1}>
        <Text>No .kadai directory found. Let's set one up.</Text>
      </Box>

      {phase === "writing" && <Spinner label="Writing files..." />}
      {phase === "done" && writeResult && <DoneView result={writeResult} />}
    </Box>
  );
}
