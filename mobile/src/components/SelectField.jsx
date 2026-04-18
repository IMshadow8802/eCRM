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

const SelectField = ({
  label,
  value,
  onSelect,
  options = [],
  placeholder = "Select an option",
  icon,
  error,
  disabled = false,
  renderOption = null,
  valueKey = "value",
  labelKey = "label",
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const labelAnimation = useRef(new Animated.Value(value ? 1 : 0)).current;

  const selectedOption = options.find((option) => option[valueKey] === value);
  const displayValue = selectedOption ? selectedOption[labelKey] : "";

  const handleSelect = (option) => {
    onSelect(option[valueKey], option);
    setIsVisible(false);
    setIsFocused(false);

    // Animate label if value exists
    if (option[valueKey]) {
      Animated.timing(labelAnimation, {
        toValue: 1,
        duration: 200,
        useNativeDriver: false,
      }).start();
    }
  };

  const handleOpen = () => {
    if (disabled) return;
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

    if (!displayValue) {
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

  const renderItem = ({ item, index }) => {
    const isLastItem = index === options.length - 1;

    return (
      <TouchableOpacity
        style={[
          styles.optionItem,
          item[valueKey] === value && styles.selectedOption,
          isLastItem && styles.lastOptionItem,
        ]}
        onPress={() => handleSelect(item)}
      >
        {renderOption ? (
          renderOption(item)
        ) : (
          <Text
            style={[
              styles.optionText,
              item[valueKey] === value && styles.selectedOptionText,
            ]}
          >
            {item[labelKey]}
          </Text>
        )}
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
            error && styles.selectButtonError,
            disabled && styles.selectButtonDisabled,
            isFocused && styles.selectButtonFocused,
          ]}
          onPress={handleOpen}
          disabled={disabled}
        >
          <Text
            style={[styles.selectText, !displayValue && styles.placeholderText]}
          >
            {displayValue || ""}
          </Text>
          <View style={styles.dropdownIcon}>
            <View style={styles.dropdownArrow} />
          </View>
        </TouchableOpacity>
      </View>
      {error && <Text style={styles.errorText}>{error}</Text>}

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
              <Text style={styles.modalTitle}>{label || "Select Option"}</Text>
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
                item[valueKey]?.toString() || index.toString()
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
    borderWidth: 2,
    borderColor: theme.colors.gray[300],
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
  },
  selectButtonFocused: {
    borderColor: theme.colors.primary.brand,
    borderWidth: 3,
  },
  selectButtonError: {
    borderColor: theme.colors.status.error,
    backgroundColor: "#FEF2F2",
  },
  selectButtonDisabled: {
    backgroundColor: theme.colors.gray[100],
    opacity: 0.6,
  },
  selectText: {
    fontSize: 16,
    color: theme.colors.gray[600],
    flex: 1,
  },
  placeholderText: {
    color: theme.colors.gray[400],
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
    overflow: "hidden",
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
  lastOptionItem: {
    borderBottomWidth: 0,
  },
  selectedOption: {
    backgroundColor: theme.colors.primary.brand + "10",
  },
  optionText: {
    fontSize: 14,
    color: theme.colors.gray[800],
  },
  selectedOptionText: {
    color: theme.colors.primary.brand,
    fontWeight: theme.typography.fontWeights.semibold,
  },
});

export default SelectField;
