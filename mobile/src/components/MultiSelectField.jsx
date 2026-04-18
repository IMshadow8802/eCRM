import { useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { theme } from "../constants/theme";

const MultiSelectField = ({
  label,
  value = [],
  onSelect,
  options = [],
  icon,
  error,
  placeholder,
  maxHeight = 200,
  ...props
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const labelAnimation = useRef(
    new Animated.Value(value && value.length > 0 ? 1 : 0)
  ).current;

  const handleOpen = () => {
    setIsVisible(true);
    setIsFocused(true);

    Animated.timing(labelAnimation, {
      toValue: 1,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const handleClose = () => {
    setIsVisible(false);
    setIsFocused(false);

    if (!value || value.length === 0) {
      Animated.timing(labelAnimation, {
        toValue: 0,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  };

  const handleSelect = (optionValue) => {
    let newValue;
    if (value.includes(optionValue)) {
      // Remove if already selected
      newValue = value.filter((v) => v !== optionValue);
    } else {
      // Add if not selected
      newValue = [...value, optionValue];
    }
    onSelect(newValue);

    // Update label animation based on selection
    Animated.timing(labelAnimation, {
      toValue: newValue.length > 0 ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
    }).start();
  };

  const getSelectedLabels = () => {
    if (!value || value.length === 0) return "";

    const selectedOptions = options.filter((option) =>
      value.includes(option.value)
    );
    if (selectedOptions.length === 1) {
      return selectedOptions[0].label;
    } else if (selectedOptions.length <= 2) {
      return selectedOptions.map((option) => option.label).join(", ");
    } else {
      return `${selectedOptions.length} members selected`;
    }
  };

  const labelStyle = {
    position: "absolute",
    left: icon ? 50 : 18,
    top: labelAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: [18, -8],
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

  const renderItem = ({ item }) => {
    const isSelected = value.includes(item.value);
    return (
      <TouchableOpacity
        style={[styles.optionItem, isSelected && styles.selectedOption]}
        onPress={() => handleSelect(item.value)}
      >
        <View style={styles.optionContent}>
          <View
            style={[styles.checkbox, isSelected && styles.checkboxSelected]}
          >
            {isSelected && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text
            style={[styles.optionText, isSelected && styles.selectedOptionText]}
          >
            {item.label}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.inputGroup}>
      <View style={styles.inputWrapper}>
        {label && (
          <Animated.Text
            style={[
              {
                fontWeight: theme.typography.fontWeights.semibold,
                fontSize: theme.typography.fontSizes.sm,
              },
              labelStyle,
            ]}
          >
            {label}
          </Animated.Text>
        )}
        <TouchableOpacity
          style={[
            styles.selectButton,
            icon && styles.selectButtonWithIcon,
            error && styles.selectButtonError,
            isFocused && styles.selectButtonFocused,
          ]}
          onPress={handleOpen}
        >
          <Text
            style={[
              styles.selectText,
              (!value || value.length === 0) && styles.placeholderText,
            ]}
          >
            {getSelectedLabels() || ""}
          </Text>
          {icon && (
            <View style={styles.inputIcon}>
              {typeof icon === "string" ? (
                <Text style={styles.inputIconText}>{icon}</Text>
              ) : (
                icon
              )}
            </View>
          )}
          <View style={styles.dropdownIcon}>
            <View style={styles.dropdownArrow} />
          </View>
        </TouchableOpacity>
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}

      {/* Selected Items */}
      {value && value.length > 0 && (
        <View style={styles.selectedContainer}>
          <View style={styles.selectedItems}>
            {options
              .filter((option) => value.includes(option.value))
              .slice(0, 3)
              .map((option) => (
                <View key={option.value} style={styles.selectedItem}>
                  <Text style={styles.selectedItemText}>{option.label}</Text>
                  <TouchableOpacity
                    style={styles.removeButton}
                    onPress={() => handleSelect(option.value)}
                  >
                    <Text style={styles.removeButtonText}>×</Text>
                  </TouchableOpacity>
                </View>
              ))}
            {value.length > 3 && (
              <View style={styles.selectedItem}>
                <Text style={styles.selectedItemText}>
                  +{value.length - 3} more
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      <Modal
        visible={isVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleClose}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleClose}
        >
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{label || "Select Options"}</Text>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={handleClose}
              >
                <View style={styles.closeIcon}>
                  <View style={styles.closeIconLine} />
                  <View
                    style={[styles.closeIconLine, styles.closeIconLineRotated]}
                  />
                </View>
              </TouchableOpacity>
            </View>
            <FlatList
              data={options}
              renderItem={renderItem}
              keyExtractor={(item, index) =>
                item.value?.toString() || index.toString()
              }
              style={styles.optionsList}
              showsVerticalScrollIndicator={false}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  inputGroup: {
    marginBottom: 16,
    position: "relative",
    zIndex: 2,
  },
  inputWrapper: {
    position: "relative",
  },
  selectButton: {
    width: "100%",
    padding: 12,
    paddingHorizontal: 18,
    backgroundColor: theme.colors.white,
    borderWidth: 1,
    borderColor: theme.colors.gray[200],
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
  },
  selectButtonWithIcon: {
    paddingLeft: 50,
  },
  selectButtonFocused: {
    borderColor: theme.colors.primary.brand,
    borderWidth: 2,
  },
  selectButtonError: {
    borderColor: theme.colors.status.error,
    backgroundColor: "#FEF2F2",
  },
  selectText: {
    fontSize: 16,
    color: theme.colors.gray[600],
    flex: 1,
  },
  placeholderText: {
    color: theme.colors.gray[400],
  },
  inputIcon: {
    position: "absolute",
    left: 18,
    top: 18,
    width: 16,
    height: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  inputIconText: {
    fontSize: 16,
    color: theme.colors.gray[500],
  },
  dropdownIcon: {
    width: 12,
    height: 12,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 8,
  },
  dropdownArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 4,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor: theme.colors.gray[500],
  },
  errorText: {
    fontSize: 12,
    color: theme.colors.status.error,
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: theme.colors.white,
    borderRadius: 16,
    width: "90%",
    maxHeight: "70%",
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[200],
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.gray[100],
    justifyContent: "center",
    alignItems: "center",
  },
  closeIcon: {
    width: 16,
    height: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  closeIconLine: {
    position: "absolute",
    width: 12,
    height: 2,
    backgroundColor: theme.colors.gray[600],
    borderRadius: 1,
    transform: [{ rotate: "45deg" }],
  },
  closeIconLineRotated: {
    transform: [{ rotate: "-45deg" }],
  },
  optionsList: {
    maxHeight: 300,
  },
  optionItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[100],
  },
  optionContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  selectedOption: {
    backgroundColor: theme.colors.primary.brand + "10",
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: theme.colors.gray[300],
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxSelected: {
    backgroundColor: theme.colors.primary.brand,
    borderColor: theme.colors.primary.brand,
  },
  checkmark: {
    fontSize: 12,
    color: theme.colors.white,
    fontWeight: "bold",
  },
  optionText: {
    fontSize: 14,
    color: theme.colors.gray[800],
  },
  selectedOptionText: {
    color: theme.colors.primary.brand,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  selectedContainer: {
    marginTop: 8,
  },
  selectedItems: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  selectedItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.primary.brand + "15",
    borderRadius: 8,
    paddingVertical: 4,
    paddingLeft: 8,
    paddingRight: 4,
  },
  selectedItemText: {
    fontWeight: theme.typography.fontWeights.normal,
    fontSize: theme.typography.fontSizes.sm,
    color: theme.colors.primary.brand,
    marginRight: 4,
  },
  removeButton: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.primary.brand + "30",
    justifyContent: "center",
    alignItems: "center",
  },
  removeButtonText: {
    fontSize: 12,
    color: theme.colors.primary.brand,
    fontWeight: "bold",
  },
});

export default MultiSelectField;
