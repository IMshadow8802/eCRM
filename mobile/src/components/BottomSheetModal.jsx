import { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { theme } from "../constants/theme";

const { height: screenHeight } = Dimensions.get("window");

const BottomSheetModal = ({
  visible,
  onClose,
  title,
  children,
  maxHeight = screenHeight * 0.9,
  rightElement = null,
}) => {
  const slideAnim = useRef(new Animated.Value(screenHeight)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: screenHeight,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  const handleOverlayPress = () => {
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent={true}
      hardwareAccelerated={true}
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={handleOverlayPress}
        />

        <Animated.View
          style={[
            styles.bottomSheet,
            {
              maxHeight,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.keyboardAvoid}
          >
            {/* Header */}
            <View style={styles.header}>
              <View style={styles.dragHandle} />
              <View style={styles.headerContent}>
                <Text style={styles.title}>{title}</Text>
                <View style={styles.headerActions}>
                  {rightElement}
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
                </View>
              </View>
            </View>

            {/* Content */}
            <ScrollView
              style={styles.content}
              contentContainerStyle={styles.contentContainer}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </KeyboardAvoidingView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  overlayTouchable: {
    flex: 1,
  },
  bottomSheet: {
    backgroundColor: theme.colors.white,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    overflow: "hidden",
    minHeight: screenHeight * 0.85,
    zIndex: 1001,
  },
  keyboardAvoid: {
    flex: 1,
    maxHeight: screenHeight * 0.9,
  },
  header: {
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.gray[100],
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: theme.colors.gray[300],
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[800],
    flex: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  closeButton: {
    width: 32,
    height: 32,
    backgroundColor: theme.colors.gray[100],
    borderRadius: 10,
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
  content: {
    flex: 1,
    minHeight: 300,
  },
  contentContainer: {
    padding: 20,
    paddingBottom: 40,
    flexGrow: 1,
  },
});

export default BottomSheetModal;
