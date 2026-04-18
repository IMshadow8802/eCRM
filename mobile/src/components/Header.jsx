import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { theme } from "../constants/theme";
import SearchBar from "./SearchBar";

const Header = ({
  title,
  navigation,
  showSearch = true,
  searchValue = "",
  onSearchChange,
  searchPlaceholder,
  rightButton,
  onRightButtonPress,
  rightButtonIcon,
  children,
}) => {
  return (
    <SafeAreaView style={styles.header} edges={["top"]}>
      <View style={styles.headerTop}>
        <TouchableOpacity
          style={styles.menuBtn}
          onPress={() => navigation?.openDrawer()}
        >
          <View style={styles.menuIcon}>
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
            <View style={styles.menuLine} />
          </View>
        </TouchableOpacity>

        <Text style={styles.headerTitle}>{title}</Text>

        <View style={styles.headerActions}>
          {rightButton && (
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={onRightButtonPress}
            >
              {rightButtonIcon}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {showSearch && (
        <View style={styles.searchContainer}>
          <SearchBar
            value={searchValue}
            onChangeText={onSearchChange}
            placeholder={
              searchPlaceholder || `Search ${title.toLowerCase()}...`
            }
          />
        </View>
      )}

      {children}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: theme.colors.white,
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 20,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  menuBtn: {
    width: 36,
    height: 36,
    backgroundColor: theme.colors.gray[50],
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  menuIcon: {
    width: 16,
    height: 12,
    justifyContent: "space-between",
  },
  menuLine: {
    width: 16,
    height: 2,
    backgroundColor: theme.colors.gray[600],
    borderRadius: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: theme.typography.fontWeights.bold,
    color: theme.colors.gray[900],
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtn: {
    width: 36,
    height: 36,
    backgroundColor: theme.colors.primary.brand,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  searchContainer: {
    marginBottom: 0,
  },
});

export default Header;
