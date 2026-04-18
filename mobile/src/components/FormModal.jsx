import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../constants/theme";

const FormModal = ({
  visible,
  onClose,
  title,
  children,
  onSave,
  saveText = "Save",
  loading = false,
  showSaveButton = true,
  showCloseButton = true,
}) => {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={["top"]}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          {/* Form Header */}
          <View style={styles.formHeader}>
            <View style={styles.formHeaderLeft}>
              {showCloseButton && (
                <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                  <View style={styles.closeIcon}>
                    <View style={styles.closeIconLine} />
                    <View
                      style={[
                        styles.closeIconLine,
                        styles.closeIconLineRotated,
                      ]}
                    />
                  </View>
                </TouchableOpacity>
              )}
              <Text style={styles.formTitle}>{title}</Text>
            </View>
            {showSaveButton && (
              <TouchableOpacity
                style={[
                  styles.saveButton,
                  loading && styles.saveButtonDisabled,
                ]}
                onPress={onSave}
                disabled={loading}
              >
                <Text style={styles.saveButtonText}>
                  {loading ? "Saving..." : saveText}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Form Content */}
          <ScrollView
            style={styles.formContent}
            contentContainerStyle={styles.formContentContainer}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.gray[50],
  },
  keyboardAvoid: {
    flex: 1,
  },
  formHeader: {
    backgroundColor: theme.colors.white,
    padding: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[200],
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  formHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.gray[100],
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
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
  formTitle: {
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
    flex: 1,
  },
  saveButton: {
    backgroundColor: theme.colors.primary.brand,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    shadowColor: theme.colors.primary.brand,
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: theme.colors.white,
    fontSize: 14,
    fontWeight: theme.typography.fontWeights.semibold,
  },
  formContent: {
    flex: 1,
  },
  formContentContainer: {
    padding: 20,
    paddingBottom: 40,
  },
});

export default FormModal;
