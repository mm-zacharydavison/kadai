import { useRef, useState } from "react";

/**
 * Combines useState and useRef into a single hook.
 * The ref is updated synchronously on set, making it safe
 * to read inside useInput callbacks.
 */
export function useRefState<T>(
  initial: T,
): [T, React.MutableRefObject<T>, (value: T) => void] {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);

  const set = (value: T) => {
    ref.current = value;
    setState(value);
  };

  return [state, ref, set];
}
