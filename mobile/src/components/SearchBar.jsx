import { StyleSheet, TextInput, View } from "react-native";
import { theme } from "../constants/theme";
import { SearchIcon } from "./Icons";

const SearchBar = ({
  value,
  onChangeText,
  placeholder = "Search...",
  ...props
}) => {
  return (
    <View style={styles.searchContainer}>
      <SearchIcon size={18} color={theme.colors.gray[700]} />
      <TextInput
        style={styles.searchInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.gray[400]}
        {...props}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.gray[50],
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 2,
    borderColor: "transparent",
  },
  searchIcon: {
    width: 16,
    height: 16,
    position: "relative",
    marginRight: 10,
  },
  searchIconCircle: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2,
    borderColor: theme.colors.gray[500],
    position: "absolute",
    top: 0,
    left: 0,
  },
  searchIconHandle: {
    width: 2,
    height: 6,
    backgroundColor: theme.colors.gray[500],
    borderRadius: 1,
    position: "absolute",
    bottom: 0,
    right: 0,
    transform: [{ rotate: "45deg" }],
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.gray[800],
    padding: 0,
    marginLeft: 10,
  },
});

export default SearchBar;
