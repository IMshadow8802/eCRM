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
  /** Which solid brand shade — no alpha anywhere. */
  tone: "light" | "deep";
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
          backgroundColor:
            shape.tone === "light" ? colors.veilOnBrand : colors.veilOnBrandDeep,
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
    { size: 190, top: height * 0.04, left: -70, delay: 0, tone: "light" },
    { size: 110, top: height * 0.17, right: -40, delay: 900, tone: "deep" },
    { size: 130, top: height * 0.44, left: width * 0.78, delay: 1800, tone: "light" },
    { size: 200, bottom: height * 0.06, right: -80, delay: 2600, tone: "deep" },
    { size: 70, bottom: height * 0.26, left: 24, delay: 1300, tone: "light" },
    { size: 120, top: height * 0.64, left: -55, delay: 3400, tone: "deep" },
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

  },
});
