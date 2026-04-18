import { MaterialIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { theme } from "../constants/theme";

const { width } = Dimensions.get("window");

const Dialog = ({
  visible,
  onClose,
  type = "info", // 'success', 'warning', 'error', 'confirmation', 'info'
  title,
  message,
  confirmText = "OK",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  showCancel = false,
}) => {
  const getTypeConfig = () => {
    switch (type) {
      case "success":
        return {
          icon: "check-circle",
          iconColor: theme.colors.status.success,
          headerColor: theme.colors.status.success,
        };
      case "warning":
        return {
          icon: "delete",
          iconColor: theme.colors.status.error,
          headerColor: theme.colors.status.error,
        };
      case "error":
        return {
          icon: "error",
          iconColor: theme.colors.status.error,
          headerColor: theme.colors.status.error,
        };
      case "confirmation":
        return {
          icon: "help",
          iconColor: theme.colors.primary.brand,
          headerColor: theme.colors.primary.brand,
        };
      default: // info
        return {
          icon: "info",
          iconColor: theme.colors.primary.brand,
          headerColor: theme.colors.primary.brand,
        };
    }
  };

  const typeConfig = getTypeConfig();

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    }
    onClose();
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
    onClose();
  };

  const handleBackdropPress = () => {
    // Only close on backdrop press if it's not a confirmation dialog
    if (type !== "confirmation") {
      onClose();
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={handleBackdropPress}
      >
        <View style={styles.dialogContainer}>
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={styles.dialog}>
              {/* Header with Icon */}
              <View style={styles.header}>
                <View
                  style={[
                    styles.iconContainer,
                    { backgroundColor: typeConfig.headerColor + "15" },
                  ]}
                >
                  <MaterialIcons
                    name={typeConfig.icon}
                    size={32}
                    color={typeConfig.iconColor}
                  />
                </View>
                {title && (
                  <Text
                    style={[
                      {
                        fontWeight: theme.typography.fontWeights.bold,
                        fontSize: theme.typography.fontSizes.lg,
                      },
                      styles.title,
                    ]}
                  >
                    {title}
                  </Text>
                )}
              </View>

              {/* Message */}
              {message && (
                <View style={styles.messageContainer}>
                  <Text
                    style={[
                      {
                        fontWeight: theme.typography.fontWeights.normal,
                        fontSize: theme.typography.fontSizes.base,
                      },
                      styles.message,
                    ]}
                  >
                    {message}
                  </Text>
                </View>
              )}

              {/* Actions */}
              <View style={styles.actions}>
                {showCancel && (
                  <TouchableOpacity
                    style={styles.btnCancel}
                    onPress={handleCancel}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        {
                          fontWeight: theme.typography.fontWeights.semibold,
                          fontSize: theme.typography.fontSizes.base,
                        },
                        styles.btnCancelText,
                      ]}
                    >
                      {cancelText}
                    </Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.btnConfirm,
                    showCancel && styles.btnConfirmWithCancel,
                  ]}
                  onPress={handleConfirm}
                  activeOpacity={0.8}
                >
                  <LinearGradient
                    colors={[
                      typeConfig.headerColor,
                      typeConfig.headerColor + "DD",
                    ]}
                    style={styles.btnConfirmGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <Text
                      style={[
                        {
                          fontWeight: theme.typography.fontWeights.semibold,
                          fontSize: theme.typography.fontSizes.base,
                        },
                        styles.btnConfirmText,
                      ]}
                    >
                      {confirmText}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  dialogContainer: {
    width: width * 0.85,
    maxWidth: 400,
  },
  dialog: {
    backgroundColor: theme.colors.white,
    borderRadius: 20,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 15,
  },
  header: {
    alignItems: "center",
    marginBottom: 20,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    color: theme.colors.gray[900],
    textAlign: "center",
  },
  messageContainer: {
    marginBottom: 24,
  },
  message: {
    color: theme.colors.gray[600],
    textAlign: "center",
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
  },
  btnCancel: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: theme.colors.gray[100],
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnCancelText: {
    color: theme.colors.gray[600],
  },
  btnConfirm: {
    flex: 1,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  btnConfirmWithCancel: {
    flex: 1,
  },
  btnConfirmGradient: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnConfirmText: {
    color: theme.colors.white,
  },
});

export default Dialog;
