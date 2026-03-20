import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { ActionInput, InputValues } from "../types.ts";

interface InputFormProps {
  inputs: ActionInput[];
  onComplete: (values: InputValues) => void;
  onCancel: () => void;
}

export function InputForm({ inputs, onComplete, onCancel }: InputFormProps) {
  const [step, setStep] = useState(0);
  const [collectedValues, setCollectedValues] = useState<InputValues>({});
  const [currentText, setCurrentText] = useState("");

  const currentInput = inputs[step];

  useInput((input, key) => {
    if (!currentInput) return;

    if (key.escape) {
      onCancel();
      return;
    }

    if (currentInput.type === "boolean") {
      if (input === "y" || input === "Y") {
        advance(true);
      } else if (input === "n" || input === "N") {
        advance(false);
      }
      return;
    }

    // string / number
    if (key.return) {
      const val =
        currentInput.type === "number" ? Number(currentText) : currentText;
      advance(val);
      return;
    }
    if (key.backspace || key.delete) {
      setCurrentText((t) => t.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      setCurrentText((t) => t + input);
    }
  });

  function advance(value: string | boolean | number) {
    const newValues = { ...collectedValues, [currentInput!.name]: value };
    const nextStep = step + 1;
    if (nextStep >= inputs.length) {
      onComplete(newValues);
    } else {
      setCollectedValues(newValues);
      setStep(nextStep);
      setCurrentText("");
    }
  }

  if (!currentInput) return null;

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{currentInput.prompt} </Text>
        {currentInput.type === "boolean" ? (
          <Text dimColor>[y/n] </Text>
        ) : (
          <Text>{currentInput.sensitive ? "•".repeat(currentText.length) : currentText}</Text>
        )}
        {currentInput.type !== "boolean" && <Text dimColor>█</Text>}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {step + 1}/{inputs.length} · esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
