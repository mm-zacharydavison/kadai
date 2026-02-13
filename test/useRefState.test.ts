import { describe, expect, test } from "bun:test";
import { Text } from "ink";
import { render } from "ink-testing-library";
import React from "react";
import { useRefState } from "../src/hooks/useRefState.ts";

describe("useRefState", () => {
  test("returns initial value for state and ref", () => {
    let refValue: number | undefined;

    function Comp() {
      const [state, ref] = useRefState(0);
      refValue = ref.current;
      return React.createElement(Text, null, String(state));
    }

    const { lastFrame } = render(React.createElement(Comp));
    expect(lastFrame()).toBe("0");
    expect(refValue).toBe(0);
  });

  test("setter updates ref synchronously", () => {
    let ref: React.MutableRefObject<number> | undefined;
    let setter: ((v: number) => void) | undefined;

    function Comp() {
      const [state, r, set] = useRefState(0);
      ref = r;
      setter = set;
      return React.createElement(Text, null, String(state));
    }

    render(React.createElement(Comp));
    expect(ref).toBeDefined();
    setter?.(42);
    expect(ref?.current).toBe(42);
  });

  test("works with string type", () => {
    let ref: React.MutableRefObject<string> | undefined;
    let setter: ((v: string) => void) | undefined;

    function Comp() {
      const [state, r, set] = useRefState("hello");
      ref = r;
      setter = set;
      return React.createElement(Text, null, state);
    }

    render(React.createElement(Comp));
    expect(ref?.current).toBe("hello");
    setter?.("world");
    expect(ref?.current).toBe("world");
  });
});
