import { useRef, useState } from "react";
import { Animated, StyleSheet, Text, TextInput, View } from "react-native";
import { theme } from "../constants/theme";

const FormField = ({
  label,
  value,
  onChangeText,
  icon,
  error,
  secureTextEntry = false,
  keyboardType = "default",
  multiline = false,
  numberOfLines = 1,
  editable = true,
  ...props
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const labelAnimation = useRef(new Animated.Value(value ? 1 : 0)).current;

  const handleFocus = () => {
    setIsFocused(true);
    Animated.timing(labelAnimation, {
      toValue: 1,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const handleBlur = () => {
    setIsFocused(false);
    if (!value) {
      Animated.timing(labelAnimation, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  };

  const labelStyle = {
    position: "absolute",
    left: 18,
    top: labelAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [14, -8], // Changed from [18, -8] to [14, -8] to center vertically
    }),
    fontSize: labelAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [16, 12],
    }),
    color: labelAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [
        theme.colors.gray[400],
        isFocused ? theme.colors.primary.brand : theme.colors.gray[700],
      ],
    }),
    backgroundColor: theme.colors.white,
    paddingHorizontal: 4,
    zIndex: 1,
  };

  return (
    <View style={styles.inputGroup}>
      <View style={styles.inputWrapper}>
        {label && (
          <Animated.Text
            style={[
              {
                fontWeight: theme.typography.fontWeights.semibold,
                fontSize: 12,
              },
              labelStyle,
            ]}
          >
            {label}
          </Animated.Text>
        )}
        <TextInput
          style={[
            styles.inputField,
            error && styles.inputFieldError,
            multiline && styles.inputFieldMultiline,
            !editable && styles.inputFieldDisabled,
            isFocused && styles.inputFieldFocused,
          ]}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          multiline={multiline}
          numberOfLines={numberOfLines}
          editable={editable}
          {...props}
        />
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  inputGroup: {
    marginBottom: 16,
    position: "relative",
    zIndex: 1,
  },
  inputWrapper: {
    position: "relative",
  },
  inputField: {
    width: "100%",
    padding: 12,
    paddingHorizontal: 18,
    backgroundColor: theme.colors.white,
    borderWidth: 2,
    borderColor: theme.colors.gray[300],
    borderRadius: 12,
    fontSize: 16,
    color: theme.colors.gray[600],
    minHeight: 48,
  },
  inputFieldMultiline: {
    height: 100,
    textAlignVertical: "top",
    minHeight: 100,
  },
  inputFieldFocused: {
    borderColor: theme.colors.primary.brand,
    borderWidth: 3,
  },
  inputFieldError: {
    borderColor: theme.colors.status.error,
    backgroundColor: "#FEF2F2",
  },
  inputFieldDisabled: {
    backgroundColor: theme.colors.gray[100],
    color: theme.colors.gray[500],
  },
  errorText: {
    fontSize: 12,
    color: theme.colors.status.error,
    marginTop: 4,
  },
});

export default FormField;
