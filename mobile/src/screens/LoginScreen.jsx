import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Icon from "react-native-vector-icons/MaterialIcons";
import FormField from "../components/FormField";
import { theme } from "../constants/theme";
import { useLogin } from "../hooks/useAuth";
import { useAuthStore } from "../stores/authStore";

const { width, height } = Dimensions.get("window");

// Floating Circle Component for background animation
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

const LoginScreen = ({ navigation }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState({});
  const [isKeyboardVisible, setKeyboardVisible] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Card animation
  const cardScale = useRef(new Animated.Value(0)).current;

  const { login } = useAuthStore();
  const loginMutation = useLogin();

  useEffect(() => {
    // Card entrance animation
    Animated.spring(cardScale, {
      toValue: 1,
      tension: 100,
      friction: 8,
      useNativeDriver: true,
    }).start();

    // Keyboard listeners
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => {
        setKeyboardVisible(true);
      }
    );

    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setKeyboardVisible(false);
      }
    );

    return () => {
      keyboardWillShow?.remove();
      keyboardWillHide?.remove();
    };
  }, []);

  const validateForm = () => {
    const newErrors = {};

    if (!username.trim()) {
      newErrors.username = "Username is required";
    }

    if (!password.trim()) {
      newErrors.password = "Password is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async () => {
    if (!validateForm()) return;

    try {
      const data = await loginMutation.mutateAsync({
        username: username.trim(),
        password: password.trim(),
      });

      // Store login data in auth store
      login({
        token: data.token,
        user: data.user,
        company: data.company,
        permissions: data.permissions,
      });

      navigation.replace("MainApp");
    } catch (error) {
      console.error("Login error:", error);
      Alert.alert(
        "Login Error",
        error.message || "Network error. Please try again."
      );
    }
  };

  const handleGoToWelcome = () => {
    navigation.navigate("Welcome");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <LinearGradient
        colors={[theme.colors.primary.brand, theme.colors.primary.brandLight]}
        style={styles.gradient}
      >
        {/* Background Floating Animations */}
        <View style={styles.backgroundAnimations}>
          <FloatingCircle
            size={100}
            top={50}
            left={-30}
            delay={0}
            color="rgba(255,255,255,0.08)"
          />
          <FloatingCircle
            size={60}
            top={150}
            right={-20}
            delay={1000}
            color="rgba(255,255,255,0.06)"
          />
          <FloatingCircle
            size={80}
            top={300}
            left={width * 0.7}
            delay={2000}
            color="rgba(255,255,255,0.05)"
          />
          <FloatingCircle
            size={120}
            bottom={100}
            right={-40}
            delay={3000}
            color="rgba(255,255,255,0.07)"
          />
          <FloatingCircle
            size={40}
            bottom={200}
            left={30}
            delay={1500}
            color="rgba(255,255,255,0.04)"
          />
          <FloatingCircle
            size={90}
            top={height * 0.6}
            left={-25}
            delay={4000}
            color="rgba(255,255,255,0.06)"
          />
        </View>

        <View style={styles.content}>
          {/* Login Card */}
          <Animated.View
            style={[styles.loginCard, { transform: [{ scale: cardScale }] }]}
          >
            {/* Login Header */}
            <View style={styles.loginHeader}>
              <Text style={styles.loginTitle}>Welcome Back!</Text>
              <Text style={styles.loginSubtitle}>Sign in to continue</Text>
            </View>

            {/* Username Input */}
            <FormField
              label="Username"
              value={username}
              onChangeText={(text) => {
                setUsername(text);
                if (errors.username) {
                  setErrors((prev) => ({ ...prev, username: null }));
                }
              }}
              error={errors.username}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loginMutation.isPending}
            />

            {/* Password Input */}
            <View style={styles.passwordContainer}>
              <FormField
                label="Password"
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  if (errors.password) {
                    setErrors((prev) => ({ ...prev, password: null }));
                  }
                }}
                error={errors.password}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loginMutation.isPending}
              />
              <TouchableOpacity
                style={styles.passwordToggle}
                onPress={() => setShowPassword(!showPassword)}
                activeOpacity={0.7}
              >
                <Icon
                  name={showPassword ? "visibility-off" : "visibility"}
                  size={20}
                  color={theme.colors.gray[500]}
                />
              </TouchableOpacity>
            </View>

            {/* Login Button */}
            <TouchableOpacity
              style={[
                styles.btnLogin,
                loginMutation.isPending && styles.btnLoginDisabled,
              ]}
              onPress={handleLogin}
              disabled={loginMutation.isPending}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={[
                  theme.colors.primary.brandLight,
                  theme.colors.primary.brand,
                ]}
                style={styles.btnLoginGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                {loginMutation.isPending ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator
                      size="small"
                      color={theme.colors.white}
                    />
                    <Text style={styles.loadingText}>Signing In...</Text>
                  </View>
                ) : (
                  <Text style={styles.btnLoginText}>Sign In</Text>
                )}
              </LinearGradient>
            </TouchableOpacity>

            {/* Login Footer */}
            <View style={styles.loginFooter}>
              <TouchableOpacity onPress={handleGoToWelcome} activeOpacity={0.7}>
                <Text style={styles.forgotPassword}>← Back to Welcome</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.primary.brand,
  },
  gradient: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  backgroundAnimations: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
  },
  floatingCircle: {
    position: "absolute",
    borderRadius: 100,
    opacity: 0.6,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 25,
    paddingVertical: 40,
    zIndex: 1,
  },
  loginCard: {
    backgroundColor: theme.colors.white,
    borderRadius: 25,
    padding: 30,
    paddingHorizontal: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 15,
    },
    shadowOpacity: 0.15,
    shadowRadius: 40,
    elevation: 15,
    position: "relative",
  },
  loginHeader: {
    alignItems: "center",
    marginBottom: 25,
    zIndex: 2,
  },
  loginTitle: {
    fontSize: 24,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
    marginBottom: 5,
    textAlign: "center",
  },
  loginSubtitle: {
    fontSize: 14,
    color: theme.colors.gray[600],
    textAlign: "center",
    opacity: 0.8,
  },
  btnLogin: {
    borderRadius: 12,
    marginTop: 10,
    shadowColor: theme.colors.primary.brand,
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  btnLoginGradient: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  btnLoginDisabled: {
    opacity: 0.6,
  },
  btnLoginText: {
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.white,
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  loadingText: {
    marginLeft: theme.spacing[2],
    fontSize: 16,
    fontWeight: theme.typography.fontWeights.normal,
    color: theme.colors.white,
  },
  loginFooter: {
    alignItems: "center",
    marginTop: 20,
    zIndex: 2,
  },
  forgotPassword: {
    fontSize: 12,
    color: theme.colors.primary.brand,
    fontWeight: theme.typography.fontWeights.semibold,
    textDecorationLine: "none",
  },
  passwordContainer: {
    position: "relative",
  },
  passwordToggle: {
    position: "absolute",
    right: 18,
    top: 18,
    padding: 4,
    zIndex: 2,
  },
});

export default LoginScreen;