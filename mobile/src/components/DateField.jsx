import DateTimePicker from "@react-native-community/datetimepicker";
import { useEffect, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { CalendarIcon } from "./Icons";
import { theme } from "../constants/theme";

const DateField = ({
  label,
  value,
  onChange,
  placeholder = "Select date",
  iconSize = 16,
  error,
  disabled = false,
  mode = "date",
  minimumDate,
  maximumDate,
  format = "DD/MM/YYYY",
  defaultToToday = true,
}) => {
  const [showPicker, setShowPicker] = useState(false);

  // Set current date as default when no value is provided
  useEffect(() => {
    if (!value && onChange && defaultToToday) {
      // Add a small delay to prevent race conditions with multiple DateFields
      const timeout = setTimeout(() => {
        onChange(new Date());
      }, Math.random() * 50); // Random delay between 0-50ms
      
      return () => clearTimeout(timeout);
    }
  }, []);

  const formatDate = (date) => {
    if (!date) return "";

    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, "0");
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    const year = d.getFullYear();

    switch (format) {
      case "MM/DD/YYYY":
        return `${month}/${day}/${year}`;
      case "YYYY-MM-DD":
        return `${year}-${month}-${day}`;
      case "DD MMM YYYY":
        const months = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ];
        return `${day} ${months[d.getMonth()]} ${year}`;
      default: // DD/MM/YYYY
        return `${day}/${month}/${year}`;
    }
  };

  const formatTime = (date) => {
    if (!date) return "";

    const d = new Date(date);
    const hours = d.getHours().toString().padStart(2, "0");
    const minutes = d.getMinutes().toString().padStart(2, "0");
    return `${hours}:${minutes}`;
  };

  const getDisplayValue = () => {
    if (!value) return "";

    if (mode === "time") {
      return formatTime(value);
    } else if (mode === "datetime") {
      return `${formatDate(value)} ${formatTime(value)}`;
    } else {
      return formatDate(value);
    }
  };

  const handleDateChange = (event, selectedDate) => {
    if (Platform.OS === "android") {
      setShowPicker(false);
    }

    if (selectedDate && onChange) {
      onChange(selectedDate);
    }
  };

  const handlePress = () => {
    if (!disabled) {
      setShowPicker(true);
    }
  };

  return (
    <View style={styles.inputGroup}>
      {label && <Text style={styles.inputLabel}>{label}</Text>}
      <TouchableOpacity
        style={[
          styles.dateButton,
          error && styles.dateButtonError,
          disabled && styles.dateButtonDisabled,
        ]}
        onPress={handlePress}
        disabled={disabled}
      >
        <Text style={[styles.dateText, !value && styles.placeholderText]}>
          {getDisplayValue() || placeholder}
        </Text>
        <View style={styles.iconContainer}>
          <CalendarIcon size={iconSize} color={theme.colors.gray[500]} />
        </View>
      </TouchableOpacity>
      {error && <Text style={styles.errorText}>{error}</Text>}

      {showPicker && (
        <DateTimePicker
          value={value || new Date()}
          mode={mode}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={handleDateChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onTouchCancel={() => Platform.OS === "ios" && setShowPicker(false)}
        />
      )}

      {Platform.OS === "ios" && showPicker && (
        <View style={styles.iosPickerContainer}>
          <View style={styles.iosPickerHeader}>
            <TouchableOpacity onPress={() => setShowPicker(false)}>
              <Text style={styles.iosPickerButton}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowPicker(false)}>
              <Text style={[styles.iosPickerButton, styles.iosPickerDone]}>
                Done
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  inputGroup: {
    marginBottom: 16,
    position: "relative",
    zIndex: 2,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: theme.typography.fontWeights.semibold,
    color: theme.colors.gray[700],
    marginBottom: 6,
  },
  dateButton: {
    width: "100%",
    padding: 12,
    paddingHorizontal: 18,
    paddingRight: 44,
    backgroundColor: theme.colors.white,
    borderWidth: 2,
    borderColor: theme.colors.gray[300],
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    position: "relative",
  },
  dateButtonError: {
    borderColor: theme.colors.status.error,
    backgroundColor: "#FEF2F2",
  },
  dateButtonDisabled: {
    backgroundColor: theme.colors.gray[100],
    opacity: 0.6,
  },
  dateText: {
    fontSize: 14,
    color: theme.colors.gray[600],
    flex: 1,
  },
  placeholderText: {
    color: theme.colors.gray[400],
  },
  iconContainer: {
    position: "absolute",
    right: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  errorText: {
    fontSize: 12,
    color: theme.colors.status.error,
    marginTop: 4,
  },
  iosPickerContainer: {
    backgroundColor: theme.colors.white,
    borderTopWidth: 1,
    borderTopColor: theme.colors.gray[200],
  },
  iosPickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 16,
  },
  iosPickerButton: {
    fontSize: 16,
    color: theme.colors.primary.brand,
  },
  iosPickerDone: {
    fontWeight: theme.typography.fontWeights.semibold,
  },
});

export default DateField;
