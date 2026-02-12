import { useRef, useState } from "react";
import type { Screen } from "../types.ts";

interface UseNavigationOptions {
  onExit: () => void;
  onNavigate?: () => void;
}

export function useNavigation({ onExit, onNavigate }: UseNavigationOptions) {
  const [stack, setStack] = useState<Screen[]>([{ type: "menu", path: [] }]);
  const stackRef = useRef(stack);
  stackRef.current = stack;

  const currentScreen = stack.at(-1) as Screen;

  const pushScreen = (screen: Screen) => {
    setStack((s) => {
      const next = [...s, screen];
      stackRef.current = next;
      return next;
    });
    onNavigate?.();
  };

  const popScreen = () => {
    if (stackRef.current.length <= 1) {
      onExit();
      return;
    }
    setStack((s) => {
      const next = s.slice(0, -1);
      stackRef.current = next;
      return next;
    });
    onNavigate?.();
  };

  return {
    stack,
    currentScreen,
    pushScreen,
    popScreen,
    setStack,
    stackRef,
  };
}
