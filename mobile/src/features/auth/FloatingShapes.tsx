import { useEffect } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { colors, radius } from "../../theme";

interface Shape {
  size: number;
  top?: number;
  left?: number;
  right?: number;
  bottom?: number;
  delay: number;
  opacity: number;
}

/**
 * Slow-drifting translucent circles behind the auth gradient. Purely
 * decorative — it is what stops the login screen reading as a blank form.
 *
 * Runs on Reanimated (UI thread) rather than RN's Animated: these loop forever
 * while the user types, and on the JS thread they stutter against keyboard
 * animation and input re-renders.
 */
function FloatingShape({ shape }: { shape: Shape }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      shape.delay,
      withRepeat(
        withTiming(1, { duration: 7000, easing: Easing.inOut(Easing.quad) }),
        -1,
        true, // reverse, so it drifts back rather than snapping
      ),
    );
  }, [progress, shape.delay]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: -24 * progress.value },
      { rotate: `${12 * progress.value}deg` },
      { scale: 1 + 0.06 * progress.value },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.shape,
        {
          width: shape.size,
          height: shape.size,
          top: shape.top,
          left: shape.left,
          right: shape.right,
          bottom: shape.bottom,
          opacity: shape.opacity,
        },
        style,
      ]}
    />
  );
}

export default function FloatingShapes() {
  const { width, height } = useWindowDimensions();

  // Positioned off-screen at the edges so they read as ambient depth rather
  // than as circles someone placed on the screen.
  const shapes: Shape[] = [
    { size: 150, top: height * 0.05, left: -50, delay: 0, opacity: 0.1 },
    { size: 90, top: height * 0.18, right: -28, delay: 900, opacity: 0.08 },
    { size: 120, top: height * 0.42, left: width * 0.72, delay: 1800, opacity: 0.07 },
    { size: 170, bottom: height * 0.08, right: -60, delay: 2600, opacity: 0.09 },
    { size: 60, bottom: height * 0.24, left: 28, delay: 1300, opacity: 0.07 },
    { size: 110, top: height * 0.62, left: -40, delay: 3400, opacity: 0.06 },
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {shapes.map((shape, i) => (
        <FloatingShape key={i} shape={shape} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  shape: {
    position: "absolute",
    borderRadius: radius.full,
    // Opaque white; each shape sets its own `opacity` so the veil varies.
    backgroundColor: colors.veilOnBrand,
  },
});
