import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { theme } from "../constants/theme";
import { useAuthStore } from "../stores/authStore";
import { Logo } from "../components";

const { width, height } = Dimensions.get("window");

// Floating Circle Component
const FloatingCircle = ({
  size,
  top,
  left,
  right,
  bottom,
  delay = 0,
  color = "rgba(255,255,255,0.1)",
}) => {
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const startAnimation = () => {
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(floatAnim, {
            toValue: 1,
            duration: 6000,
            useNativeDriver: true,
          }),
          Animated.timing(floatAnim, {
            toValue: 0,
            duration: 6000,
            useNativeDriver: true,
          }),
        ])
      ).start();
    };

    startAnimation();
  }, []);

  const translateY = floatAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, -20, 0],
  });

  const rotate = floatAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ["0deg", "10deg", "0deg"],
  });

  return (
    <Animated.View
      style={[
        styles.floatingCircle,
        {
          width: size,
          height: size,
          backgroundColor: color,
          top,
          left,
          right,
          bottom,
          transform: [{ translateY }, { rotate }],
        },
      ]}
    />
  );
};


const WelcomeScreen = ({ navigation }) => {
  const { isAuthenticated, isTokenValid } = useAuthStore();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const logoAnim = useRef(new Animated.Value(0)).current;
  const backgroundRotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Background rotation
    Animated.loop(
      Animated.timing(backgroundRotate, {
        toValue: 1,
        duration: 20000,
        useNativeDriver: true,
      })
    ).start();

    // Entrance animations
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(logoAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const backgroundRotateStyle = backgroundRotate.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const handleGetStarted = () => {
    navigation.navigate("Login");
  };

  return (
    <LinearGradient
      colors={[theme.colors.primary.brand, theme.colors.primary.brandLight]}
      style={styles.container}
    >
      {/* Background Pattern */}
      <Animated.View
        style={[
          styles.backgroundPattern,
          { transform: [{ rotate: backgroundRotateStyle }] },
        ]}
      />

      {/* Floating Circles */}
      <FloatingCircle size={80} top="10%" left="10%" delay={0} />
      <FloatingCircle
        size={60}
        top="70%"
        right="10%"
        delay={2000}
        color="rgba(249, 98, 159, 0.2)"
      />
      <FloatingCircle size={100} bottom="20%" left="50%" delay={4000} />

      <Animated.View
        style={[
          styles.content,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Logo */}
        <Animated.View
          style={[
            styles.illustrationContainer,
            {
              opacity: logoAnim,
            },
          ]}
        >
          <Logo size={120} variant="icon" />
        </Animated.View>

        {/* Text Content */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>Manage your tasks the best way</Text>
          <Text style={styles.subtitle}>
            Revolutionary CRM that helps you stay organized and productive every
            day
          </Text>
        </View>

        {/* Get Started Button */}
        <TouchableOpacity
          style={styles.getStartedButton}
          onPress={handleGetStarted}
          activeOpacity={0.8}
        >
          <Text style={styles.getStartedText}>Let's Start!</Text>
        </TouchableOpacity>

        {/* Dots Indicator */}
        <View style={styles.dotsContainer}>
          <View style={[styles.dot, styles.activeDot]} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
      </Animated.View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backgroundPattern: {
    position: "absolute",
    top: -100,
    left: -100,
    width: width + 200,
    height: height + 200,
    borderRadius: (width + height) / 4,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.05)",
    backgroundColor: "transparent",
  },
  floatingCircle: {
    position: "absolute",
    borderRadius: 999,
    opacity: 0.6,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: theme.spacing[6],
  },
  illustrationContainer: {
    marginBottom: theme.spacing[12],
    alignItems: "center",
    justifyContent: "center",
    height: 200,
  },
  textContainer: {
    alignItems: "center",
    marginBottom: theme.spacing[10],
    paddingHorizontal: theme.spacing[4],
  },
  title: {
    fontSize: 32,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.white,
    marginBottom: theme.spacing[4],
    textAlign: "center",
    lineHeight: 40,
  },
  subtitle: {
    fontSize: theme.typography.fontSizes.base,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.white,
    textAlign: "center",
    opacity: 0.9,
    lineHeight: 24,
    paddingHorizontal: theme.spacing[2],
  },
  getStartedButton: {
    backgroundColor: theme.colors.white,
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[12],
    borderRadius: theme.borderRadius.full,
    marginBottom: theme.spacing[8],
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  getStartedText: {
    fontSize: theme.typography.fontSizes.lg,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.primary.brand,
    textAlign: "center",
  },
  dotsContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing[8],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.4)",
    marginHorizontal: 4,
  },
  activeDot: {
    backgroundColor: theme.colors.white,
    width: 24,
  },
});

export default WelcomeScreen;
