/**
 * Centralized animation context for the TUI.
 *
 * This provides a single source of animation timing to prevent multiple
 * concurrent setInterval timers from causing render thrashing and terminal
 * flashing when there are many animated components (spinners, timers, etc.).
 *
 * Instead of each component having its own timer, all components subscribe
 * to this shared context and update in sync on the same React render cycle.
 */
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useMemo,
} from "react";

type AnimationContextValue = {
  /** Frame index 0-9, cycles every 80ms (for spinners) */
  frame: number;
  /** Seconds elapsed since animation started (for timing displays) */
  tick: number;
  /** Whether animation is currently active */
  isAnimating: boolean;
};

const AnimationContext = createContext<AnimationContextValue>({
  frame: 0,
  tick: 0,
  isAnimating: false,
});

type AnimationProviderProps = {
  children: React.ReactNode;
  /** When true, animation timers are active. When false, they stop. */
  enabled: boolean;
};

/**
 * Provides centralized animation timing to all child components.
 *
 * When enabled, runs exactly two timers:
 * - Frame timer: 80ms interval for spinner animations
 * - Tick timer: 1000ms interval for elapsed time displays
 *
 * All animated components should use useSpinnerFrame() or useTick()
 * instead of their own setInterval calls.
 */
export function AnimationProvider({
  children,
  enabled,
}: AnimationProviderProps) {
  const [frame, setFrame] = useState(0);
  const [tick, setTick] = useState(0);
  const tickStartRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      // Reset tick start when disabled so next enable starts fresh
      tickStartRef.current = null;
      return;
    }

    // Record start time for tick calculation
    if (tickStartRef.current === null) {
      tickStartRef.current = Date.now();
    }

    // Single 80ms timer for spinner frame animation
    const frameTimer = setInterval(() => {
      setFrame((prev) => (prev + 1) % 10);
    }, 80);

    // Single 1000ms timer for elapsed seconds
    const tickTimer = setInterval(() => {
      if (tickStartRef.current !== null) {
        setTick(Math.floor((Date.now() - tickStartRef.current) / 1000));
      }
    }, 1000);

    return () => {
      clearInterval(frameTimer);
      clearInterval(tickTimer);
    };
  }, [enabled]);

  // Reset tick when re-enabled
  useEffect(() => {
    if (enabled) {
      setTick(0);
    }
  }, [enabled]);

  // Memoize context value to prevent unnecessary consumer re-renders
  const value = useMemo(
    () => ({ frame, tick, isAnimating: enabled }),
    [frame, tick, enabled],
  );

  return (
    <AnimationContext.Provider value={value}>
      {children}
    </AnimationContext.Provider>
  );
}

/**
 * Access the full animation context.
 */
export function useAnimation() {
  return useContext(AnimationContext);
}

/**
 * Get the current spinner frame index (0-9).
 * Updates every 80ms when animation is enabled.
 */
export function useSpinnerFrame() {
  const { frame } = useAnimation();
  return frame;
}

/**
 * Get the current tick (seconds since animation started).
 * Updates every 1000ms when animation is enabled.
 */
export function useTick() {
  const { tick } = useAnimation();
  return tick;
}

/**
 * Track elapsed time for a specific task/operation.
 * Returns seconds elapsed since isRunning became true.
 *
 * @param isRunning - Whether this specific operation is running
 * @returns Elapsed seconds (0 if not running or not yet started)
 */
export function useElapsedTime(isRunning: boolean): number {
  const { tick } = useAnimation();
  const startTickRef = useRef<number | null>(null);

  // Capture start tick when running begins
  useEffect(() => {
    if (isRunning && startTickRef.current === null) {
      startTickRef.current = tick;
    } else if (!isRunning) {
      // Don't reset - preserve final elapsed time
    }
  }, [isRunning, tick]);

  if (!isRunning && startTickRef.current === null) {
    return 0;
  }

  if (startTickRef.current === null) {
    return 0;
  }

  return tick - startTickRef.current;
}
