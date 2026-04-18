import { useState } from "react";
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { theme } from "../constants/theme";

const FilterSelect = ({
  value,
  onSelect,
  options = [],
  placeholder = "Select...",
}) => {
  const [isVisible, setIsVisible] = useState(false);

  const selectedOption = options.find((option) => option.value === value);
  const displayValue = selectedOption ? selectedOption.label : placeholder;

  const handleSelect = (option) => {
    onSelect(option.value, option);
    setIsVisible(false);
  };

  const handleOpen = () => {
    setIsVisible(true);
  };

  const handleClose = () => {
    setIsVisible(false);
  };

  // Chevron Down Icon Component
  const ChevronIcon = () => (
    <View style={styles.chevron}>
      <View style={styles.chevronLine1} />
      <View style={styles.chevronLine2} />
    </View>
  );

  const renderItem = ({ item, index }) => {
    const isLastItem = index === options.length - 1;
    
    return (
      <TouchableOpacity
        style={[
          styles.optionItem,
          item.value === value && styles.selectedOption,
          isLastItem && styles.lastOptionItem,
        ]}
        onPress={() => handleSelect(item)}
      >
        <Text
          style={[
            styles.optionText,
            item.value === value && styles.selectedOptionText,
          ]}
        >
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.selectButton} onPress={handleOpen}>
        <Text
          style={[styles.selectText, !selectedOption && styles.placeholderText]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {displayValue}
        </Text>
        <ChevronIcon />
      </TouchableOpacity>

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
              <Text style={styles.modalTitle}>Select Project</Text>
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
  container: {
    position: "relative",
  },
  selectButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.colors.gray[50],
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12, // Same as SearchBar
    borderWidth: 2,
    borderColor: "transparent",
  },
  selectText: {
    fontSize: 14,
    color: theme.colors.gray[800],
    flex: 1,
    marginRight: 8,
  },
  placeholderText: {
    color: theme.colors.gray[400],
  },
  // Chevron Icon
  chevron: {
    width: 12,
    height: 12,
    position: "relative",
  },
  chevronLine1: {
    position: "absolute",
    top: 4,
    left: 2,
    width: 6,
    height: 2,
    backgroundColor: theme.colors.gray[500],
    borderRadius: 1,
    transform: [{ rotate: "45deg" }],
  },
  chevronLine2: {
    position: "absolute",
    top: 4,
    right: 2,
    width: 6,
    height: 2,
    backgroundColor: theme.colors.gray[500],
    borderRadius: 1,
    transform: [{ rotate: "-45deg" }],
  },
  // Modal Styles
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

export default FilterSelect;
