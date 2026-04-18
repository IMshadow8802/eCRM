import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { theme } from "../constants/theme";

const CheckboxField = ({
  label,
  value,
  onValueChange,
  error,
  disabled = false,
}) => {
  return (
    <View style={styles.checkboxGroup}>
      <TouchableOpacity
        style={[styles.checkboxWrapper, disabled && styles.checkboxDisabled]}
        onPress={() => !disabled && onValueChange(!value)}
        disabled={disabled}
      >
        <View
          style={[
            styles.checkbox,
            value && styles.checkboxChecked,
            error && styles.checkboxError,
          ]}
        >
          {value && (
            <View style={styles.checkmarkContainer}>
              <View style={styles.checkmarkLine1} />
              <View style={styles.checkmarkLine2} />
            </View>
          )}
        </View>
        <Text
          style={[
            {
              fontWeight: theme.typography.fontWeights.semibold,
              fontSize: theme.typography.fontSizes.base,
            },
            styles.checkboxLabel,
            disabled && styles.checkboxLabelDisabled,
          ]}
        >
          {label}
        </Text>
      </TouchableOpacity>
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  checkboxGroup: {
    marginBottom: 16,
  },
  checkboxWrapper: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: theme.colors.gray[300],
    backgroundColor: theme.colors.white,
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.primary.brand,
    borderColor: theme.colors.primary.brand,
  },
  checkboxError: {
    borderColor: theme.colors.status.error,
  },
  checkmarkContainer: {
    position: "relative",
    width: 12,
    height: 12,
  },
  checkmarkLine1: {
    position: "absolute",
    width: 6,
    height: 2,
    backgroundColor: theme.colors.white,
    borderRadius: 1,
    transform: [{ rotate: "45deg" }],
    left: 2,
    top: 6,
  },
  checkmarkLine2: {
    position: "absolute",
    width: 10,
    height: 2,
    backgroundColor: theme.colors.white,
    borderRadius: 1,
    transform: [{ rotate: "-45deg" }],
    left: 3,
    top: 4,
  },
  checkboxLabel: {
    color: theme.colors.gray[700],
    flex: 1,
  },
  checkboxDisabled: {
    opacity: 0.6,
  },
  checkboxLabelDisabled: {
    color: theme.colors.gray[400],
  },
  errorText: {
    fontSize: theme.typography.fontSizes.xs,
    color: theme.colors.status.error,
    marginTop: theme.spacing[1],
    marginLeft: 32,
  },
});

export default CheckboxField;
